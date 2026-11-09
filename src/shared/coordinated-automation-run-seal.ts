import { z } from 'zod'
import type { AutomationRun } from './automations-types'
import { deepFreeze, sha256Hex } from './coordinated-automation-canonical-digest'
import { isCoordinatedAutomationRun } from './coordinated-automation-ledger-types'
import type {
  CoordinatedRunQuarantine,
  CoordinatedRunQuarantineSummary
} from './coordinated-automation-types'
import { coordinatedRunProblem } from './coordinated-automation-run-validation'

const SEALED_FIELDS = [
  'resolvedSnapshot',
  'completionReceipt',
  'completionTrust',
  'childMappings',
  'retainedEvidence'
] as const

const COORDINATED_PAYLOAD_FIELDS = [
  'automationDefinitionRevision',
  'orchestrationRunId',
  'resolvedSnapshot',
  'completionReceipt',
  'completionTrust',
  'replanOfAutomationRunId',
  'replanOfDefinitionRevision',
  'replanReason',
  'materializationPhase',
  'childMappings',
  'idempotencyKey',
  'materializationError',
  'retainedEvidence',
  'coordinatedQuarantine'
] as const

/** Quarantine keeps at most this much of a rejected payload; larger ones keep only the digest. */
export const MAX_QUARANTINED_PAYLOAD_BYTES = 256 * 1024
const MAX_QUARANTINE_REASON_LENGTH = 512
const MALFORMED_QUARANTINE = 'Stored quarantine record is malformed or not inert.'

const StoredQuarantineSchema: z.ZodType<CoordinatedRunQuarantine> = z.strictObject({
  reason: z.string().min(1).max(MAX_QUARANTINE_REASON_LENGTH),
  payloadDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  payload: z.string().max(MAX_QUARANTINED_PAYLOAD_BYTES).nullable()
})

export class CoordinatedRunRecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedRunRecordError'
  }
}

function frozenCopy(run: AutomationRun): AutomationRun {
  const sealed: AutomationRun = { ...run }
  for (const field of SEALED_FIELDS) {
    const value = run[field]
    if (value !== undefined && value !== null) {
      // Why JSON: the stored copy must equal what a reload yields (undefined keys dropped).
      // @ts-expect-error each field keeps its own record type through clone and freeze
      sealed[field] = deepFreeze(JSON.parse(JSON.stringify(value)))
    }
  }
  return sealed
}

function belongsToCoordinatedPath(run: AutomationRun): boolean {
  return isCoordinatedAutomationRun(run) || run.coordinatedQuarantine !== undefined
}

/** Store-owned copy for a write: validated against the contract, then cloned and frozen. */
export function sealCoordinatedRun(run: AutomationRun): AutomationRun {
  if (!belongsToCoordinatedPath(run)) {
    return run
  }
  const problem = coordinatedRunProblem(run)
  if (problem) {
    throw new CoordinatedRunRecordError(problem)
  }
  return frozenCopy(run)
}

export type LoadedCoordinatedRun = { run: AutomationRun; repaired: boolean }

/**
 * Reload path. A valid row is sealed like a fresh write. A pre-marked quarantine is trusted
 * only if its record parses strictly and the row is exactly the canonical inert shape; any
 * other row (invalid, or quarantine-looking but not inert) is re-quarantined, and `repaired`
 * tells the loader to persist the canonical form.
 */
export function sealLoadedCoordinatedRun(run: AutomationRun): LoadedCoordinatedRun {
  if (!belongsToCoordinatedPath(run)) {
    return { run, repaired: false }
  }
  if (run.coordinatedQuarantine !== undefined) {
    const stored = StoredQuarantineSchema.safeParse(run.coordinatedQuarantine)
    if (stored.success && isCanonicalQuarantine(run, stored.data)) {
      return {
        run: { ...run, coordinatedQuarantine: deepFreeze({ ...stored.data }) },
        repaired: false
      }
    }
    return { run: quarantineCoordinatedRun(run, MALFORMED_QUARANTINE), repaired: true }
  }
  const problem = coordinatedRunProblem(run)
  return problem
    ? { run: quarantineCoordinatedRun(run, problem), repaired: true }
    : { run: frozenCopy(run), repaired: false }
}

function isCanonicalQuarantine(run: AutomationRun, quarantine: CoordinatedRunQuarantine): boolean {
  const payloadMatches =
    quarantine.payload === null ||
    `sha256:${sha256Hex(quarantine.payload)}` === quarantine.payloadDigest
  return (
    payloadMatches &&
    run.materializationPhase === 'materialization_failed' &&
    run.materializationError === quarantine.reason &&
    run.orchestrationRunId === null &&
    run.resolvedSnapshot === null &&
    run.completionReceipt === null &&
    (run.completionTrust === undefined || run.completionTrust === null) &&
    Array.isArray(run.childMappings) &&
    run.childMappings.length === 0 &&
    run.retainedEvidence === undefined &&
    (run.replanOfAutomationRunId ?? null) === null &&
    (run.replanOfDefinitionRevision ?? null) === null &&
    (run.replanReason ?? null) === null &&
    (run.idempotencyKey === undefined ||
      (typeof run.idempotencyKey === 'string' && run.idempotencyKey.length <= 128)) &&
    (run.automationDefinitionRevision === undefined ||
      (Number.isSafeInteger(run.automationDefinitionRevision) &&
        run.automationDefinitionRevision > 0))
  )
}

function quarantineCoordinatedRun(run: AutomationRun, reason: string): AutomationRun {
  const rejected: Record<string, unknown> = {}
  for (const field of COORDINATED_PAYLOAD_FIELDS) {
    rejected[field] = run[field]
  }
  const payload = JSON.stringify(rejected) ?? 'null'
  const boundedReason = reason.slice(0, MAX_QUARANTINE_REASON_LENGTH)
  const quarantine: CoordinatedRunQuarantine = deepFreeze({
    reason: boundedReason,
    payloadDigest: `sha256:${sha256Hex(payload)}`,
    payload:
      new TextEncoder().encode(payload).length <= MAX_QUARANTINED_PAYLOAD_BYTES ? payload : null
  })
  const revision = run.automationDefinitionRevision
  const quarantined: AutomationRun = {
    ...run,
    orchestrationRunId: null,
    resolvedSnapshot: null,
    completionReceipt: null,
    childMappings: [],
    materializationPhase: 'materialization_failed',
    materializationError: boundedReason,
    replanOfAutomationRunId: null,
    replanOfDefinitionRevision: null,
    replanReason: null,
    coordinatedQuarantine: quarantine
  }
  delete quarantined.retainedEvidence
  delete quarantined.completionTrust
  if (typeof run.idempotencyKey !== 'string' || run.idempotencyKey.length > 128) {
    delete quarantined.idempotencyKey
  }
  if (!Number.isSafeInteger(revision) || (revision ?? 0) <= 0) {
    delete quarantined.automationDefinitionRevision
  }
  return quarantined
}

export function isQuarantinedCoordinatedRun(run: AutomationRun): boolean {
  return run.coordinatedQuarantine !== undefined
}

function quarantineSummary(
  quarantine: NonNullable<AutomationRun['coordinatedQuarantine']>
): CoordinatedRunQuarantineSummary {
  return {
    reason: quarantine.reason,
    payloadDigest: quarantine.payloadDigest,
    payloadRetained:
      'payload' in quarantine ? quarantine.payload !== null : quarantine.payloadRetained
  }
}

/** Callers get a mutable copy; the store keeps its frozen original and the private payload. */
export function detachCoordinatedRun(run: AutomationRun): AutomationRun {
  if (!belongsToCoordinatedPath(run)) {
    return run
  }
  const detached = structuredClone(run)
  if (run.coordinatedQuarantine) {
    detached.coordinatedQuarantine = quarantineSummary(run.coordinatedQuarantine)
  }
  return detached
}
