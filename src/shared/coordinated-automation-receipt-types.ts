import type { OutcomeFinalState } from './coordinated-automation-types'

export type StructuredWorkerArtifact = {
  kind: string
  uri: string
  authority?: string
  sha256?: string
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
}

export type SemanticReceiptAcceptanceResult = {
  criterionId: string
  status: 'satisfied' | 'failed' | 'waived'
  evidence: string[]
  evaluatedAt: number
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
  childDefinitionId: string
  taskId: string
  dispatchId: string
  status: StageAcceptanceStatus
  workerReportOutcome?: StructuredWorkerResultOutcome
  evaluatedAt: number
  acceptanceEvidence: string[]
  unmetCriteria?: string[]
}
