import type { TuiAgent } from './tui-agent'
import type { StableAutomationCatalogRef } from './automation-owner-ref'

export type UnifiedAutomationKind = 'goal' | 'automation' | 'script' | 'external'

export type UnifiedScheduleOwner = 'orca' | 'legacy-cron' | 'external-manager'
export type UnifiedScheduleFormat = 'rrule' | 'cron' | 'manager'
export type UnifiedScheduleState = 'enabled' | 'paused' | 'mixed' | 'unscheduled'
export type UnifiedRunOutcome =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'limited'
  | 'skipped'
  | 'timed-out'
  | 'cancelled'
  | 'unknown'
export type UnifiedMigrationState = 'none' | 'legacy' | 'paired' | 'conflict'

export type UnifiedAutomationIdentity =
  | {
      kind: 'goal'
      authority: StableAutomationCatalogRef
      projectKey: string
      goal: string
    }
  | {
      kind: 'automation'
      authority: StableAutomationCatalogRef
      automationId: string
    }
  | {
      kind: 'script'
      authority: StableAutomationCatalogRef
      sourceId: string
    }
  | {
      kind: 'external'
      authority: StableAutomationCatalogRef
      managerId: string
      jobId: string
    }

export type UnifiedSourceRef = {
  kind: 'goal' | 'native-automation' | 'runtime-binding' | 'legacy-cron' | 'external'
  authority: StableAutomationCatalogRef
  sourceId: string
  revision: string | null
  ownerKey: string | null
  label: string
}

export type UnifiedScheduleRef = {
  key: string
  owner: UnifiedScheduleOwner
  format: UnifiedScheduleFormat
  expression: string
  timezone: string | null
  timezoneLabel: string
  enabled: boolean
  nextRunAt: string | null
  sourceRef: UnifiedSourceRef
}

export type UnifiedLifecycle = {
  state: 'active' | 'archived' | 'present'
  stage: string | null
}

export type UnifiedRunSummary = {
  source: 'native' | 'goal-receipt' | 'external'
  sourceId: string | null
  identity: 'stable' | 'legacy-without-run-id' | 'aggregate-without-run-id'
  outcome: UnifiedRunOutcome
  sourceStatus: string
  at: string | null
}

export type UnifiedAutomationWarning = {
  code:
    | 'binding-conflict'
    | 'binding-target-missing'
    | 'config-attribution-conflict'
    | 'duplicate-native-identity'
    | 'legacy-run-without-id'
    | 'legacy-source-identity'
    | 'run-attribution-conflict'
    | 'source-unavailable'
    | 'stale-source'
  message: string
}

export type UnifiedScriptEvidence = {
  provenance: 'runtime-binding' | 'legacy-cron'
  command: string | null
  cwd: string | null
  replacesCronCommand: string | null
}

export type UnifiedAutomationRow = {
  key: string
  identity: UnifiedAutomationIdentity
  kind: UnifiedAutomationKind
  name: string
  project: string | null
  projectKey: string | null
  host: string
  owner: string
  lifecycle: UnifiedLifecycle
  scheduleState: UnifiedScheduleState
  scheduleChildren: UnifiedScheduleRef[]
  runSummary: UnifiedRunSummary | null
  agentId: TuiAgent | null
  migrationState: UnifiedMigrationState
  sourceRefs: UnifiedSourceRef[]
  warnings: UnifiedAutomationWarning[]
  scriptEvidence?: UnifiedScriptEvidence | null
  readOnly: true
}

export type UnifiedAutomationSnapshot = {
  generatedAt: string
  revisions: {
    goals: string
    legacyCron: string
    nativeAutomations: string
    runtimeBindings: string
  }
  rows: UnifiedAutomationRow[]
  warnings: UnifiedAutomationWarning[]
}
