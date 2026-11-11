import type { SemanticReceiptApproval } from './coordinated-automation-receipt-types'

/**
 * Host-owned durable progress for one coordinated run. Stage acceptance, loop counters,
 * effect intents, and escalations live here so no agent owns the only copy.
 */

export type CoordinatedStageStatus =
  | 'pending'
  | 'accepted'
  | 'revision_requested'
  | 'rejected'
  | 'invalidated'

export type CoordinatedAcceptedArtifact = { uri: string; sha256: string }

export type CoordinatedAttemptKind = 'initial' | 'retry' | 'fix' | 'rerun'

export type CoordinatedAttemptStatus = 'starting' | 'active' | 'admitted' | 'abandoned'

/**
 * One attempt in a stage's durable lineage, written before its native Dispatch starts so a
 * restart can bind, time out, or abandon it deterministically.
 */
export type CoordinatedAttemptRecord = {
  attemptNumber: number
  kind: CoordinatedAttemptKind
  dispatchId: string | null
  /** Logical predecessor; kept even when native retry lineage cannot be expressed. */
  retryOfDispatchId: string | null
  /** Latest native Dispatch before this attempt started; binds a crash-orphaned start. */
  previousLatestDispatchId: string | null
  startedAt: number
  deadlineAt: number
  /** Artifact identities this attempt holds a fixer lease on (fix/retry attempts only). */
  leaseKeys: string[]
  status: CoordinatedAttemptStatus
}

export type CoordinatedStageProgress = {
  status: CoordinatedStageStatus
  /** Dispatch the coordinator launched last for this stage. */
  activeDispatchId: string | null
  acceptedDispatchId: string | null
  acceptedReportDigest: string | null
  acceptedArtifacts: CoordinatedAcceptedArtifact[]
  /** Admitted attempts; bounded by the retry budget plus one per reopening. */
  attempts: number
  /** Times a review reset reopened this stage; each grants exactly one extra attempt. */
  reopenings: number
  lineage: CoordinatedAttemptRecord[]
  /** Fix iterations opened because a reviewer reported a material finding. */
  reviewIterations: number
  /** Fingerprints of findings already sent back to this stage. */
  findings: string[]
  lastError: string | null
}

export type CoordinatedReportDisposition = 'accepted' | 'rejected' | 'stale' | 'duplicate'

/** Every report the coordinator saw, kept for audit even when it cannot satisfy a stage. */
export type CoordinatedAdmittedReport = {
  childDefinitionId: string
  taskId: string
  dispatchId: string
  reportDigest: string
  disposition: CoordinatedReportDisposition
  reason: string | null
  admittedAt: number
}

export type CoordinatedEffectStatus =
  | 'intent_recorded'
  | 'applied'
  | 'verified'
  | 'uncertain'
  | 'denied'

export type CoordinatedEffectEntry = {
  effectId: string
  childDefinitionId: string
  kind: string
  namespace?: string
  status: CoordinatedEffectStatus
  receipt: string | null
  /** Apply calls this ledger authorized; another is allowed only after a query proves `not_started`. */
  applyAuthorizations: number
  updatedAt: number
}

export type CoordinatedEscalationCode =
  | 'review_limit'
  | 'repeated_finding'
  | 'wall_clock_ceiling'
  | 'cost_ceiling'
  | 'start_failure_ceiling'
  | 'stage_rejected'
  | 'uncertain_effect'
  | 'effect_denied'
  | 'lock_unavailable'
  | 'artifact_mutated'
  | 'stage_timeout'
  | 'effect_reset_conflict'

export type CoordinatedEscalation = {
  /** Deterministic key; an escalation is recorded once per key. */
  key: string
  code: CoordinatedEscalationCode
  childDefinitionId: string | null
  detail: string
  requiresHumanDecision: boolean
  at: number
}

export type CoordinatedHaltState = 'failed' | 'blocked' | 'outcome_uncertain'

export type CoordinatedRunHalt = {
  state: CoordinatedHaltState
  reason: string
  at: number
}

/**
 * A host-recorded operator approval. The same record satisfies stage and parent acceptance
 * validation; its scope fields must name the exact run and, for stage scope, the exact
 * Task/Dispatch it approves.
 */
export type CoordinatedRunApproval = SemanticReceiptApproval & {
  scope: 'stage' | 'parent'
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
  targetChildId?: string
}

export type CoordinatedOperatorDecision = {
  kind: 'stop' | 'retry' | 'gate_resolution'
  at: number
  /** The authenticated local operator identity; never a worker author identity. */
  actor: string
  childDefinitionId: string | null
  dispatchId: string | null
  gateId: string | null
  /** Scope the gate decision was bound to; absent on records written before scopes existed. */
  gateScope?: 'stage' | 'parent' | 'escalation'
  decision: 'approve' | 'reject' | 'escalate' | null
  detail: string
}

/** Durable operator stop request; fences every further dispatch until exit evidence settles. */
export type CoordinatedOperatorStop = { at: number; reason: string | null }

export type CoordinatedRunProgress = {
  schemaVersion: 1
  automationId: string
  definitionRevision: number
  /** `<type>:<id>` of the frozen execution target that owns this run. */
  executionAuthority: string
  automationRunId: string
  orchestrationRunId: string
  /** Frozen snapshot digest; a ledger for another digest is never reused. */
  canonicalDigest: string
  /** Compare-and-swap counter for every durable write. */
  sequence: number
  /** Coordinator generation that owns writes; a replacement generation fences older ones. */
  generation: number
  startedAt: number
  spentCostUsd: number
  dispatchStartFailures: number
  stages: Record<string, CoordinatedStageProgress>
  reports: CoordinatedAdmittedReport[]
  effects: Record<string, CoordinatedEffectEntry>
  escalations: CoordinatedEscalation[]
  halt: CoordinatedRunHalt | null
  /** Operator approvals recorded through the gate-resolution authority. */
  approvals?: CoordinatedRunApproval[]
  /** Append-only audit of operator stop/retry/gate decisions. */
  operatorDecisions?: CoordinatedOperatorDecision[]
  /** Set once by the stop authority; idempotent replays do not rewrite it. */
  operatorStop?: CoordinatedOperatorStop | null
}
