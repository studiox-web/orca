import type { AutomationRun } from './automations-types'
import { deepFreeze, sha256Hex } from './coordinated-automation-canonical-digest'
import { isCoordinatedAutomationRun } from './coordinated-automation-ledger-types'
import type { CoordinatedRunQuarantine } from './coordinated-automation-types'
import { coordinatedRunProblem } from './coordinated-automation-run-validation'

const SEALED_FIELDS = [
  'resolvedSnapshot',
  'completionReceipt',
  'childMappings',
  'retainedEvidence'
] as const

const COORDINATED_PAYLOAD_FIELDS = [
  'automationDefinitionRevision',
  'orchestrationRunId',
  'resolvedSnapshot',
  'completionReceipt',
  'replanOfAutomationRunId',
  'replanOfDefinitionRevision',
  'replanReason',
  'materializationPhase',
  'childMappings',
  'idempotencyKey',
  'materializationError',
  'retainedEvidence'
] as const

/** Quarantine keeps at most this much of a rejected payload; larger ones keep only the digest. */
export const MAX_QUARANTINED_PAYLOAD_BYTES = 256 * 1024
const MAX_QUARANTINE_REASON_LENGTH = 512

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

/** Store-owned copy for a write: validated against the contract, then cloned and frozen. */
export function sealCoordinatedRun(run: AutomationRun): AutomationRun {
  if (!isCoordinatedAutomationRun(run)) {
    return run
  }
  const problem = coordinatedRunProblem(run)
  if (problem) {
    throw new CoordinatedRunRecordError(problem)
  }
  return frozenCopy(run)
}

/**
 * Reload path: a valid row is sealed exactly like a fresh write. An invalid one becomes an
 * inert quarantined row (no snapshot, links, or receipt; never dispatchable or replayable as
 * history) that carries the rejected payload, bounded, for repair.
 */
export function sealLoadedCoordinatedRun(run: AutomationRun): AutomationRun {
  if (!isCoordinatedAutomationRun(run) || isQuarantinedCoordinatedRun(run)) {
    return run
  }
  const problem = coordinatedRunProblem(run)
  return problem ? quarantineCoordinatedRun(run, problem) : frozenCopy(run)
}

export function isQuarantinedCoordinatedRun(run: AutomationRun): boolean {
  return run.coordinatedQuarantine !== undefined
}

function quarantineCoordinatedRun(run: AutomationRun, reason: string): AutomationRun {
  const rejected: Record<string, unknown> = {}
  for (const field of COORDINATED_PAYLOAD_FIELDS) {
    rejected[field] = run[field]
  }
  const payload = JSON.stringify(rejected) ?? 'null'
  const quarantine: CoordinatedRunQuarantine = deepFreeze({
    reason: reason.slice(0, MAX_QUARANTINE_REASON_LENGTH),
    payloadDigest: `sha256:${sha256Hex(payload)}`,
    payload:
      new TextEncoder().encode(payload).length <= MAX_QUARANTINED_PAYLOAD_BYTES ? payload : null
  })
  return {
    ...run,
    orchestrationRunId: null,
    resolvedSnapshot: null,
    completionReceipt: null,
    childMappings: [],
    materializationPhase: 'materialization_failed',
    materializationError: quarantine.reason,
    retainedEvidence: undefined,
    idempotencyKey: typeof run.idempotencyKey === 'string' ? run.idempotencyKey : undefined,
    coordinatedQuarantine: quarantine
  }
}

/** Callers get a mutable copy; the store keeps its frozen original. */
export function detachCoordinatedRun(run: AutomationRun): AutomationRun {
  return isCoordinatedAutomationRun(run) ? structuredClone(run) : run
}
