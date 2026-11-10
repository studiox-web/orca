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

/**
 * Where an operator can land to watch one stage's worker. Only a proven-current native attempt
 * mints a terminal target; historical, stopped, or unprovable attempts stay unavailable rather
 * than fabricating a destination.
 */
export type CoordinatedStageSessionTarget =
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'terminal'
      handle: string
      paneKey: string
      dispatchId: string
      taskId: string
      childDefinitionId: string
    }

export type CoordinatedRetryEligibility = {
  canRetry: boolean
  reason: string | null
  /** Exact latest Dispatch a retry names; null when no attempt exists or one is still open. */
  retryOfDispatchId: string | null
}

export type CoordinatedGateResolutionEligibility = {
  canResolve: boolean
  reason: string | null
  /** Unmet approval requirement id or human-decision escalation key awaiting a decision. */
  pendingGateId: string | null
}

export type CoordinatedApprovalObservation = {
  approvalId: string
  role: string
  description?: string
  disallowAuthorApproval?: boolean
  status: 'pending' | 'approved' | 'rejected'
  approverIdentity?: string | null
  authorIdentity?: string | null
  approvedAt?: number | null
  evidence?: string | null
  rejectionReason?: string | null
  scope: {
    automationRunId: string
    orchestrationRunId: string | null
    childDefinitionId?: string
    taskId?: string
    dispatchId?: string
  }
}

export type CoordinatedRunHumanResolution = {
  available: boolean
  reason: string | null
  /** Escalation keys and unmet approval ids awaiting an operator decision. */
  pendingDecisionKeys: readonly string[]
}

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
  sessionTarget: CoordinatedStageSessionTarget
  /** Host-computed operator admission for one exact retry of this stage's latest attempt. */
  retryEligibility: CoordinatedRetryEligibility
  /** Host-computed pending gates this stage can resolve. */
  gateResolutionEligibility: CoordinatedGateResolutionEligibility
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
  /** Operator approvals recorded for this run, projected per scope. */
  approvals: {
    stage: CoordinatedApprovalObservation[]
    parent: CoordinatedApprovalObservation[]
  }
  /** Operator stop state; null until the stop authority records one. */
  operatorStop: { at: number; reason: string | null } | null
  humanResolution: CoordinatedRunHumanResolution
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
