import type { AutomationExecutionTargetType, AutomationWorkspaceMode } from './automations-types'
import type { SetupDecision } from './worktree/create-types'
import type { TuiAgent } from './tui-agent'
import type {
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase
} from './coordinated-automation-saga-types'
import type { SemanticCompletionReceipt } from './coordinated-automation-receipt-types'
import type {
  CoordinatedCompletionTrust,
  CoordinatedRunQuarantine,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence
} from './coordinated-automation-run-integrity-types'

export type {
  CoordinatedCompletionTrust,
  CoordinatedRunQuarantine,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence
}

export type AutomationKind = 'single' | 'coordinated'

export function isCoordinatedAutomation(automation: { kind?: AutomationKind }): boolean {
  return automation.kind === 'coordinated'
}

export function isSingleAutomation(automation: { kind?: AutomationKind }): boolean {
  return automation.kind !== 'coordinated'
}

export type CoordinatedAutomationDefinitionFields = {
  kind?: AutomationKind
  definitionRevision?: number
  outcomeContract?: AutomationOutcomeContract
  children?: CoordinatedAutomationChildDefinition[]
  inheritedDefaults?: CoordinatedAutomationInheritedDefaults
  globalCeilings?: CoordinatedAutomationCeilings
  publicationPolicy?: CoordinatedAutomationPublicationPolicy
  retentionPolicy?: CoordinatedAutomationRetentionPolicy
  /** Host-managed: children removed by later revisions; their IDs are never reissued. */
  childTombstones?: CoordinatedChildTombstone[]
  /** Host-managed digest of every input snapshot resolution reads at `definitionRevision`. */
  definitionFingerprint?: string
}

export type CoordinatedChildTombstone = {
  childDefinitionId: string
  name: string
  role: string
  lastDefinitionRevision: number
  removedInRevision: number
  removedAt: number
}

export type CoordinatedRunFields = {
  automationDefinitionRevision: number
  orchestrationRunId: string | null
  resolvedSnapshot: ResolvedAutomationRunSnapshot | null
  completionReceipt: SemanticCompletionReceipt | null
  replanOfAutomationRunId: string | null
  replanOfDefinitionRevision: number | null
  replanReason: string | null
  materializationPhase: CoordinatedRunMaterializationPhase
  childMappings: CoordinatedRunChildMapping[]
  /** Occurrence identity; a second delivery with the same key returns the existing run. */
  idempotencyKey?: string
  materializationError?: string | null
  retainedEvidence?: CoordinatedRunRetainedEvidence
  /**
   * Host-owned acceptance facts a stored receipt is validated against (written only by the
   * acceptance phase, never taken from the receipt). Present exactly when a receipt is.
   */
  completionTrust?: CoordinatedCompletionTrust | null
  /**
   * Set on reload when stored coordinated fields failed validation; the row is inert. The
   * store keeps the full record; list/get callers only ever see the summary.
   */
  coordinatedQuarantine?: CoordinatedRunQuarantine | CoordinatedRunQuarantineSummary
}

export type OverrideProvenance = 'inherited' | 'overridden'

export type MutationClass = 'read_only' | 'exclusive_writer' | 'shared_writer'

export type ChildPromptSource =
  | { kind: 'inline'; text: string }
  | {
      kind: 'source_reference'
      path: string
      authority?: string
      digest?: string
    }

export const CHILD_LAUNCH_CONFIG_FIELDS = [
  'agentId',
  'model',
  'reasoningEffort',
  'surface',
  'extraAgentArgs',
  'reuseSession',
  'workspaceMode',
  'workspaceId',
  'baseBranch',
  'setupDecision',
  'timeoutSeconds',
  'maxRetries',
  'maxReviewIterations'
] as const

export type ChildLaunchConfigField = (typeof CHILD_LAUNCH_CONFIG_FIELDS)[number]

export type ChildLaunchConfig = {
  agentId?: TuiAgent
  model?: string | null
  reasoningEffort?: string | null
  surface?: 'chat' | 'terminal'
  extraAgentArgs?: string
  reuseSession?: boolean
  workspaceMode?: AutomationWorkspaceMode
  workspaceId?: string | null
  baseBranch?: string | null
  setupDecision?: SetupDecision
  timeoutSeconds?: number
  maxRetries?: number
  maxReviewIterations?: number
  provenance?: Partial<Record<ChildLaunchConfigField, OverrideProvenance>>
}

export type CoordinatedAutomationInheritedDefaults = {
  agentId?: TuiAgent
  model?: string | null
  reasoningEffort?: string | null
  surface?: 'chat' | 'terminal'
  extraAgentArgs?: string
  reuseSession?: boolean
  workspaceMode?: AutomationWorkspaceMode
  workspaceId?: string | null
  baseBranch?: string | null
  setupDecision?: SetupDecision
  timeoutSeconds?: number
  maxRetries?: number
  maxReviewIterations?: number
}

export type StageArtifactRequirement = {
  kind: string
  pathPattern?: string
  description?: string
  required?: boolean
}

export type StageCheckRequirement = {
  id: string
  namespace?: string
  description?: string
  required?: boolean
}

export type StageEffectRequirement = {
  kind: string
  namespace?: string
  allowedStatuses: ('applied' | 'verified')[]
  description?: string
  required?: boolean
}

export type StageApprovalRequirement = {
  id: string
  role: string
  disallowAuthorApproval?: boolean
  description?: string
  required?: boolean
}

export type StageAcceptanceContract = {
  criteria?: { id: string; description: string; required?: boolean }[]
  requiredArtifacts?: StageArtifactRequirement[]
  requiredChecks?: StageCheckRequirement[]
  requiredEffects?: StageEffectRequirement[]
  requiredApprovals?: StageApprovalRequirement[]
}

export type ChildDependencyCondition = 'accepted' | 'completed'

export type ChildDependency = {
  childId: string
  condition?: ChildDependencyCondition
}

export type CoordinatedAutomationChildDefinition = {
  id: string
  role: string
  name: string
  description?: string
  promptSource: ChildPromptSource
  dependencies: ChildDependency[]
  mutationClass: MutationClass
  mutationLane?: string
  launchConfig: ChildLaunchConfig
  stageAcceptance?: StageAcceptanceContract
  resultSchema?: Record<string, unknown> | null
  enabled: boolean
  schedule?: never
  rrule?: never
  cron?: never
  dtstart?: never
}

export type OutcomeAcceptanceCriterionKind =
  | 'artifact'
  | 'check'
  | 'effect'
  | 'approval'
  | 'metric'
  | 'custom'

export type OutcomeAcceptanceCriterion = {
  id: string
  description: string
  required: boolean
  targetChildId?: string
  kind: OutcomeAcceptanceCriterionKind
  namespace?: string
  details?: Record<string, unknown>
}

export type OutcomeRequiredApproval = {
  id: string
  role: string
  description?: string
  disallowAuthorApproval?: boolean
  targetChildId?: string
}

export type OutcomeFinalState =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'outcome_uncertain'
  | 'ready_for_review'
  | 'ready_to_publish'
  | 'published_verified'

export type AutomationOutcomeContract = {
  humanStatement: string
  acceptanceCriteria: OutcomeAcceptanceCriterion[]
  requiredApprovals: OutcomeRequiredApproval[]
  allowedFinalStates: OutcomeFinalState[]
}

export type CoordinatedAutomationCeilings = {
  maxConcurrency?: number
  maxActiveFixersPerArtifact?: number
  maxReviewIterations?: number
  maxWallClockSeconds?: number
  maxEstimatedCostUsd?: number
  maxDispatchStartFailures?: number
}

export type CoordinatedAutomationPublicationPolicy = {
  allowExternalMutation: boolean
  allowedFinalStates: OutcomeFinalState[]
  requireHumanDecisionForProduction: boolean
}

export type ArtifactRetentionClass = 'transient' | 'run' | 'audit' | 'pinned'

export type CoordinatedAutomationRetentionPolicy = {
  preserveCompletionReceipt: boolean
  preserveSnapshot?: boolean
  preserveMappings?: boolean
  minimumEvidenceReferences?: string[]
  artifactRetentionDays?: number
  defaultRetentionClass?: ArtifactRetentionClass
}

export type CoordinatedAutomationDefinition = {
  kind: 'coordinated'
  definitionRevision: number
  outcomeContract: AutomationOutcomeContract
  children: CoordinatedAutomationChildDefinition[]
  inheritedDefaults?: CoordinatedAutomationInheritedDefaults
  globalCeilings?: CoordinatedAutomationCeilings
  publicationPolicy?: CoordinatedAutomationPublicationPolicy
  retentionPolicy?: CoordinatedAutomationRetentionPolicy
}

export type ResolvedPrompt = {
  kind: 'inline' | 'source_reference'
  text: string
  digest: string
  path?: string
  authority?: string
}

export type ResolvedChildLaunchConfig = {
  agentId: TuiAgent
  model: string | null
  reasoningEffort: string | null
  surface: 'chat' | 'terminal'
  extraAgentArgs: string
  reuseSession: boolean
  workspaceMode: AutomationWorkspaceMode
  workspaceId: string | null
  baseBranch: string | null
  setupDecision: SetupDecision
  timeoutSeconds: number
  maxRetries: number
  maxReviewIterations: number
}

export type ResolvedChildSnapshot = {
  childDefinitionId: string
  role: string
  name: string
  prompt: ResolvedPrompt
  launchConfig: ResolvedChildLaunchConfig
  provenance: Record<ChildLaunchConfigField, OverrideProvenance>
  dependencies: ChildDependency[]
  mutationClass: MutationClass
  mutationLane?: string
  stageAcceptance?: StageAcceptanceContract
  resultSchema?: Record<string, unknown> | null
  enabled: boolean
}

export type ResolvedAutomationRunSnapshot = {
  automationId: string
  definitionRevision: number
  createdAt: number
  outcomeContract: AutomationOutcomeContract
  resolvedChildren: ResolvedChildSnapshot[]
  executionTarget: {
    type: AutomationExecutionTargetType
    id: string
    generation?: number
  }
  inheritedDefaults: ResolvedChildLaunchConfig
  globalCeilings: CoordinatedAutomationCeilings
  publicationPolicy: CoordinatedAutomationPublicationPolicy
  retentionPolicy: CoordinatedAutomationRetentionPolicy
  canonicalDigest: string
}
