import type { ArtifactRetentionClass, OutcomeFinalState } from './coordinated-automation-types'
import type { CoordinatedRunChildMapping } from './coordinated-automation-saga-types'

export type StructuredWorkerArtifact = {
  kind: string
  uri: string
  authority?: string
  sha256?: string
  retentionClass?: ArtifactRetentionClass
  producerAttempt?: { taskId: string; dispatchId: string }
  metadata?: Record<string, unknown>
}

export type StructuredWorkerCheck = {
  id: string
  outcome: 'passed' | 'failed' | 'warning'
  namespace?: string
  evidence?: string[]
}

export type StructuredWorkerEffect = {
  kind: string
  status: 'not_started' | 'applied' | 'verified' | 'uncertain' | 'denied'
  namespace?: string
  receipt?: string
  error?: string
}

export type StructuredWorkerBlocker = {
  code: string
  message: string
  resolvableBy?: 'retry' | 'human_action' | 'upstream_fix'
}

export type StructuredWorkerResultOutcome = 'succeeded' | 'failed' | 'blocked' | 'uncertain'

/**
 * Common envelope returned by workers reporting structured results.
 */
export type StructuredWorkerResult = {
  schemaVersion: 1
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
  definitionRevision: number
  resolvedConfigDigest: string
  outcome: StructuredWorkerResultOutcome
  summary: string
  artifacts: StructuredWorkerArtifact[]
  checks: StructuredWorkerCheck[]
  effects: StructuredWorkerEffect[]
  blockers: StructuredWorkerBlocker[]
  reportMarkdown: string
}

export type SemanticReceiptIdentityChain = {
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  hostId: string
  /** Exact `<type>:<executionTargetId>` authority, e.g. `local:local-1` or `ssh:prod`. */
  targetExecutionAuthority: string
  /** The coordinator attempt that produced this receipt. */
  activeAttempt: { taskId: string; dispatchId: string }
  /** One mapping per enabled resolved child; must equal the host-persisted mappings exactly. */
  taskMappings: CoordinatedRunChildMapping[]
}

export type SemanticReceiptWaiver = {
  authorizedBy: string
  reason?: string
  waivedAt?: number
}

export type SemanticReceiptAcceptanceResult = {
  criterionId: string
  status: 'satisfied' | 'failed' | 'waived'
  evidence: string[]
  evaluatedAt: number
  waiver?: SemanticReceiptWaiver
}

export type TrustedWaiverAuthority = {
  identity: string
  role: string
}

export type TrustedProductionDecision = {
  approverIdentity: string
  role: string
  decidedAt: number
}

/**
 * Host-owned facts the receipt is checked against. Nothing here may be sourced from the
 * receipt itself; validation never falls back to receipt-supplied identity or authority.
 */
export type ReceiptValidationContext = {
  trustedAuthorIdentity: string
  trustedHostId: string
  trustedExecutionAuthority: string
  automationRunId: string
  orchestrationRunId: string
  activeAttempt: {
    taskId: string
    dispatchId: string
  }
  trustedTaskMappings: readonly CoordinatedRunChildMapping[]
  /** Absent means no waiver is acceptable. */
  waiverPolicy?: {
    allowedRoles: readonly string[]
    authorities: readonly TrustedWaiverAuthority[]
  }
  /** Required for published_verified when requireHumanDecisionForProduction is true. */
  productionDecision?: TrustedProductionDecision
}

export type SemanticReceiptApproval = {
  approvalId: string
  role: string
  approverIdentity: string
  authorIdentity?: string
  approvedAt: number
  evidence?: string
}

export type SemanticReceiptEffect = {
  kind: string
  namespace?: string
  status: 'verified' | 'applied' | 'denied' | 'uncertain'
  receipt: string
  verifiedAt: number
}

export type SemanticReceiptWarning = {
  code: string
  message: string
}

/**
 * Persisted proof that an intended parent outcome passed acceptance.
 */
export type SemanticCompletionReceipt = {
  schemaVersion: 1
  identityChain: SemanticReceiptIdentityChain
  frozenConfigDigest: string
  finalState: OutcomeFinalState
  completedAt: number
  selectedOutcomeItemIdentity?: string
  acceptanceResults: SemanticReceiptAcceptanceResult[]
  approvals: SemanticReceiptApproval[]
  effectReceipts: SemanticReceiptEffect[]
  unresolvedWarnings: SemanticReceiptWarning[]
}

export type StageAcceptanceStatus =
  | 'pending'
  | 'evaluating'
  | 'accepted'
  | 'revision_requested'
  | 'rejected'
  | 'waived'

export type StageAcceptanceRecord = {
  automationRunId: string
  orchestrationRunId: string
  definitionRevision: number
  resolvedConfigDigest: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
  status: StageAcceptanceStatus
  workerReportOutcome?: StructuredWorkerResultOutcome
  evaluatedAt: number
  acceptanceEvidence: string[]
  unmetCriteria?: string[]
}
