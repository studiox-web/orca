import type { AutomationRunStatus } from './automations-types'
import type {
  CoordinatedAttemptRecord,
  CoordinatedEffectEntry,
  CoordinatedEscalation,
  CoordinatedRunHalt,
  CoordinatedStageStatus
} from './coordinated-automation-progress-types'
import type {
  SemanticCompletionReceipt,
  StructuredWorkerBlocker,
  StructuredWorkerCheck,
  StructuredWorkerResultOutcome
} from './coordinated-automation-receipt-types'
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
  /** Every pending gate of this stage, in resolution order; `pendingGateId` is the first. */
  pendingGateIds: readonly string[]
  /**
   * The attempt whose held report an `approve` of a stage requirement would bind; null means
   * approve is refused until a report is held for approval (reject/escalate need none).
   */
  approvableDispatchId: string | null
}

export type CoordinatedGateScope = 'stage' | 'parent' | 'escalation'

/** One pending operator decision with the scope the host will bind it to. */
export type CoordinatedPendingDecision = {
  gateId: string
  scope: CoordinatedGateScope
  /** Owning stage for stage gates and stage escalations; null for parent/run scope. */
  childDefinitionId: string | null
}

/**
 * What one stage's latest admitted report said, re-read from the native Task result and shown
 * only while those bytes still match the digest the coordinator admitted. Never inferred.
 */
export type CoordinatedStageReportEvidence = {
  dispatchId: string
  reportDigest: string
  /** How the coordinator disposed of this report; only `accepted` satisfies the stage. */
  disposition: 'accepted' | 'rejected' | 'stale' | 'duplicate'
  dispositionReason: string | null
  outcome: StructuredWorkerResultOutcome
  summary: string
  artifacts: { kind: string; uri: string; sha256: string | null }[]
  checks: StructuredWorkerCheck[]
  blockers: StructuredWorkerBlocker[]
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

/** A report held for an operator decision, with exactly what an approval would bind. */
export type CoordinatedStagePendingApprovalView = {
  dispatchId: string
  reportDigest: string
  gateIds: readonly string[]
  since: number
  /** The held report's content while the native result still matches `reportDigest`. */
  report: Availability<
    Pick<
      CoordinatedStageReportEvidence,
      'outcome' | 'summary' | 'artifacts' | 'checks' | 'blockers'
    >
  >
}

export type CoordinatedRunHumanResolution = {
  available: boolean
  reason: string | null
  /** Escalation keys and unmet approval ids awaiting an operator decision. */
  pendingDecisionKeys: readonly string[]
  /** The same pending decisions with their scope; one id may appear once per scope. */
  pendingDecisions: readonly CoordinatedPendingDecision[]
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
    /** Latest attempt the coordinator launched for this stage, admitted or not. */
    activeDispatchId: string | null
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
  /** Latest admitted report evidence; absent before any report, unavailable if unprovable. */
  evidence: Availability<CoordinatedStageReportEvidence>
  /** Present only while a report is held for approval; it is not yet admitted or accepted. */
  pendingApproval?: CoordinatedStagePendingApprovalView
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
  /** Frozen `<type>:<id>` execution authority operator actions must name; null if unfrozen. */
  targetExecutionAuthority: string | null
  /** Stages with an attempt currently open, from trusted progress; empty when unknown. */
  activeStageIds: readonly string[]
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

/** `already_recorded`: an identical earlier request took effect; this replay wrote nothing. */
export type CoordinatedOperatorActionDisposition = 'recorded' | 'already_recorded'

export type CoordinatedOperatorActionResult = CoordinatedRunReconcileResult & {
  disposition: CoordinatedOperatorActionDisposition
}

export type CoordinatedManualRunResult = CoordinatedRunReconcileResult & {
  /** False when the idempotency key replayed an existing run. */
  created: boolean
}
