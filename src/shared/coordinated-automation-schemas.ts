import { z } from 'zod'
import { isTuiAgent } from './tui-agent-config'
import type {
  AutomationKind,
  ChildDependency,
  ChildDependencyCondition,
  ChildLaunchConfig,
  ChildPromptSource,
  CoordinatedAutomationCeilings,
  CoordinatedAutomationInheritedDefaults,
  CoordinatedAutomationPublicationPolicy,
  CoordinatedAutomationRetentionPolicy,
  MutationClass,
  OutcomeAcceptanceCriterion,
  OutcomeAcceptanceCriterionKind,
  OutcomeRequiredApproval,
  OverrideProvenance,
  StageAcceptanceContract,
  StageApprovalRequirement,
  StageArtifactRequirement,
  StageCheckRequirement,
  StageEffectRequirement
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
    text: z.string()
  }),
  z.object({
    kind: z.literal('source_reference'),
    path: z.string().min(1, 'Source reference path cannot be empty'),
    authority: z.string().optional(),
    digest: z.string().optional()
  })
])

const TuiAgentParam = z.string().refine(isTuiAgent, {
  message: 'Unknown or unsupported agent'
})

export const ChildLaunchConfigSchema: z.ZodType<ChildLaunchConfig> = z.object({
  agentId: TuiAgentParam.optional(),
  model: z.string().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  surface: z.enum(['chat', 'terminal']).optional(),
  extraAgentArgs: z.string().optional(),
  reuseSession: z.boolean().optional(),
  workspaceMode: z.enum(['existing', 'new_per_run']).optional(),
  workspaceId: z.string().nullable().optional(),
  baseBranch: z.string().nullable().optional(),
  setupDecision: z.enum(['inherit', 'run', 'skip']).optional(),
  timeoutSeconds: z.number().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  maxReviewIterations: z.number().int().nonnegative().optional(),
  provenance: z.record(z.string(), z.enum(['inherited', 'overridden'])).optional()
})

export const CoordinatedAutomationInheritedDefaultsSchema: z.ZodType<CoordinatedAutomationInheritedDefaults> =
  z.object({
    agentId: TuiAgentParam.optional(),
    model: z.string().nullable().optional(),
    reasoningEffort: z.string().nullable().optional(),
    surface: z.enum(['chat', 'terminal']).optional(),
    extraAgentArgs: z.string().optional(),
    reuseSession: z.boolean().optional(),
    workspaceMode: z.enum(['existing', 'new_per_run']).optional(),
    workspaceId: z.string().nullable().optional(),
    baseBranch: z.string().nullable().optional(),
    setupDecision: z.enum(['inherit', 'run', 'skip']).optional(),
    timeoutSeconds: z.number().positive().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    maxReviewIterations: z.number().int().nonnegative().optional()
  })

export const StageArtifactRequirementSchema: z.ZodType<StageArtifactRequirement> = z.object({
  kind: z.string().min(1, 'Artifact kind cannot be empty'),
  pathPattern: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional()
})

export const StageCheckRequirementSchema: z.ZodType<StageCheckRequirement> = z.object({
  id: z.string().min(1, 'Check ID cannot be empty'),
  description: z.string().optional(),
  required: z.boolean().optional()
})

export const StageEffectRequirementSchema: z.ZodType<StageEffectRequirement> = z.object({
  kind: z.string().min(1, 'Effect kind cannot be empty'),
  allowedStatuses: z.array(z.enum(['applied', 'verified'])).min(1),
  description: z.string().optional(),
  required: z.boolean().optional()
})

export const StageApprovalRequirementSchema: z.ZodType<StageApprovalRequirement> = z.object({
  id: z.string().min(1, 'Approval ID cannot be empty'),
  role: z.string().min(1, 'Approval role cannot be empty'),
  disallowAuthorApproval: z.boolean().optional(),
  description: z.string().optional(),
  required: z.boolean().optional()
})

export const StageAcceptanceContractSchema: z.ZodType<StageAcceptanceContract> = z.object({
  criteria: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        required: z.boolean().optional()
      })
    )
    .optional(),
  requiredArtifacts: z.array(StageArtifactRequirementSchema).optional(),
  requiredChecks: z.array(StageCheckRequirementSchema).optional(),
  requiredEffects: z.array(StageEffectRequirementSchema).optional(),
  requiredApprovals: z.array(StageApprovalRequirementSchema).optional()
})

export const ChildDependencyConditionSchema: z.ZodType<ChildDependencyCondition> = z.enum([
  'accepted',
  'completed'
])

export const ChildDependencySchema: z.ZodType<ChildDependency> = z.object({
  childId: z.string().min(1, 'Dependency child ID cannot be empty'),
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
export const CoordinatedAutomationChildDefinitionSchema = z
  .object({
    id: z.string().min(1, 'Child ID cannot be empty'),
    role: z.string().min(1, 'Child role cannot be empty'),
    name: z.string().min(1, 'Child name cannot be empty'),
    description: z.string().optional(),
    promptSource: ChildPromptSourceSchema,
    dependencies: z.array(ChildDependencySchema),
    mutationClass: MutationClassSchema,
    mutationLane: z.string().optional(),
    launchConfig: ChildLaunchConfigSchema,
    stageAcceptance: StageAcceptanceContractSchema.optional(),
    resultSchema: z.record(z.string(), z.unknown()).nullable().optional(),
    enabled: z.boolean(),
    schedule: ForbiddenChildSchedule,
    rrule: ForbiddenChildSchedule,
    cron: ForbiddenChildSchedule,
    dtstart: ForbiddenChildSchedule
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const hasForbiddenSchedule =
      'schedule' in val || 'rrule' in val || 'cron' in val || 'dtstart' in val
    if (hasForbiddenSchedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Child automations cannot have independent schedules; schedules belong solely to the parent Automation'
      })
    }
  })

export const OutcomeAcceptanceCriterionKindSchema: z.ZodType<OutcomeAcceptanceCriterionKind> =
  z.enum(['artifact', 'check', 'effect', 'approval', 'metric', 'custom'])

export const OutcomeAcceptanceCriterionSchema: z.ZodType<OutcomeAcceptanceCriterion> = z.object({
  id: z.string().min(1, 'Criterion ID cannot be empty'),
  description: z.string().min(1, 'Criterion description cannot be empty'),
  required: z.boolean(),
  targetChildId: z.string().optional(),
  kind: OutcomeAcceptanceCriterionKindSchema
})

export const OutcomeRequiredApprovalSchema: z.ZodType<OutcomeRequiredApproval> = z.object({
  id: z.string().min(1, 'Approval ID cannot be empty'),
  role: z.string().min(1, 'Approval role cannot be empty'),
  description: z.string().optional(),
  disallowAuthorApproval: z.boolean().optional(),
  targetChildId: z.string().optional()
})

export const AutomationOutcomeContractSchema = z.object({
  humanStatement: z.string().min(1, 'Outcome contract must contain a human statement'),
  acceptanceCriteria: z.array(OutcomeAcceptanceCriterionSchema),
  requiredApprovals: z.array(OutcomeRequiredApprovalSchema),
  allowedFinalStates: z
    .array(OutcomeFinalStateSchema)
    .min(1, 'At least one allowed final state is required')
})

export const CoordinatedAutomationCeilingsSchema: z.ZodType<CoordinatedAutomationCeilings> =
  z.object({
    maxConcurrency: z.number().int().positive().optional(),
    maxActiveFixersPerArtifact: z.number().int().positive().optional(),
    maxReviewIterations: z.number().int().nonnegative().optional(),
    maxWallClockSeconds: z.number().positive().optional(),
    maxEstimatedCostUsd: z.number().nonnegative().optional(),
    maxDispatchStartFailures: z.number().int().positive().optional()
  })

export const CoordinatedAutomationPublicationPolicySchema: z.ZodType<CoordinatedAutomationPublicationPolicy> =
  z.object({
    allowExternalMutation: z.boolean(),
    allowedFinalStates: z.array(OutcomeFinalStateSchema),
    requireHumanDecisionForProduction: z.boolean()
  })

export const CoordinatedAutomationRetentionPolicySchema: z.ZodType<CoordinatedAutomationRetentionPolicy> =
  z.object({
    preserveCompletionReceipt: z.boolean(),
    preserveSnapshot: z.boolean().optional(),
    preserveMappings: z.boolean().optional(),
    minimumEvidenceReferences: z.array(z.string()).optional(),
    artifactRetentionDays: z.number().int().positive().optional()
  })

export const CoordinatedAutomationDefinitionSchema = z.object({
  kind: z.literal('coordinated'),
  definitionRevision: z.number().int().positive('Definition revision must be a positive integer'),
  outcomeContract: AutomationOutcomeContractSchema,
  children: z.array(CoordinatedAutomationChildDefinitionSchema),
  inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
  globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
  publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
  retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
})
