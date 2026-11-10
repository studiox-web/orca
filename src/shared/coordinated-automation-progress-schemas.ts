import { z } from 'zod'
import type {
  CoordinatedAdmittedReport,
  CoordinatedEffectEntry,
  CoordinatedEscalation,
  CoordinatedRunProgress,
  CoordinatedStageProgress
} from './coordinated-automation-progress-types'

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const Identifier = z.string().min(1).max(256)

const AttemptRecordSchema = z.object({
  attemptNumber: z.number().int().positive(),
  kind: z.enum(['initial', 'retry', 'fix', 'rerun']),
  dispatchId: Identifier.nullable(),
  retryOfDispatchId: Identifier.nullable(),
  previousLatestDispatchId: Identifier.nullable(),
  startedAt: z.number(),
  deadlineAt: z.number(),
  leaseKeys: z.array(z.string().min(1)),
  status: z.enum(['starting', 'active', 'admitted', 'abandoned'])
})

const StageProgressSchema: z.ZodType<CoordinatedStageProgress> = z.object({
  status: z.enum(['pending', 'accepted', 'revision_requested', 'rejected', 'invalidated']),
  activeDispatchId: Identifier.nullable(),
  acceptedDispatchId: Identifier.nullable(),
  acceptedReportDigest: Digest.nullable(),
  acceptedArtifacts: z.array(z.object({ uri: z.string().min(1), sha256: Digest })),
  attempts: z.number().int().nonnegative(),
  reopenings: z.number().int().nonnegative(),
  lineage: z.array(AttemptRecordSchema),
  reviewIterations: z.number().int().nonnegative(),
  findings: z.array(z.string()),
  lastError: z.string().nullable()
})

const AdmittedReportSchema: z.ZodType<CoordinatedAdmittedReport> = z.object({
  childDefinitionId: Identifier,
  taskId: Identifier,
  dispatchId: Identifier,
  reportDigest: Digest,
  disposition: z.enum(['accepted', 'rejected', 'stale', 'duplicate']),
  reason: z.string().nullable(),
  admittedAt: z.number()
})

const EffectEntrySchema: z.ZodType<CoordinatedEffectEntry> = z.object({
  effectId: Identifier,
  childDefinitionId: Identifier,
  kind: z.string().min(1),
  namespace: z.string().optional(),
  status: z.enum(['intent_recorded', 'applied', 'verified', 'uncertain', 'denied']),
  receipt: z.string().nullable(),
  applyAuthorizations: z.number().int().nonnegative(),
  updatedAt: z.number()
})

const EscalationSchema: z.ZodType<CoordinatedEscalation> = z.object({
  key: z.string().min(1),
  code: z.enum([
    'review_limit',
    'repeated_finding',
    'wall_clock_ceiling',
    'cost_ceiling',
    'start_failure_ceiling',
    'stage_rejected',
    'uncertain_effect',
    'effect_denied',
    'lock_unavailable',
    'artifact_mutated',
    'stage_timeout',
    'effect_reset_conflict'
  ]),
  childDefinitionId: Identifier.nullable(),
  detail: z.string(),
  requiresHumanDecision: z.boolean(),
  at: z.number()
})

export const CoordinatedRunProgressSchema: z.ZodType<CoordinatedRunProgress> = z.object({
  schemaVersion: z.literal(1),
  automationId: Identifier,
  definitionRevision: z.number().int().positive(),
  executionAuthority: z.string().min(1),
  automationRunId: Identifier,
  orchestrationRunId: Identifier,
  canonicalDigest: Digest,
  sequence: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  startedAt: z.number(),
  spentCostUsd: z.number().nonnegative(),
  dispatchStartFailures: z.number().int().nonnegative(),
  stages: z.record(z.string(), StageProgressSchema),
  reports: z.array(AdmittedReportSchema),
  effects: z.record(z.string(), EffectEntrySchema),
  escalations: z.array(EscalationSchema),
  halt: z
    .object({
      state: z.enum(['failed', 'blocked', 'outcome_uncertain']),
      reason: z.string(),
      at: z.number()
    })
    .nullable(),
  approvals: z
    .array(
      z.object({
        scope: z.enum(['stage', 'parent']),
        approvalId: Identifier,
        role: z.string().min(1),
        approverIdentity: z.string().min(1),
        authorIdentity: z.string().optional(),
        approvedAt: z.number(),
        evidence: z.string().optional(),
        automationId: Identifier,
        definitionRevision: z.number().int().positive(),
        automationRunId: Identifier,
        orchestrationRunId: Identifier,
        childDefinitionId: z.string().optional(),
        taskId: z.string().optional(),
        dispatchId: z.string().optional(),
        targetChildId: z.string().optional()
      })
    )
    .optional(),
  operatorDecisions: z
    .array(
      z.object({
        kind: z.enum(['stop', 'retry', 'gate_resolution']),
        at: z.number(),
        actor: z.string().min(1),
        childDefinitionId: z.string().nullable(),
        dispatchId: z.string().nullable(),
        gateId: z.string().nullable(),
        decision: z.enum(['approve', 'reject', 'escalate']).nullable(),
        detail: z.string()
      })
    )
    .optional(),
  operatorStop: z
    .object({
      at: z.number(),
      reason: z.string().nullable()
    })
    .nullable()
    .optional()
})
