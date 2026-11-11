import type { AutomationMissedRunPolicy } from './automations-types'
import type { AutomationOwnerRef } from './automation-owner-ref'
import type {
  LegacyCrontabOccurrence,
  LegacyCrontabOccurrenceIdentity
} from './legacy-crontab-adoption-snapshot'

export type LegacyAdoptionDestination =
  | { kind: 'goal'; projectKey: string; goal: string }
  | { kind: 'script'; scriptKey: string; cwd: string }

export type LegacyAdoptionDrainState = 'clear' | 'running' | 'unknown'

export type LegacyAdoptionLineageEvidence =
  | { state: 'absent' }
  | {
      state: 'matching'
      source: LegacyCrontabOccurrenceIdentity
      adoptionId: string
      replacementAutomationId: string
    }
  | {
      state: 'conflict'
      source: LegacyCrontabOccurrenceIdentity
      adoptionId: string | null
      replacementAutomationId: string | null
    }

export type LegacyAdoptionExistingTarget =
  | { state: 'absent' }
  | {
      state: 'disabled' | 'enabled'
      automationId: string
      creationKey: string
      owner: AutomationOwnerRef
    }

export type LegacyAdoptionConflict = {
  code:
    | 'stale-source-revision'
    | 'identical-source-occurrences'
    | 'multiple-source-schedules'
    | 'unsupported-source-macro'
    | 'unsupported-cron-dialect'
    | 'unsupported-timezone'
    | 'authority-generation-mismatch'
    | 'lineage-conflict'
    | 'existing-target-enabled'
    | 'drain-state-unknown'
    | 'timezone-decision-required'
    | 'source-drain-required'
    | 'target-drain-required'
  severity: 'blocking' | 'decision-required'
  message: string
}

export type LegacyAdoptionPrecondition = {
  code: string
  status: 'satisfied' | 'required' | 'blocked' | 'not-applicable'
}

export type LegacyAdoptionPreviewCandidate = {
  candidateId: string
  generatedAt: string
  source: LegacyCrontabOccurrence
  destination: LegacyAdoptionDestination
  proposedTarget: {
    owner: AutomationOwnerRef
    automationId: string | null
    creationKey: string
    schedule: string | null
    sourceScheduleFormat: LegacyCrontabOccurrence['schedule']['format']
    timezone: string | null
    enabled: false
    dtstart: number
    missedRunPolicy: AutomationMissedRunPolicy
    missedRunGraceMinutes: number
  }
  lineage: {
    source: LegacyCrontabOccurrenceIdentity
    adoptionId: string | null
    replacementAutomationId: string | null
    replacementCreationKey: string
    persistence: 'not-persisted' | 'matching' | 'conflict'
  }
  conflicts: LegacyAdoptionConflict[]
  preconditions: {
    drain: {
      source: LegacyAdoptionDrainState
      target: LegacyAdoptionDrainState
      status: 'satisfied' | 'required' | 'blocked'
    }
    cutover: LegacyAdoptionPrecondition[]
    rollback: LegacyAdoptionPrecondition[]
  }
  verdict: 'eligible' | 'blocked' | 'decision-required'
}
