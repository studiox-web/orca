import { createHash } from 'node:crypto'
import type { AutomationOwnerRef } from '../../shared/automation-owner-ref'
import type { LegacyCrontabOccurrence } from '../../shared/legacy-crontab-adoption-snapshot'
import type {
  LegacyAdoptionConflict,
  LegacyAdoptionDestination,
  LegacyAdoptionDrainState,
  LegacyAdoptionExistingTarget,
  LegacyAdoptionLineageEvidence,
  LegacyAdoptionPrecondition,
  LegacyAdoptionPreviewCandidate
} from '../../shared/legacy-crontab-adoption-preview-contract'

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right, 'en'))
        )
      : item
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sameOwner(left: AutomationOwnerRef, right: AutomationOwnerRef): boolean {
  return stableJson(left) === stableJson(right)
}

function supportsTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

function precondition(
  code: string,
  status: LegacyAdoptionPrecondition['status']
): LegacyAdoptionPrecondition {
  return { code, status }
}

export function buildLegacyCrontabAdoptionPreview(args: {
  source: LegacyCrontabOccurrence
  currentSourceRevision: string
  destination: LegacyAdoptionDestination
  destinationScheduleCount: number
  targetOwner: AutomationOwnerRef
  hostTimezone: string | null
  generatedAt: string
  dtstart: number
  missedRunGraceMinutes: number
  lineage: LegacyAdoptionLineageEvidence
  existingTarget: LegacyAdoptionExistingTarget
  drain: { source: LegacyAdoptionDrainState; target: LegacyAdoptionDrainState }
}): LegacyAdoptionPreviewCandidate {
  const timezone = args.source.timezone.value ?? args.hostTimezone
  const identityMaterial = {
    source: args.source.identity,
    destination: args.destination,
    targetOwner: args.targetOwner,
    targetSchedule: args.source.schedule.normalizedExpression,
    targetTimezone: timezone,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: args.missedRunGraceMinutes
  }
  const identityDigest = sha256(stableJson(identityMaterial))
  const candidateId = `legacy-cron-preview:v1:${identityDigest}`
  const creationKey = `legacy-cron-adoption:v1:${identityDigest}`
  const conflicts: LegacyAdoptionConflict[] = []
  const blocking = (code: LegacyAdoptionConflict['code'], message: string): void => {
    conflicts.push({ code, severity: 'blocking', message })
  }
  const decision = (code: LegacyAdoptionConflict['code'], message: string): void => {
    conflicts.push({ code, severity: 'decision-required', message })
  }

  const sourceCurrent = args.currentSourceRevision === args.source.identity.sourceRevision
  if (!sourceCurrent) {
    blocking('stale-source-revision', 'The crontab revision no longer matches the preview source.')
  }
  const sourceUnique = args.source.identicalOccurrenceCount === 1
  if (!sourceUnique) {
    blocking(
      'identical-source-occurrences',
      'Identical crontab lines are not safely targetable by the current guarded mutation contract.'
    )
  }
  const singleSchedule = args.destinationScheduleCount === 1
  if (!singleSchedule) {
    blocking(
      'multiple-source-schedules',
      'The destination must have exactly one legacy schedule before one-target adoption is safe.'
    )
  }
  const scheduleSupported = args.source.schedule.support === 'supported'
  if (args.source.schedule.support === 'unsupported-macro') {
    blocking(
      'unsupported-source-macro',
      args.source.schedule.unsupportedReason ?? 'The source macro has no native equivalent.'
    )
  } else if (args.source.schedule.support === 'unsupported-dialect') {
    blocking(
      'unsupported-cron-dialect',
      args.source.schedule.unsupportedReason ?? 'The source cron dialect is unsupported.'
    )
  }

  const timezoneKnown = timezone !== null
  const timezoneSupported = timezone === null || supportsTimezone(timezone)
  if (!timezoneKnown) {
    decision(
      'timezone-decision-required',
      'Resolve the source host timezone before proposing a native target timezone.'
    )
  } else if (!timezoneSupported) {
    blocking('unsupported-timezone', `The source timezone ${timezone} is unsupported.`)
  }

  const lineageMatches = args.lineage.state !== 'conflict'
  if (!lineageMatches) {
    blocking(
      'lineage-conflict',
      'Existing adoption lineage points at a different source or target.'
    )
  }
  if (args.existingTarget.state === 'enabled') {
    blocking('existing-target-enabled', 'The existing native target is enabled.')
  }
  const authorityMatches = sameOwner(args.source.identity.authority, args.targetOwner)
  if (!authorityMatches) {
    blocking(
      'authority-generation-mismatch',
      'The source and proposed target do not share the same authority generation.'
    )
  }
  const existingTargetMatches =
    args.existingTarget.state === 'absent' ||
    (args.existingTarget.creationKey === creationKey &&
      sameOwner(args.existingTarget.owner, args.targetOwner))
  if (!existingTargetMatches) {
    blocking(
      'lineage-conflict',
      'The existing native target does not match the proposed creation key and owner.'
    )
  }

  const drainUnknown = args.drain.source === 'unknown' || args.drain.target === 'unknown'
  if (drainUnknown) {
    blocking('drain-state-unknown', 'Host-authoritative source and target drain state is required.')
  } else {
    if (args.drain.source === 'running') {
      decision('source-drain-required', 'The source run must finish or be cancelled and confirmed.')
    }
    if (args.drain.target === 'running') {
      decision('target-drain-required', 'The target run must finish or be cancelled and confirmed.')
    }
  }

  const semanticsStatus: LegacyAdoptionPrecondition['status'] =
    !scheduleSupported || !timezoneSupported ? 'blocked' : timezoneKnown ? 'satisfied' : 'required'
  const drainStatus = drainUnknown
    ? 'blocked'
    : args.drain.source === 'clear' && args.drain.target === 'clear'
      ? 'satisfied'
      : 'required'
  const targetDisabled = args.existingTarget.state !== 'enabled'
  const lineageStatus = lineageMatches && existingTargetMatches ? 'required' : 'blocked'
  const replacementAutomationId =
    args.existingTarget.state === 'absent'
      ? args.lineage.state === 'matching'
        ? args.lineage.replacementAutomationId
        : null
      : args.existingTarget.automationId

  const cutover: LegacyAdoptionPrecondition[] = [
    precondition('source-revision-current', sourceCurrent ? 'satisfied' : 'blocked'),
    precondition('source-occurrence-unique', sourceUnique ? 'satisfied' : 'blocked'),
    precondition('single-source-schedule', singleSchedule ? 'satisfied' : 'blocked'),
    precondition('schedule-and-timezone-supported', semanticsStatus),
    precondition(
      'source-target-authority-generation-match',
      authorityMatches ? 'satisfied' : 'blocked'
    ),
    precondition(
      'disabled-target-created-idempotently',
      targetDisabled
        ? args.existingTarget.state === 'disabled'
          ? 'satisfied'
          : 'required'
        : 'blocked'
    ),
    precondition(
      'exact-lineage-persisted',
      args.lineage.state === 'matching' && existingTargetMatches ? 'satisfied' : lineageStatus
    ),
    precondition('source-and-target-reread', 'required'),
    precondition('exact-source-disabled', 'required'),
    precondition('source-inactive-confirmed', 'required'),
    precondition('source-and-target-drained', drainStatus),
    precondition('target-enabled-after-drain', 'required'),
    precondition('final-source-target-lineage-reread', 'required')
  ]
  const rollback: LegacyAdoptionPrecondition[] = [
    precondition(
      'target-disabled-first',
      args.existingTarget.state === 'absent' ? 'not-applicable' : 'required'
    ),
    precondition(
      'target-inactive-confirmed',
      args.existingTarget.state === 'absent' ? 'not-applicable' : 'required'
    ),
    precondition('target-drained', args.drain.target === 'unknown' ? 'blocked' : 'required'),
    precondition(
      'source-revision-and-occurrence-reread',
      sourceCurrent && sourceUnique ? 'required' : 'blocked'
    ),
    precondition('exact-source-restored-disabled-target-only', 'required'),
    precondition('rollback-lineage-reread', 'required')
  ]
  const verdict = conflicts.some((conflict) => conflict.severity === 'blocking')
    ? 'blocked'
    : conflicts.length > 0
      ? 'decision-required'
      : 'eligible'

  return {
    candidateId,
    generatedAt: args.generatedAt,
    source: args.source,
    destination: args.destination,
    proposedTarget: {
      owner: args.targetOwner,
      automationId: replacementAutomationId,
      creationKey,
      schedule: args.source.schedule.normalizedExpression,
      sourceScheduleFormat: args.source.schedule.format,
      timezone,
      enabled: false,
      dtstart: args.dtstart,
      missedRunPolicy: 'run_once_within_grace',
      missedRunGraceMinutes: args.missedRunGraceMinutes
    },
    lineage: {
      source: args.source.identity,
      adoptionId: args.lineage.state === 'absent' ? null : args.lineage.adoptionId,
      replacementAutomationId,
      replacementCreationKey: creationKey,
      persistence:
        args.lineage.state === 'matching'
          ? 'matching'
          : args.lineage.state === 'conflict'
            ? 'conflict'
            : 'not-persisted'
    },
    conflicts,
    preconditions: {
      drain: { ...args.drain, status: drainStatus },
      cutover,
      rollback
    },
    verdict
  }
}
