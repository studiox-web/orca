import type { Automation, AutomationRun } from './automations-types'
import { hostStableKey, ownerKey } from './automation-owner-key'
import type { AutomationOwnerRef, StableAutomationCatalogRef } from './automation-owner-ref'
import { parseExecutionHostId } from './execution-host'
import type { XosCronJob, XosGoalRun } from './xos-goals-types'
import type {
  UnifiedRunOutcome,
  UnifiedRunSummary,
  UnifiedScheduleRef,
  UnifiedScheduleState,
  UnifiedSourceRef
} from './unified-automation-types'

export const LOCAL_UNIFIED_AUTHORITY: StableAutomationCatalogRef = {
  authority: { kind: 'desktop' },
  selector: { kind: 'self' }
}

export function unifiedSourceRef(
  input: Omit<UnifiedSourceRef, 'authority'> & {
    authority?: StableAutomationCatalogRef
  }
): UnifiedSourceRef {
  const { authority = LOCAL_UNIFIED_AUTHORITY, ...rest } = input
  return { authority, ...rest }
}

export function cronSchedule(
  job: XosCronJob,
  revision: string,
  scope: string,
  occurrence: number
): UnifiedScheduleRef {
  const sourceRef = unifiedSourceRef({
    kind: 'legacy-cron',
    sourceId: `${scope}:${job.id}:${occurrence}`,
    revision,
    ownerKey: null,
    label: 'Legacy cron'
  })
  return {
    key: `cron:${encodeURIComponent(revision)}:${encodeURIComponent(sourceRef.sourceId)}`,
    owner: 'legacy-cron',
    format: 'cron',
    expression: job.schedule,
    timezone: null,
    timezoneLabel: 'Host/crontab timezone',
    enabled: !job.paused,
    nextRunAt: job.nextRunAt,
    sourceRef
  }
}

export function automationAuthority(automation: Automation): {
  stable: StableAutomationCatalogRef
  capturedOwner: string | null
  host: string
} {
  const executionHost = parseExecutionHostId(automation.runContext?.hostId)
  if (executionHost?.kind === 'runtime') {
    const stable: StableAutomationCatalogRef = {
      authority: { kind: 'runtime', environmentId: executionHost.environmentId },
      selector:
        automation.executionTargetType === 'ssh'
          ? { kind: 'ssh', targetId: automation.executionTargetId }
          : { kind: 'self' }
    }
    return {
      stable,
      capturedOwner: null,
      host:
        stable.selector.kind === 'ssh'
          ? `${stable.selector.targetId} via ${executionHost.environmentId}`
          : executionHost.environmentId
    }
  }
  if (automation.executionTargetType !== 'ssh') {
    return {
      stable: LOCAL_UNIFIED_AUTHORITY,
      capturedOwner: ownerKey({
        authority: { kind: 'desktop' },
        selector: { kind: 'self' }
      }),
      host: 'This device'
    }
  }
  const stable: StableAutomationCatalogRef = {
    authority: { kind: 'desktop' },
    selector: { kind: 'ssh', targetId: automation.executionTargetId }
  }
  const generation = automation.executionTargetGeneration
  const capturedOwner =
    Number.isSafeInteger(generation) && generation !== undefined
      ? ownerKey({
          authority: { kind: 'desktop' },
          selector: {
            kind: 'ssh',
            targetId: automation.executionTargetId,
            targetGeneration: generation
          }
        } satisfies AutomationOwnerRef)
      : null
  return { stable, capturedOwner, host: automation.executionTargetId || 'Unknown SSH host' }
}

function nativeSourceRef(automation: Automation): UnifiedSourceRef {
  const authority = automationAuthority(automation)
  return unifiedSourceRef({
    kind: 'native-automation',
    authority: authority.stable,
    sourceId: automation.id,
    revision: String(automation.updatedAt),
    ownerKey: authority.capturedOwner,
    label: 'Orca'
  })
}

export function nativeSchedule(automation: Automation): UnifiedScheduleRef {
  const sourceRef = nativeSourceRef(automation)
  return {
    key: `native:${hostStableKey(sourceRef.authority)}:${encodeURIComponent(automation.id)}`,
    owner: 'orca',
    format: 'rrule',
    expression: automation.rrule,
    timezone: automation.timezone,
    timezoneLabel: automation.timezone,
    enabled: automation.enabled,
    nextRunAt: Number.isFinite(automation.nextRunAt)
      ? new Date(automation.nextRunAt).toISOString()
      : null,
    sourceRef
  }
}

export function unifiedScheduleState(
  children: readonly UnifiedScheduleRef[]
): UnifiedScheduleState {
  if (children.length === 0) {
    return 'unscheduled'
  }
  const enabled = children.filter((child) => child.enabled).length
  if (enabled === 0) {
    return 'paused'
  }
  return enabled === children.length ? 'enabled' : 'mixed'
}

function runOutcome(status: string): UnifiedRunOutcome {
  const value = status.toLowerCase()
  if (
    value.includes('running') ||
    value === 'pending' ||
    value === 'dispatching' ||
    value === 'dispatched'
  ) {
    return 'running'
  }
  if (value.includes('limit')) {
    return 'limited'
  }
  if (value.includes('timeout') || value.includes('timed_out')) {
    return 'timed-out'
  }
  if (value.includes('cancel')) {
    return 'cancelled'
  }
  if (value.includes('skip')) {
    return 'skipped'
  }
  if (value.includes('fail') || value.includes('error')) {
    return 'failed'
  }
  if (value.includes('success') || value.includes('complete')) {
    return 'succeeded'
  }
  return 'unknown'
}

export function goalRunSummary(run: XosGoalRun | null): UnifiedRunSummary | null {
  if (!run) {
    return null
  }
  const sourceId = run.run_id?.trim() || null
  return {
    source: 'goal-receipt',
    sourceId,
    identity: sourceId ? 'stable' : 'legacy-without-run-id',
    outcome: runOutcome(run.status),
    sourceStatus: run.status,
    at: run.started_at
  }
}

export function nativeRunSummary(run: AutomationRun | undefined): UnifiedRunSummary | null {
  if (!run) {
    return null
  }
  return {
    source: 'native',
    sourceId: run.id,
    identity: 'stable',
    outcome: runOutcome(run.status),
    sourceStatus: run.status,
    at: new Date(run.startedAt ?? run.createdAt).toISOString()
  }
}

export function newestRun(
  goal: UnifiedRunSummary | null,
  native: UnifiedRunSummary | null
): UnifiedRunSummary | null {
  if (!goal) {
    return native
  }
  if (!native) {
    return goal
  }
  const goalAt = goal.at ? Date.parse(goal.at) : Number.NEGATIVE_INFINITY
  const nativeAt = native.at ? Date.parse(native.at) : Number.NEGATIVE_INFINITY
  return nativeAt > goalAt ? native : goal
}

export function unifiedMigrationState(children: readonly UnifiedScheduleRef[], conflict = false) {
  if (conflict) {
    return 'conflict' as const
  }
  const owners = new Set(children.map((child) => child.owner))
  if (owners.has('legacy-cron') && owners.has('orca')) {
    return 'paired' as const
  }
  return owners.has('legacy-cron') ? ('legacy' as const) : ('none' as const)
}
