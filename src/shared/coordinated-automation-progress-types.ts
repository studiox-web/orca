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

export type CoordinatedStageProgress = {
  status: CoordinatedStageStatus
  /** Dispatch the coordinator launched last for this stage. */
  activeDispatchId: string | null
  acceptedDispatchId: string | null
  acceptedReportDigest: string | null
  acceptedArtifacts: CoordinatedAcceptedArtifact[]
  /** Dispatches started for this stage across retries and fixes. */
  attempts: number
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

export type CoordinatedRunProgress = {
  schemaVersion: 1
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
}
