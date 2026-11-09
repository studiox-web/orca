import { z } from 'zod'
import type {
  CoordinatedAutomationLedger,
  CoordinatedOccurrenceRecord,
  CoordinatedParentTombstone
} from './coordinated-automation-ledger-types'

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)

const CoordinatedParentTombstoneSchema: z.ZodType<CoordinatedParentTombstone> = z.object({
  automationId: z.string().min(1),
  name: z.string(),
  lastDefinitionRevision: z.number().int().positive(),
  definitionFingerprint: Digest.nullable(),
  executionTarget: z.object({
    type: z.enum(['local', 'ssh']),
    id: z.string().min(1),
    generation: z.number().int().optional()
  }),
  children: z.array(
    z.object({ childDefinitionId: z.string(), name: z.string(), role: z.string() })
  ),
  archivedAt: z.number()
})

const CoordinatedOccurrenceRecordSchema: z.ZodType<CoordinatedOccurrenceRecord> = z.object({
  automationId: z.string().min(1),
  occurrenceFingerprint: Digest,
  idempotencyKey: z.string().min(1).max(128),
  trigger: z.enum(['scheduled', 'manual']),
  scheduledFor: z.number(),
  executionAuthority: z.string().min(1),
  automationRunId: z.string().min(1),
  definitionRevision: z.number().int().positive(),
  canonicalDigest: Digest,
  recordedAt: z.number()
})

export const CoordinatedAutomationLedgerSchema: z.ZodType<CoordinatedAutomationLedger> = z.object({
  parentTombstones: z.array(CoordinatedParentTombstoneSchema),
  occurrences: z.array(CoordinatedOccurrenceRecordSchema),
  replayHorizons: z.record(z.string(), z.number()),
  revisionDigests: z.record(z.string(), Digest),
  unreadable: z.literal(true).optional()
})

export function emptyCoordinatedAutomationLedger(): CoordinatedAutomationLedger {
  return { parentTombstones: [], occurrences: [], replayHorizons: {}, revisionDigests: {} }
}

/** An unreadable ledger is kept as a fail-closed marker instead of silently reset. */
export function normalizeLoadedCoordinatedAutomationLedger(
  value: unknown
): CoordinatedAutomationLedger | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const parsed = CoordinatedAutomationLedgerSchema.safeParse(value)
  return parsed.success ? parsed.data : { ...emptyCoordinatedAutomationLedger(), unreadable: true }
}
