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
  SemanticReceiptWaiver,
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
  'completed',
  'failed',
  'blocked',
  'outcome_uncertain',
  'ready_for_review',
  'ready_to_publish',
  'published_verified'
])

export function isValidArtifactUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) {
    return false
  }
  if (uri.startsWith('/') || uri.startsWith('\\')) {
    return false
  }
  let path = uri
  if (uri.includes('://')) {
    if (!uri.startsWith('artifact://')) {
      return false
    }
    path = uri.slice('artifact://'.length)
    if (path.startsWith('/')) {
      return false
    }
  }
  const segments = path.split('/')
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    return false
  }
  for (const segment of segments) {
    // All-dot segments ('.', '..', '...') are traversal-like on some resolvers; never allow them.
    if (/^\.+$/.test(segment)) {
      return false
    }
    if (!/^[a-zA-Z0-9_\-.@]+$/.test(segment)) {
      return false
    }
  }
  return true
}

export const StructuredWorkerArtifactSchema: z.ZodType<StructuredWorkerArtifact> = z.object({
  kind: z.string().trim().min(1).max(100),
  uri: z.string().min(1).max(2048).refine(isValidArtifactUri, {
    message:
      'Artifact URI must be a repo-relative path without ".." traversal segments or a safe artifact:// URI'
  }),
  authority: z.string().max(256).optional(),
  sha256: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'sha256 must be a valid lowercase sha256 hex digest')
    .optional(),
  retentionClass: z.enum(['transient', 'run', 'audit', 'pinned']).optional(),
  producerAttempt: z
    .object({
      taskId: z.string().min(1).max(64),
      dispatchId: z.string().min(1).max(64)
    })
    .optional(),
  metadata: z.record(z.string().max(100), z.unknown()).optional()
})

export const StructuredWorkerCheckSchema: z.ZodType<StructuredWorkerCheck> = z.object({
  id: z.string().trim().min(1).max(64),
  outcome: z.enum(['passed', 'failed', 'warning']),
  namespace: z.string().max(100).optional(),
  evidence: z.array(z.string().max(512)).max(100).optional()
})

export const StructuredWorkerEffectSchema: z.ZodType<StructuredWorkerEffect> = z.object({
  kind: z.string().trim().min(1).max(100),
  status: z.enum(['not_started', 'applied', 'verified', 'uncertain', 'denied']),
  namespace: z.string().max(100).optional(),
  receipt: z.string().max(2048).optional(),
  error: z.string().max(2048).optional()
})

export const StructuredWorkerBlockerSchema: z.ZodType<StructuredWorkerBlocker> = z.object({
  code: z.string().trim().min(1).max(64),
  message: z.string().max(2000),
  resolvableBy: z.enum(['retry', 'human_action', 'upstream_fix']).optional()
})

export const StructuredWorkerResultOutcomeSchema: z.ZodType<StructuredWorkerResultOutcome> = z.enum(
  ['succeeded', 'failed', 'blocked', 'uncertain']
)

export const StructuredWorkerResultSchema: z.ZodType<StructuredWorkerResult> = z.object({
  schemaVersion: z.literal(1),
  automationRunId: z.string().min(1).max(64),
  orchestrationRunId: z.string().min(1).max(64),
  childDefinitionId: z.string().min(1).max(64),
  taskId: z.string().min(1).max(64),
  dispatchId: z.string().min(1).max(64),
  definitionRevision: z.number().int().positive('definitionRevision must be a positive integer'),
  resolvedConfigDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'resolvedConfigDigest must be a valid sha256 digest'),
  outcome: StructuredWorkerResultOutcomeSchema,
  summary: z.string().max(10_000, 'summary exceeds maximum length of 10,000 characters'),
  artifacts: z.array(StructuredWorkerArtifactSchema).max(100),
  checks: z.array(StructuredWorkerCheckSchema).max(200),
  effects: z.array(StructuredWorkerEffectSchema).max(100),
  blockers: z.array(StructuredWorkerBlockerSchema).max(50),
  reportMarkdown: z
    .string()
    .max(200_000, 'reportMarkdown exceeds maximum length of 200,000 characters')
})

export const CoordinatedRunChildMappingSchema: z.ZodType<CoordinatedRunChildMapping> = z.object({
  childDefinitionId: z.string().min(1).max(64),
  taskId: z.string().min(1).max(64),
  dispatchId: z.string().max(64).nullable().optional()
})

export const SemanticReceiptIdentityChainSchema: z.ZodType<SemanticReceiptIdentityChain> = z.object(
  {
    automationId: z.string().min(1).max(64),
    definitionRevision: z.number().int().positive('definitionRevision must be positive'),
    automationRunId: z.string().min(1).max(64),
    orchestrationRunId: z.string().min(1).max(64),
    hostId: z.string().min(1).max(128),
    targetExecutionAuthority: z.string().min(1).max(256),
    activeAttempt: z.object({
      taskId: z.string().min(1).max(64),
      dispatchId: z.string().min(1).max(64)
    }),
    taskMappings: z.array(CoordinatedRunChildMappingSchema).max(100)
  }
)

export const SemanticReceiptWaiverSchema: z.ZodType<SemanticReceiptWaiver> = z.object({
  authorizedBy: z.string().trim().min(1).max(256),
  reason: z.string().max(1024).optional(),
  waivedAt: z.number().optional()
})

export const SemanticReceiptAcceptanceResultSchema: z.ZodType<SemanticReceiptAcceptanceResult> =
  z.object({
    criterionId: z.string().min(1).max(64),
    status: z.enum(['satisfied', 'failed', 'waived']),
    evidence: z.array(z.string().max(512)).max(100),
    evaluatedAt: z.number(),
    waiver: SemanticReceiptWaiverSchema.optional()
  })

export const SemanticReceiptApprovalSchema: z.ZodType<SemanticReceiptApproval> = z.object({
  approvalId: z.string().min(1).max(64),
  role: z.string().min(1).max(100),
  approverIdentity: z.string().min(1).max(256),
  authorIdentity: z.string().max(256).optional(),
  approvedAt: z.number(),
  evidence: z.string().max(1024).optional()
})

export const SemanticReceiptEffectSchema: z.ZodType<SemanticReceiptEffect> = z.object({
  kind: z.string().min(1).max(100),
  namespace: z.string().min(1).max(100).optional(),
  status: z.enum(['verified', 'applied', 'denied', 'uncertain']),
  receipt: z.string().min(1).max(2048),
  verifiedAt: z.number()
})

export const SemanticReceiptWarningSchema: z.ZodType<SemanticReceiptWarning> = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(2000)
})

export const SemanticCompletionReceiptSchema: z.ZodType<SemanticCompletionReceipt> = z.object({
  schemaVersion: z.literal(1),
  identityChain: SemanticReceiptIdentityChainSchema,
  frozenConfigDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'frozenConfigDigest must be a valid sha256 digest'),
  finalState: OutcomeFinalStateSchema,
  completedAt: z.number(),
  selectedOutcomeItemIdentity: z.string().max(256).optional(),
  acceptanceResults: z.array(SemanticReceiptAcceptanceResultSchema).max(100),
  approvals: z.array(SemanticReceiptApprovalSchema).max(50),
  effectReceipts: z.array(SemanticReceiptEffectSchema).max(100),
  unresolvedWarnings: z.array(SemanticReceiptWarningSchema).max(100)
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
  automationRunId: z.string().min(1, 'automationRunId is required'),
  orchestrationRunId: z.string().min(1, 'orchestrationRunId is required'),
  definitionRevision: z.number().int().positive('definitionRevision must be positive'),
  resolvedConfigDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'resolvedConfigDigest must be a valid sha256 digest'),
  childDefinitionId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  status: StageAcceptanceStatusSchema,
  workerReportOutcome: z.enum(['succeeded', 'failed', 'blocked', 'uncertain']).optional(),
  evaluatedAt: z.number(),
  acceptanceEvidence: z.array(z.string().max(512)).max(100),
  unmetCriteria: z.array(z.string().max(512)).max(100).optional()
})

export const CoordinatedRunMaterializationPhaseSchema: z.ZodType<CoordinatedRunMaterializationPhase> =
  z.enum([
    'intent_persisted',
    'orchestration_run_created',
    'tasks_created',
    'mappings_persisted',
    'ready_for_dispatch',
    'orphaned_reconciling',
    'compensation_failed',
    'materialization_failed'
  ])

export const CoordinatedRunMaterializationRecordSchema: z.ZodType<CoordinatedRunMaterializationRecord> =
  z.object({
    automationId: z.string().min(1).max(64),
    automationRunId: z.string().min(1).max(64),
    definitionRevision: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(128),
    orchestrationRunId: z.string().max(64).nullable().optional(),
    phase: CoordinatedRunMaterializationPhaseSchema,
    childMappings: z.array(CoordinatedRunChildMappingSchema).max(100),
    boundaryError: z.string().max(2048).nullable().optional(),
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
