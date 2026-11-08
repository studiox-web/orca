import { describe, expect, it } from 'vitest'
import type { AutomationOwnerRef } from '../../shared/automation-owner-ref'
import {
  parseLegacyCrontabSnapshot,
  type LegacyCrontabOccurrence
} from '../../shared/legacy-crontab-adoption-snapshot'
import type {
  LegacyAdoptionExistingTarget,
  LegacyAdoptionLineageEvidence
} from '../../shared/legacy-crontab-adoption-preview-contract'
import { buildLegacyCrontabAdoptionPreview } from './legacy-crontab-adoption-preview'

const owner: AutomationOwnerRef = {
  authority: { kind: 'runtime', environmentId: 'prod', pairingRevision: 5 },
  selector: { kind: 'ssh', targetId: 'scheduler', targetGeneration: 12 }
}

function source(text = 'CRON_TZ=UTC\n0 9 * * * cd /repo && ./run-goal.sh writer\n') {
  return parseLegacyCrontabSnapshot({
    text,
    scope: { authority: owner, user: 'deploy', managerId: 'crontab:deploy' }
  }).occurrences[0]
}

function preview(
  overrides: {
    source?: LegacyCrontabOccurrence
    currentSourceRevision?: string
    destinationScheduleCount?: number
    hostTimezone?: string | null
    generatedAt?: string
    dtstart?: number
    lineage?: LegacyAdoptionLineageEvidence
    existingTarget?: LegacyAdoptionExistingTarget
    drain?: { source: 'clear' | 'running' | 'unknown'; target: 'clear' | 'running' | 'unknown' }
  } = {}
) {
  const selected = overrides.source ?? source()
  return buildLegacyCrontabAdoptionPreview({
    source: selected,
    currentSourceRevision: overrides.currentSourceRevision ?? selected.identity.sourceRevision,
    destination: { kind: 'goal', projectKey: '/repo', goal: 'writer' },
    destinationScheduleCount: overrides.destinationScheduleCount ?? 1,
    targetOwner: owner,
    hostTimezone:
      overrides.hostTimezone === undefined ? 'America/Vancouver' : overrides.hostTimezone,
    generatedAt: overrides.generatedAt ?? '2026-11-08T10:00:00.000Z',
    dtstart: overrides.dtstart ?? 1_794_134_400_000,
    missedRunGraceMinutes: 30,
    lineage: overrides.lineage ?? { state: 'absent' },
    existingTarget: overrides.existingTarget ?? { state: 'absent' },
    drain: overrides.drain ?? { source: 'clear', target: 'clear' }
  })
}

describe('buildLegacyCrontabAdoptionPreview', () => {
  it('builds an eligible disabled native target with exact lineage and ordered safety preconditions', () => {
    const candidate = preview()

    expect(candidate.verdict).toBe('eligible')
    expect(candidate.conflicts).toEqual([])
    expect(candidate.candidateId).toMatch(/^legacy-cron-preview:v1:[a-f0-9]{64}$/)
    expect(candidate.proposedTarget).toMatchObject({
      owner,
      automationId: null,
      creationKey: expect.stringMatching(/^legacy-cron-adoption:v1:[a-f0-9]{64}$/),
      schedule: '0 9 * * *',
      sourceScheduleFormat: 'cron',
      timezone: 'UTC',
      enabled: false,
      dtstart: 1_794_134_400_000,
      missedRunPolicy: 'run_once_within_grace',
      missedRunGraceMinutes: 30
    })
    expect(candidate.lineage).toMatchObject({
      source: candidate.source.identity,
      adoptionId: null,
      replacementAutomationId: null,
      replacementCreationKey: candidate.proposedTarget.creationKey,
      persistence: 'not-persisted'
    })
    expect(candidate.preconditions.drain).toEqual({
      source: 'clear',
      target: 'clear',
      status: 'satisfied'
    })
    expect(candidate.preconditions.cutover.map(({ code }) => code)).toEqual([
      'source-revision-current',
      'source-occurrence-unique',
      'single-source-schedule',
      'schedule-and-timezone-supported',
      'source-target-authority-generation-match',
      'disabled-target-created-idempotently',
      'exact-lineage-persisted',
      'source-and-target-reread',
      'exact-source-disabled',
      'source-inactive-confirmed',
      'source-and-target-drained',
      'target-enabled-after-drain',
      'final-source-target-lineage-reread'
    ])
    expect(candidate.preconditions.rollback.map(({ code }) => code)).toEqual([
      'target-disabled-first',
      'target-inactive-confirmed',
      'target-drained',
      'source-revision-and-occurrence-reread',
      'exact-source-restored-disabled-target-only',
      'rollback-lineage-reread'
    ])
  })

  it('keeps generated time and generated DTSTART out of candidate and creation identity', () => {
    const first = preview({ generatedAt: '2026-11-08T10:00:00.000Z', dtstart: 100 })
    const second = preview({ generatedAt: '2026-11-08T11:00:00.000Z', dtstart: 200 })

    expect(first.candidateId).toBe(second.candidateId)
    expect(first.proposedTarget.creationKey).toBe(second.proposedTarget.creationKey)
    expect(first.generatedAt).not.toBe(second.generatedAt)
    expect(first.proposedTarget.dtstart).not.toBe(second.proposedTarget.dtstart)
  })

  it.each([
    {
      name: 'stale revisions',
      overrides: { currentSourceRevision: 'sha256:stale' },
      code: 'stale-source-revision'
    },
    {
      name: 'identical duplicate ambiguity',
      overrides: { source: { ...source(), identicalOccurrenceCount: 2 } },
      code: 'identical-source-occurrences'
    },
    {
      name: 'multiple destination schedules',
      overrides: { destinationScheduleCount: 2 },
      code: 'multiple-source-schedules'
    },
    {
      name: 'unsupported macros',
      overrides: { source: source('@reboot ./boot.sh\n') },
      code: 'unsupported-source-macro'
    },
    {
      name: 'unsupported cron dialects',
      overrides: { source: source('0 9 ? * * ./quartz.sh\n') },
      code: 'unsupported-cron-dialect'
    },
    {
      name: 'unsupported timezones',
      overrides: { source: source('CRON_TZ=Mars/Olympus\n0 9 * * * ./job.sh\n') },
      code: 'unsupported-timezone'
    },
    {
      name: 'lineage conflicts',
      overrides: {
        lineage: {
          state: 'conflict' as const,
          adoptionId: 'adoption-other',
          replacementAutomationId: 'automation-other'
        }
      },
      code: 'lineage-conflict'
    },
    {
      name: 'unknown drain state',
      overrides: { drain: { source: 'unknown' as const, target: 'clear' as const } },
      code: 'drain-state-unknown'
    }
  ])('blocks $name', ({ overrides, code }) => {
    const candidate = preview(overrides)

    expect(candidate.verdict).toBe('blocked')
    expect(candidate.conflicts).toContainEqual(
      expect.objectContaining({ code, severity: 'blocking' })
    )
    expect(candidate.proposedTarget.enabled).toBe(false)
  })

  it('blocks an existing enabled target even when its exact creation identity matches', () => {
    const initial = preview()
    const candidate = preview({
      existingTarget: {
        state: 'enabled',
        automationId: 'automation-1',
        creationKey: initial.proposedTarget.creationKey,
        owner
      }
    })

    expect(candidate.verdict).toBe('blocked')
    expect(candidate.conflicts).toContainEqual(
      expect.objectContaining({ code: 'existing-target-enabled', severity: 'blocking' })
    )
    expect(candidate.proposedTarget).toMatchObject({ automationId: 'automation-1', enabled: false })
  })

  it('requires a decision for unresolved host timezone or running work without claiming eligibility', () => {
    const timezone = preview({
      source: source('0 9 * * * ./job.sh\n'),
      hostTimezone: null
    })
    const running = preview({ drain: { source: 'running', target: 'clear' } })

    expect(timezone.verdict).toBe('decision-required')
    expect(timezone.conflicts).toContainEqual(
      expect.objectContaining({ code: 'timezone-decision-required' })
    )
    expect(running.verdict).toBe('decision-required')
    expect(running.preconditions.drain.status).toBe('required')
    expect(running.conflicts).toContainEqual(
      expect.objectContaining({ code: 'source-drain-required' })
    )
  })

  it('preserves an exact Script destination and matching disabled replacement lineage', () => {
    const selected = source('CRON_TZ=UTC\n@daily cd /repo && ./sync.sh\n')
    const scriptDestination = { kind: 'script' as const, scriptKey: 'feed-sync', cwd: '/repo' }
    const initial = buildLegacyCrontabAdoptionPreview({
      source: selected,
      currentSourceRevision: selected.identity.sourceRevision,
      destination: scriptDestination,
      destinationScheduleCount: 1,
      targetOwner: owner,
      hostTimezone: null,
      generatedAt: 'earlier',
      dtstart: 0,
      missedRunGraceMinutes: 10,
      lineage: { state: 'absent' },
      existingTarget: { state: 'absent' },
      drain: { source: 'clear', target: 'clear' }
    })
    const candidate = buildLegacyCrontabAdoptionPreview({
      source: selected,
      currentSourceRevision: selected.identity.sourceRevision,
      destination: scriptDestination,
      destinationScheduleCount: 1,
      targetOwner: owner,
      hostTimezone: null,
      generatedAt: '2026-11-08T12:00:00.000Z',
      dtstart: 1_794_134_400_000,
      missedRunGraceMinutes: 10,
      lineage: {
        state: 'matching',
        adoptionId: 'adoption-1',
        replacementAutomationId: 'automation-1'
      },
      existingTarget: {
        state: 'disabled',
        automationId: 'automation-1',
        creationKey: initial.proposedTarget.creationKey,
        owner
      },
      drain: { source: 'clear', target: 'clear' }
    })

    expect(candidate.verdict).toBe('eligible')
    expect(candidate.destination).toEqual({ kind: 'script', scriptKey: 'feed-sync', cwd: '/repo' })
    expect(candidate.proposedTarget).toMatchObject({
      automationId: 'automation-1',
      schedule: '0 0 * * *',
      enabled: false
    })
    expect(candidate.lineage).toMatchObject({
      adoptionId: 'adoption-1',
      replacementAutomationId: 'automation-1',
      persistence: 'matching'
    })
  })
})
