import { z } from 'zod'
import { isTuiAgent } from './tui-agent-config'
import {
  CHILD_LAUNCH_CONFIG_FIELDS,
  type AutomationKind,
  type ChildDependency,
  type ChildDependencyCondition,
  type ChildLaunchConfig,
  type ChildPromptSource,
  type CoordinatedAutomationCeilings,
  type CoordinatedAutomationInheritedDefaults,
  type CoordinatedAutomationPublicationPolicy,
  type CoordinatedAutomationRetentionPolicy,
  type MutationClass,
  type OutcomeAcceptanceCriterion,
  type OutcomeAcceptanceCriterionKind,
  type OutcomeRequiredApproval,
  type OverrideProvenance,
  type StageAcceptanceContract,
  type StageApprovalRequirement,
  type StageArtifactRequirement,
  type StageCheckRequirement,
  type StageEffectRequirement
} from './coordinated-automation-types'

export * from './coordinated-automation-receipt-schemas'
import { OutcomeFinalStateSchema } from './coordinated-automation-receipt-schemas'

export const AutomationKindSchema: z.ZodType<AutomationKind> = z.enum(['single', 'coordinated'])

export const OverrideProvenanceSchema: z.ZodType<OverrideProvenance> = z.enum([
  'inherited',
  'overridden'
])

export const MutationClassSchema: z.ZodType<MutationClass> = z.enum([
  'read_only',
  'exclusive_writer',
  'shared_writer'
])

export const ChildPromptSourceSchema: z.ZodType<ChildPromptSource> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inline'),
    text: z
      .string()
      .min(1, 'Inline prompt cannot be empty')
      .max(200_000, 'Inline prompt cannot exceed 200,000 characters')
  }),
  z.object({
    kind: z.literal('source_reference'),
    path: z.string().min(1, 'Source reference path cannot be empty').max(1024),
    authority: z.string().max(256).optional(),
    digest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, 'Source reference digest must be a valid sha256 hex digest')
      .optional()
  })
])

const TuiAgentParam = z.string().refine(isTuiAgent, {
  message: 'Unknown or unsupported agent'
})

const VALID_PROVENANCE_FIELDS = new Set<string>(CHILD_LAUNCH_CONFIG_FIELDS)

export const ChildLaunchConfigSchema: z.ZodType<ChildLaunchConfig> = z.object({
  agentId: TuiAgentParam.optional(),
  model: z.string().max(100).nullable().optional(),
  reasoningEffort: z.string().max(50).nullable().optional(),
  surface: z.enum(['chat', 'terminal']).optional(),
  extraAgentArgs: z.string().max(2000).optional(),
  reuseSession: z.boolean().optional(),
  workspaceMode: z.enum(['existing', 'new_per_run']).optional(),
  workspaceId: z.string().max(256).nullable().optional(),
  baseBranch: z.string().max(256).nullable().optional(),
  setupDecision: z.enum(['inherit', 'run', 'skip']).optional(),
  timeoutSeconds: z
    .number()
    .positive()
    .max(86400 * 7)
    .optional(),
  maxRetries: z.number().int().nonnegative().max(50).optional(),
  maxReviewIterations: z.number().int().nonnegative().max(50).optional(),
  provenance: z
    .record(z.string(), z.enum(['inherited', 'overridden']))
    .refine((rec) => Object.keys(rec).every((k) => VALID_PROVENANCE_FIELDS.has(k)), {
      message: 'Invalid provenance field: must be one of CHILD_LAUNCH_CONFIG_FIELDS'
    })
    .optional()
})

export const CoordinatedAutomationInheritedDefaultsSchema: z.ZodType<CoordinatedAutomationInheritedDefaults> =
  z.object({
    agentId: TuiAgentParam.optional(),
    model: z.string().max(100).nullable().optional(),
    reasoningEffort: z.string().max(50).nullable().optional(),
    surface: z.enum(['chat', 'terminal']).optional(),
    extraAgentArgs: z.string().max(2000).optional(),
    reuseSession: z.boolean().optional(),
    workspaceMode: z.enum(['existing', 'new_per_run']).optional(),
    workspaceId: z.string().max(256).nullable().optional(),
    baseBranch: z.string().max(256).nullable().optional(),
    setupDecision: z.enum(['inherit', 'run', 'skip']).optional(),
    timeoutSeconds: z
      .number()
      .positive()
      .max(86400 * 7)
      .optional(),
    maxRetries: z.number().int().nonnegative().max(50).optional(),
    maxReviewIterations: z.number().int().nonnegative().max(50).optional()
  })

export const StageArtifactRequirementSchema: z.ZodType<StageArtifactRequirement> = z.object({
  kind: z.string().trim().min(1, 'Artifact kind cannot be empty').max(100),
  pathPattern: z.string().max(1024).optional(),
  description: z.string().max(2000).optional(),
  required: z.boolean().optional()
})

export const StageCheckRequirementSchema: z.ZodType<StageCheckRequirement> = z.object({
  id: z.string().trim().min(1, 'Check ID cannot be empty').max(64),
  namespace: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  required: z.boolean().optional()
})

export const StageEffectRequirementSchema: z.ZodType<StageEffectRequirement> = z.object({
  kind: z.string().trim().min(1, 'Effect kind cannot be empty').max(100),
  namespace: z.string().max(100).optional(),
  allowedStatuses: z
    .array(z.enum(['applied', 'verified']))
    .min(1)
    .max(10),
  description: z.string().max(2000).optional(),
  required: z.boolean().optional()
})

export const StageApprovalRequirementSchema: z.ZodType<StageApprovalRequirement> = z.object({
  id: z.string().trim().min(1, 'Approval ID cannot be empty').max(64),
  role: z.string().trim().min(1, 'Approval role cannot be empty').max(100),
  disallowAuthorApproval: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  required: z.boolean().optional()
})

export const StageAcceptanceContractSchema: z.ZodType<StageAcceptanceContract> = z.object({
  criteria: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        description: z.string().trim().min(1).max(2000),
        required: z.boolean().optional()
      })
    )
    .max(100)
    .optional(),
  requiredArtifacts: z.array(StageArtifactRequirementSchema).max(50).optional(),
  requiredChecks: z.array(StageCheckRequirementSchema).max(50).optional(),
  requiredEffects: z.array(StageEffectRequirementSchema).max(50).optional(),
  requiredApprovals: z.array(StageApprovalRequirementSchema).max(50).optional()
})

export const ChildDependencyConditionSchema: z.ZodType<ChildDependencyCondition> = z.enum([
  'accepted',
  'completed'
])

export const ChildDependencySchema: z.ZodType<ChildDependency> = z.object({
  childId: z
    .string()
    .trim()
    .min(1, 'Dependency child ID cannot be empty')
    .max(64)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Dependency child ID must contain only alphanumeric characters, dashes, or underscores'
    ),
  condition: ChildDependencyConditionSchema.optional()
})

export const ForbiddenChildSchedule = z
  .never({
    message:
      'Child automations cannot have independent schedules; schedules belong solely to the parent Automation'
  })
  .optional()

/**
 * Validates a child definition and explicitly rejects any independent schedule properties.
 */
export const CoordinatedAutomationChildDefinitionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Child ID cannot be empty')
    .max(64, 'Child ID cannot exceed 64 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Child ID must contain only alphanumeric characters, dashes, or underscores'
    ),
  role: z.string().trim().min(1, 'Child role cannot be empty').max(100),
  name: z.string().trim().min(1, 'Child name cannot be empty').max(200),
  description: z.string().max(2000).optional(),
  promptSource: ChildPromptSourceSchema,
  dependencies: z.array(ChildDependencySchema).max(50),
  mutationClass: MutationClassSchema,
  mutationLane: z.string().max(100).optional(),
  launchConfig: ChildLaunchConfigSchema,
  stageAcceptance: StageAcceptanceContractSchema.optional(),
  resultSchema: z.record(z.string().max(100), z.unknown()).nullable().optional(),
  enabled: z.boolean(),
  schedule: ForbiddenChildSchedule,
  rrule: ForbiddenChildSchedule,
  cron: ForbiddenChildSchedule,
  dtstart: ForbiddenChildSchedule
})

export const OutcomeAcceptanceCriterionKindSchema: z.ZodType<OutcomeAcceptanceCriterionKind> =
  z.enum(['artifact', 'check', 'effect', 'approval', 'metric', 'custom'])

export const OutcomeAcceptanceCriterionSchema: z.ZodType<OutcomeAcceptanceCriterion> = z.object({
  id: z.string().trim().min(1, 'Criterion ID cannot be empty').max(64),
  description: z.string().trim().min(1, 'Criterion description cannot be empty').max(2000),
  required: z.boolean(),
  targetChildId: z.string().trim().max(64).optional(),
  kind: OutcomeAcceptanceCriterionKindSchema,
  namespace: z.string().max(100).optional(),
  details: z.record(z.string().max(100), z.unknown()).optional()
})

export const OutcomeRequiredApprovalSchema: z.ZodType<OutcomeRequiredApproval> = z.object({
  id: z.string().trim().min(1, 'Approval ID cannot be empty').max(64),
  role: z.string().trim().min(1, 'Approval role cannot be empty').max(100),
  description: z.string().max(2000).optional(),
  disallowAuthorApproval: z.boolean().optional(),
  targetChildId: z.string().trim().max(64).optional()
})

export const AutomationOutcomeContractSchema = z.object({
  humanStatement: z
    .string()
    .trim()
    .min(1, 'Outcome contract must contain a human statement')
    .max(10_000, 'Human statement exceeds maximum length of 10,000 characters'),
  acceptanceCriteria: z.array(OutcomeAcceptanceCriterionSchema).max(100),
  requiredApprovals: z.array(OutcomeRequiredApprovalSchema).max(50),
  allowedFinalStates: z
    .array(OutcomeFinalStateSchema)
    .min(1, 'At least one allowed final state is required')
    .max(20)
})

export const CoordinatedAutomationCeilingsSchema: z.ZodType<CoordinatedAutomationCeilings> =
  z.object({
    maxConcurrency: z.number().int().positive().max(100).optional(),
    maxActiveFixersPerArtifact: z.number().int().positive().max(50).optional(),
    maxReviewIterations: z.number().int().nonnegative().max(50).optional(),
    maxWallClockSeconds: z
      .number()
      .positive()
      .max(86400 * 7)
      .optional(),
    maxEstimatedCostUsd: z.number().nonnegative().max(100_000).optional(),
    maxDispatchStartFailures: z.number().int().positive().max(100).optional()
  })

export const CoordinatedAutomationPublicationPolicySchema: z.ZodType<CoordinatedAutomationPublicationPolicy> =
  z.object({
    allowExternalMutation: z.boolean(),
    allowedFinalStates: z.array(OutcomeFinalStateSchema).min(1).max(20),
    requireHumanDecisionForProduction: z.boolean()
  })

export const CoordinatedAutomationRetentionPolicySchema: z.ZodType<CoordinatedAutomationRetentionPolicy> =
  z.object({
    preserveCompletionReceipt: z.boolean(),
    preserveSnapshot: z.boolean().optional(),
    preserveMappings: z.boolean().optional(),
    minimumEvidenceReferences: z.array(z.string().max(512)).max(100).optional(),
    artifactRetentionDays: z.number().int().positive().max(3650).optional(),
    defaultRetentionClass: z.enum(['transient', 'run', 'audit', 'pinned']).optional()
  })

export const CoordinatedAutomationDefinitionSchema = z.object({
  kind: z.literal('coordinated'),
  definitionRevision: z.number().int().positive('Definition revision must be a positive integer'),
  outcomeContract: AutomationOutcomeContractSchema,
  children: z
    .array(CoordinatedAutomationChildDefinitionSchema)
    .min(1, 'At least one child automation definition is required')
    .max(100),
  inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
  globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
  publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
  retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
})
