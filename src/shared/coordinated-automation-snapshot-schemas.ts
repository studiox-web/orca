import { z } from 'zod'
import {
  CHILD_LAUNCH_CONFIG_FIELDS,
  type CoordinatedRunFields,
  type ResolvedAutomationRunSnapshot,
  type ResolvedChildLaunchConfig,
  type ResolvedChildSnapshot,
  type ResolvedPrompt
} from './coordinated-automation-types'
import {
  AutomationOutcomeContractSchema,
  ChildDependencySchema,
  CoordinatedAutomationCeilingsSchema,
  CoordinatedAutomationPublicationPolicySchema,
  CoordinatedAutomationRetentionPolicySchema,
  MutationClassSchema,
  StageAcceptanceContractSchema
} from './coordinated-automation-schemas'
import {
  CoordinatedRunChildMappingSchema,
  CoordinatedRunMaterializationPhaseSchema,
  SemanticCompletionReceiptSchema
} from './coordinated-automation-receipt-schemas'
import { isTuiAgent } from './tui-agent-config'

const TuiAgentParam = z.string().refine(isTuiAgent, {
  message: 'Unknown or unsupported agent'
})

export const ResolvedPromptSchema: z.ZodType<ResolvedPrompt> = z.object({
  kind: z.enum(['inline', 'source_reference']),
  text: z.string().max(200_000),
  digest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'Resolved prompt digest must be a valid sha256 hex digest'),
  path: z.string().max(1024).optional(),
  authority: z.string().max(256).optional()
})

export const ResolvedChildLaunchConfigSchema: z.ZodType<ResolvedChildLaunchConfig> = z.object({
  agentId: TuiAgentParam,
  model: z.string().max(100).nullable(),
  reasoningEffort: z.string().max(50).nullable(),
  surface: z.enum(['chat', 'terminal']),
  extraAgentArgs: z.string().max(2000),
  reuseSession: z.boolean(),
  workspaceMode: z.enum(['existing', 'new_per_run']),
  workspaceId: z.string().max(256).nullable(),
  baseBranch: z.string().max(256).nullable(),
  setupDecision: z.enum(['inherit', 'run', 'skip']),
  timeoutSeconds: z
    .number()
    .positive()
    .max(86400 * 7),
  maxRetries: z.number().int().nonnegative().max(50),
  maxReviewIterations: z.number().int().nonnegative().max(50)
})

export const ResolvedChildSnapshotSchema: z.ZodType<ResolvedChildSnapshot> = z.object({
  childDefinitionId: z.string().min(1).max(64),
  role: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  prompt: ResolvedPromptSchema,
  launchConfig: ResolvedChildLaunchConfigSchema,
  provenance: z.record(z.enum(CHILD_LAUNCH_CONFIG_FIELDS), z.enum(['inherited', 'overridden'])),
  dependencies: z.array(ChildDependencySchema).max(50),
  mutationClass: MutationClassSchema,
  mutationLane: z.string().max(100).optional(),
  stageAcceptance: StageAcceptanceContractSchema.optional(),
  resultSchema: z.record(z.string().max(100), z.unknown()).nullable().optional(),
  enabled: z.boolean()
})

export const ResolvedAutomationRunSnapshotSchema: z.ZodType<ResolvedAutomationRunSnapshot> =
  z.object({
    triggerPolicy: z.literal('manual_only').optional(),
    automationId: z.string().min(1),
    definitionRevision: z.number().int().positive(),
    createdAt: z.number(),
    outcomeContract: AutomationOutcomeContractSchema,
    resolvedChildren: z.array(ResolvedChildSnapshotSchema).min(1).max(100),
    executionTarget: z.object({
      type: z.enum(['local', 'ssh']),
      id: z.string().min(1).max(256),
      generation: z.number().int().optional()
    }),
    inheritedDefaults: ResolvedChildLaunchConfigSchema,
    globalCeilings: CoordinatedAutomationCeilingsSchema,
    publicationPolicy: CoordinatedAutomationPublicationPolicySchema,
    retentionPolicy: CoordinatedAutomationRetentionPolicySchema,
    canonicalDigest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, 'canonicalDigest must be a valid sha256 digest')
  })

export const CoordinatedRunFieldsSchema: z.ZodType<CoordinatedRunFields> = z
  .object({
    automationDefinitionRevision: z.number().int().positive(),
    orchestrationRunId: z.string().max(256).nullable(),
    resolvedSnapshot: ResolvedAutomationRunSnapshotSchema.nullable(),
    completionReceipt: SemanticCompletionReceiptSchema.nullable(),
    replanOfAutomationRunId: z.string().max(256).nullable(),
    replanOfDefinitionRevision: z.number().int().positive().nullable(),
    replanReason: z.string().max(2000).nullable(),
    materializationPhase: CoordinatedRunMaterializationPhaseSchema,
    childMappings: z.array(CoordinatedRunChildMappingSchema).max(100)
  })
  .superRefine((data, ctx) => {
    if (data.replanOfAutomationRunId) {
      if (!data.replanOfDefinitionRevision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replanOfDefinitionRevision'],
          message:
            'replanOfDefinitionRevision is required when replanOfAutomationRunId is specified'
        })
      }
      if (!data.replanReason || !data.replanReason.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replanReason'],
          message: 'replanReason is required when replanOfAutomationRunId is specified'
        })
      }
    }
    if (data.replanOfDefinitionRevision && !data.replanOfAutomationRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replanOfAutomationRunId'],
        message: 'replanOfAutomationRunId is required when replanOfDefinitionRevision is specified'
      })
    }
    if (data.replanReason && !data.replanOfAutomationRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replanOfAutomationRunId'],
        message: 'replanOfAutomationRunId is required when replanReason is specified'
      })
    }
  })
