import type { AutomationRunStatus } from './automations-types'
import type {
  CoordinatedAttemptRecord,
  CoordinatedEffectEntry,
  CoordinatedEscalation,
  CoordinatedRunHalt,
  CoordinatedStageStatus
} from './coordinated-automation-progress-types'
import type { SemanticCompletionReceipt } from './coordinated-automation-receipt-types'
import type { CoordinatedCompletionTrust } from './coordinated-automation-types'
import type { CoordinatedRunMaterializationPhase } from './coordinated-automation-saga-types'

export type CoordinatedRunSemanticState =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'outcome_uncertain'
  | 'waiting'

export type Availability<T> =
  | ({ kind: 'available' } & T)
  | { kind: 'absent'; reason: string }
  | { kind: 'unavailable'; reason: string }

export type CoordinatedStageInspection = {
  childDefinitionId: string
  name: string
  role: string
  enabled: boolean
  taskId: string | null
  /** Dispatch the Store mapping records for this child; null before the first Dispatch. */
  mappedDispatchId: string | null
  native: Availability<{
    taskStatus: string
    latestDispatchId: string | null
    latestDispatchStatus: string | null
  }>
  semantic: Availability<{
    status: CoordinatedStageStatus
    attempts: number
    acceptedDispatchId: string | null
    lastError: string | null
    lineage: CoordinatedAttemptRecord[]
  }>
  /** Fake workers have no chat/terminal session; never fabricated. */
  sessionTarget: { kind: 'unavailable'; reason: string }
}

export type CoordinatedRunInspection = {
  automationId: string
  automationRunId: string
  runStatus: AutomationRunStatus
  runError: string | null
  definitionRevision: number
  canonicalDigest: string | null
  idempotencyKey: string | null
  materializationPhase: CoordinatedRunMaterializationPhase | null
  orchestrationRunId: string | null
  stages: CoordinatedStageInspection[]
  progress: Availability<{
    generation: number
    sequence: number
    halt: CoordinatedRunHalt | null
    escalations: CoordinatedEscalation[]
    effects: CoordinatedEffectEntry[]
    reportCount: number
  }>
  receipt: Availability<{
    receipt: SemanticCompletionReceipt
    trust: CoordinatedCompletionTrust | null
  }>
  /** No reviewed host API resolves uncertain effects, conflicts, or limits yet. */
  humanResolution: { available: false; reason: string }
}

export type CoordinatedRunReconcileResult = {
  automationRunId: string
  state: CoordinatedRunSemanticState
  reason: string | null
  inspection: CoordinatedRunInspection
}

export type CoordinatedManualRunResult = CoordinatedRunReconcileResult & {
  /** False when the idempotency key replayed an existing run. */
  created: boolean
}
