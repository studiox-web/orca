import { z } from 'zod'
import type {
  CoordinatedHostCapabilities,
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase,
  CoordinatedRunMaterializationRecord
} from './coordinated-automation-saga-types'
import type {
  SemanticCompletionReceipt,
  SemanticReceiptAcceptanceResult,
  SemanticReceiptApproval,
  SemanticReceiptEffect,
  SemanticReceiptIdentityChain,
  SemanticReceiptWarning,
  StageAcceptanceRecord,
  StageAcceptanceStatus,
  StructuredWorkerArtifact,
  StructuredWorkerBlocker,
  StructuredWorkerCheck,
  StructuredWorkerEffect,
  StructuredWorkerResult,
  StructuredWorkerResultOutcome
} from './coordinated-automation-receipt-types'
import type { OutcomeFinalState } from './coordinated-automation-types'

export const OutcomeFinalStateSchema: z.ZodType<OutcomeFinalState> = z.enum([
  'ready_to_publish',
  'published_verified',
  'completed',
  'blocked',
  'failed',
  'outcome_uncertain'
])

export const StructuredWorkerArtifactSchema: z.ZodType<StructuredWorkerArtifact> = z.object({
  kind: z.string().min(1),
  uri: z.string().min(1),
  authority: z.string().optional(),
  sha256: z.string().optional(),
  producerAttempt: z
    .object({
      taskId: z.string().min(1),
      dispatchId: z.string().min(1)
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export const StructuredWorkerCheckSchema: z.ZodType<StructuredWorkerCheck> = z.object({
  id: z.string().min(1),
  outcome: z.enum(['passed', 'failed', 'warning']),
  namespace: z.string().optional(),
  evidence: z.array(z.string()).optional()
})

export const StructuredWorkerEffectSchema: z.ZodType<StructuredWorkerEffect> = z.object({
  kind: z.string().min(1),
  status: z.enum(['not_started', 'applied', 'verified', 'uncertain', 'denied']),
  namespace: z.string().optional(),
  receipt: z.string().optional(),
  error: z.string().optional()
})

export const StructuredWorkerBlockerSchema: z.ZodType<StructuredWorkerBlocker> = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  resolvableBy: z.enum(['retry', 'human_action', 'upstream_fix']).optional()
})

export const StructuredWorkerResultOutcomeSchema: z.ZodType<StructuredWorkerResultOutcome> = z.enum(
  ['succeeded', 'failed', 'blocked', 'uncertain']
)

export const StructuredWorkerResultSchema: z.ZodType<StructuredWorkerResult> = z.object({
  schemaVersion: z.literal(1),
  automationRunId: z.string().min(1, 'automationRunId is required'),
  orchestrationRunId: z.string().min(1, 'orchestrationRunId is required'),
  childDefinitionId: z.string().min(1, 'childDefinitionId is required'),
  taskId: z.string().min(1, 'taskId is required'),
  dispatchId: z.string().min(1, 'dispatchId is required'),
  definitionRevision: z.number().int().positive('definitionRevision must be a positive integer'),
  resolvedConfigDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'resolvedConfigDigest must be a valid sha256 digest'),
  outcome: StructuredWorkerResultOutcomeSchema,
  summary: z.string(),
  artifacts: z.array(StructuredWorkerArtifactSchema),
  checks: z.array(StructuredWorkerCheckSchema),
  effects: z.array(StructuredWorkerEffectSchema),
  blockers: z.array(StructuredWorkerBlockerSchema),
  reportMarkdown: z.string()
})

export const SemanticReceiptIdentityChainSchema: z.ZodType<SemanticReceiptIdentityChain> = z.object(
  {
    automationId: z.string().min(1, 'automationId is required'),
    definitionRevision: z.number().int().positive('definitionRevision must be positive'),
    automationRunId: z.string().min(1, 'automationRunId is required'),
    orchestrationRunId: z.string().min(1, 'orchestrationRunId is required')
  }
)

export const SemanticReceiptAcceptanceResultSchema: z.ZodType<SemanticReceiptAcceptanceResult> =
  z.object({
    criterionId: z.string().min(1),
    status: z.enum(['satisfied', 'failed', 'waived']),
    evidence: z.array(z.string()),
    evaluatedAt: z.number()
  })

export const SemanticReceiptApprovalSchema: z.ZodType<SemanticReceiptApproval> = z.object({
  approvalId: z.string().min(1),
  role: z.string().min(1),
  approverIdentity: z.string().min(1),
  authorIdentity: z.string().optional(),
  approvedAt: z.number(),
  evidence: z.string().optional()
})

export const SemanticReceiptEffectSchema: z.ZodType<SemanticReceiptEffect> = z.object({
  kind: z.string().min(1),
  status: z.enum(['verified', 'applied', 'denied', 'uncertain']),
  receipt: z.string().min(1),
  verifiedAt: z.number()
})

export const SemanticReceiptWarningSchema: z.ZodType<SemanticReceiptWarning> = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
})

export const SemanticCompletionReceiptSchema: z.ZodType<SemanticCompletionReceipt> = z.object({
  schemaVersion: z.literal(1),
  identityChain: SemanticReceiptIdentityChainSchema,
  frozenConfigDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'frozenConfigDigest must be a valid sha256 digest'),
  finalState: OutcomeFinalStateSchema,
  completedAt: z.number(),
  selectedOutcomeItemIdentity: z.string().optional(),
  acceptanceResults: z.array(SemanticReceiptAcceptanceResultSchema),
  approvals: z.array(SemanticReceiptApprovalSchema),
  effectReceipts: z.array(SemanticReceiptEffectSchema),
  unresolvedWarnings: z.array(SemanticReceiptWarningSchema)
})

export const StageAcceptanceStatusSchema: z.ZodType<StageAcceptanceStatus> = z.enum([
  'pending',
  'evaluating',
  'accepted',
  'revision_requested',
  'rejected',
  'waived'
])

export const StageAcceptanceRecordSchema: z.ZodType<StageAcceptanceRecord> = z.object({
  childDefinitionId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  status: StageAcceptanceStatusSchema,
  workerReportOutcome: z.enum(['succeeded', 'failed', 'blocked', 'uncertain']).optional(),
  evaluatedAt: z.number(),
  acceptanceEvidence: z.array(z.string()),
  unmetCriteria: z.array(z.string()).optional()
})

export const CoordinatedRunMaterializationPhaseSchema: z.ZodType<CoordinatedRunMaterializationPhase> =
  z.enum([
    'intent_persisted',
    'orchestration_run_created',
    'tasks_created',
    'mappings_persisted',
    'ready_for_dispatch',
    'dispatch_active',
    'accepted',
    'failed',
    'reconciliation_blocked'
  ])

export const CoordinatedRunChildMappingSchema: z.ZodType<CoordinatedRunChildMapping> = z.object({
  childDefinitionId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().nullable().optional()
})

export const CoordinatedRunMaterializationRecordSchema: z.ZodType<CoordinatedRunMaterializationRecord> =
  z.object({
    automationId: z.string().min(1),
    automationRunId: z.string().min(1),
    definitionRevision: z.number().int().positive(),
    idempotencyKey: z.string().min(1),
    orchestrationRunId: z.string().nullable().optional(),
    phase: CoordinatedRunMaterializationPhaseSchema,
    childMappings: z.array(CoordinatedRunChildMappingSchema),
    boundaryError: z.string().nullable().optional(),
    updatedAt: z.number()
  })

export const CoordinatedHostCapabilitiesSchema: z.ZodType<CoordinatedHostCapabilities> = z.object({
  contractVersion: z.literal(1),
  supportedCapabilities: z.array(
    z.enum([
      'coordinated_v1',
      'structured_worker_result_v1',
      'semantic_completion_receipt_v1',
      'stage_acceptance_v1'
    ])
  )
})
