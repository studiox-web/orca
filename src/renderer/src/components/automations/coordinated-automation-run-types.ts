import type {
  AutomationExecutionTargetType,
  AutomationOutcomeContract,
  AutomationRunStatus,
  ChildDependency,
  CoordinatedCompletionTrust,
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence,
  MutationClass,
  OutcomeFinalState,
  ResolvedAutomationRunSnapshot,
  ResolvedChildLaunchConfig,
  SemanticCompletionReceipt,
  StageAcceptanceRecord,
  StageAcceptanceStatus,
  StageApprovalRequirement,
  StageArtifactRequirement,
  StageCheckRequirement,
  StructuredWorkerArtifact,
  StructuredWorkerBlocker,
  StructuredWorkerCheck,
  StructuredWorkerEffect,
  StructuredWorkerResult,
  StructuredWorkerResultOutcome
} from '../../../../shared/automations-types'
import type {
  OrchestrationCrewRow,
  OrchestrationCrewSnapshot
} from '../../../../shared/orchestration-crew'

export type CoordinatedStageExecutionStatus =
  | 'unknown'
  | 'ready'
  | 'queued'
  | 'active'
  | 'waiting_for_approval'
  | 'blocked'
  | 'accepted'
  | 'superseded'
  | 'failed'
  | 'uncertain'
  | 'skipped'

export type CoordinatedAttemptTechnicalStatus =
  | 'queued'
  | 'starting'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'superseded'
  | 'outcome_unknown'
  | 'finished_unverified'

export type CoordinatedParentSemanticState =
  | OutcomeFinalState
  | 'waiting_for_approval'
  | 'in_progress'
  | 'pending'
  | 'quarantined'
  | 'unaccepted'

export type FrozenStageSource = {
  childDefinitionId: string
  name: string
  role: string
  enabled: boolean
  dependencies: readonly ChildDependency[]
  mutationClass: MutationClass
  mutationLane: string | null
  launchConfig: Partial<ResolvedChildLaunchConfig>
  promptSummary: {
    kind: 'inline' | 'source_reference'
    text: string
    path?: string
    digest?: string
  } | null
  requiredArtifacts: readonly StageArtifactRequirement[]
  requiredChecks: readonly StageCheckRequirement[]
  requiredApprovals: readonly StageApprovalRequirement[]
}

export type CoordinatedDispatchAttemptObservation = {
  dispatchId: string
  taskId: string
  childDefinitionId: string
  attemptNumber?: number
  retryOfDispatchId?: string | null
  technicalStatus: CoordinatedAttemptTechnicalStatus
  workerReportOutcome?: StructuredWorkerResultOutcome | null
  structuredResult?: StructuredWorkerResult | null
  stageAcceptance?: StageAcceptanceRecord | null
  startedAt?: number | null
  completedAt?: number | null
  durationSeconds?: number | null
  estimatedCostUsd?: number | null
  totalTokens?: number | null
  reviewIteration?: number | null
  crewRow?: OrchestrationCrewRow | null
  openTarget?: OrchestrationCrewRow['openTarget'] | null
  ownerLabel?: string | null
  agentKind?: string | null
  hostLabel?: string | null
  latestActivity?: { preview: string; at: string; direction?: 'to' | 'from' } | null
  pendingQuestion?: { preview: string; at: string } | null
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

export type OccupiedMutationLaneObservation = {
  lane: string
  mutationClass: MutationClass
  holderTaskId: string
  holderChildId: string
  holderChildName: string
  waitingTaskIds: readonly string[]
  lockEvidence?: string | null
}

export type CoordinatedRunLiveObservation = {
  attempts?: readonly CoordinatedDispatchAttemptObservation[]
  stageAcceptances?: readonly StageAcceptanceRecord[]
  stageApprovals?: readonly CoordinatedApprovalObservation[]
  parentApprovals?: readonly CoordinatedApprovalObservation[]
  crewSnapshot?: OrchestrationCrewSnapshot | null
  activeFixersCount?: number
  dispatchStartFailuresCount?: number
  elapsedWallClockSeconds?: number | null
  occupiedMutationLanes?: readonly OccupiedMutationLaneObservation[]
  skippedStages?: Readonly<Record<string, string>>
}

export type CoordinatedRunActionAvailability = { supported: boolean; reason: string | null }

export type StopCoordinatedRunInput = {
  automationId: string
  automationRunId: string
  orchestrationRunId: string | null
  definitionRevision: number
  targetExecutionAuthority: string
}

export type RetryCoordinatedStageInput = {
  automationId: string
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  retryOfDispatchId: string
  definitionRevision: number
  targetExecutionAuthority: string
}

export type ResolveCoordinatedGateInput = {
  automationId: string
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
  gateId: string
  decision: 'approve' | 'reject' | 'escalate'
  note?: string
  targetExecutionAuthority: string
}

export type CoordinatedRunOperatorActions = {
  stopRun?: {
    availability: CoordinatedRunActionAvailability
    onStopRun?: (input: StopCoordinatedRunInput) => void | Promise<void>
  }
  retryStage?: {
    availability: CoordinatedRunActionAvailability
    onRetryStage?: (input: RetryCoordinatedStageInput) => void | Promise<void>
  }
  resolveGate?: {
    availability: CoordinatedRunActionAvailability
    onResolveGate?: (input: ResolveCoordinatedGateInput) => void | Promise<void>
  }
}

export type ProjectedCoordinatedAttempt = {
  dispatchId: string
  taskId: string
  childDefinitionId: string
  attemptNumber: number
  retryOfDispatchId: string | null
  isActive: boolean
  technicalStatus: CoordinatedAttemptTechnicalStatus
  workerReportOutcome: StructuredWorkerResultOutcome | null
  semanticAcceptanceStatus: StageAcceptanceStatus | 'unverified'
  summary: string | null
  ownerLabel: string
  agentKind: string
  hostLabel: string | null
  crewRow: OrchestrationCrewRow | null
  canOpenWorker: boolean
  openWorkerUnavailableReason: string | null
  latestActivity: { preview: string; at: string; direction?: 'to' | 'from' } | null
  pendingQuestion: { preview: string; at: string } | null
  artifacts: readonly StructuredWorkerArtifact[]
  checks: readonly StructuredWorkerCheck[]
  effects: readonly StructuredWorkerEffect[]
  blockers: readonly StructuredWorkerBlocker[]
  durationSeconds: number | null
  estimatedCostUsd: number | null
  totalTokens: number | null
  reviewIteration: number | null
}

export type ChildDefinitionDriftState = 'unchanged' | 'renamed' | 'tombstoned'

export type ProjectedCoordinatedStage = {
  childDefinitionId: string
  name: string
  role: string
  definitionDrift: ChildDefinitionDriftState
  currentDefinitionName: string | null
  tombstonedInRevision: number | null
  enabledInSnapshot: boolean
  taskId: string | null
  activeDispatchId: string | null
  dependencies: readonly ChildDependency[]
  mutationClass: MutationClass
  mutationLane: string | null
  launchConfig: Partial<ResolvedChildLaunchConfig>
  promptSummary: FrozenStageSource['promptSummary']
  stageExecutionStatus: CoordinatedStageExecutionStatus
  skippedReason: string | null
  technicalStatusLabel: string
  semanticAcceptanceStatus: StageAcceptanceStatus | 'unverified'
  acceptanceEvidence: readonly string[]
  unmetCriteria: readonly string[]
  attempts: readonly ProjectedCoordinatedAttempt[]
  activeAttempt: ProjectedCoordinatedAttempt | null
  supersededAttemptsCount: number
  artifacts: readonly StructuredWorkerArtifact[]
  requiredArtifacts: readonly StageArtifactRequirement[]
  checks: readonly StructuredWorkerCheck[]
  requiredChecks: readonly StageCheckRequirement[]
  effects: readonly StructuredWorkerEffect[]
  blockers: readonly StructuredWorkerBlocker[]
  approvals: readonly CoordinatedApprovalObservation[]
  pendingQuestion: { preview: string; at: string } | null
  hasUncertainEffect: boolean
  durationSeconds: number | null
  estimatedCostUsd: number | null
  totalTokens: number | null
  reviewIteration: number | null
  maxReviewIterations: number | null
  maxRetries: number | null
  timeoutSeconds: number | null
  retryEligibility: { canRetry: boolean; reason: string | null; retryOfDispatchId: string | null }
  gateResolutionEligibility: {
    canResolve: boolean
    reason: string | null
    pendingGateId: string | null
  }
}

export type {
  AutomationExecutionTargetType,
  AutomationOutcomeContract,
  AutomationRunStatus,
  CoordinatedCompletionTrust,
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence,
  OutcomeFinalState,
  ResolvedAutomationRunSnapshot,
  SemanticCompletionReceipt
}
