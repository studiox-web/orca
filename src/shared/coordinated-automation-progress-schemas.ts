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

const StageProgressSchema: z.ZodType<CoordinatedStageProgress> = z.object({
  status: z.enum(['pending', 'accepted', 'revision_requested', 'rejected', 'invalidated']),
  activeDispatchId: Identifier.nullable(),
  acceptedDispatchId: Identifier.nullable(),
  acceptedReportDigest: Digest.nullable(),
  acceptedArtifacts: z.array(z.object({ uri: z.string().min(1), sha256: Digest })),
  attempts: z.number().int().nonnegative(),
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
    'artifact_mutated'
  ]),
  childDefinitionId: Identifier.nullable(),
  detail: z.string(),
  requiresHumanDecision: z.boolean(),
  at: z.number()
})

export const CoordinatedRunProgressSchema: z.ZodType<CoordinatedRunProgress> = z.object({
  schemaVersion: z.literal(1),
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
    .nullable()
})
