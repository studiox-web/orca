import type { Automation, AutomationRunTrigger } from '../../../shared/automations-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type {
  CoordinatedAutomationLedger,
  CoordinatedOccurrenceRecord
} from '../../../shared/coordinated-automation-ledger-types'
import { emptyCoordinatedAutomationLedger } from '../../../shared/coordinated-automation-ledger-schemas'
import { sha256Hex, toCanonicalJson } from '../../../shared/coordinated-automation-canonical-digest'

/**
 * Replay horizon: the ledger keeps the newest records per automation (by `scheduledFor`).
 * Evicting one raises that automation's horizon to the evicted `scheduledFor`; a delivery at or
 * below the horizon with no surviving record cannot be proved new, so it is refused.
 */
export const MAX_OCCURRENCE_RECORDS_PER_AUTOMATION = 1000

export class CoordinatedOccurrenceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedOccurrenceConflictError'
  }
}

export class CoordinatedReplayHorizonError extends Error {
  constructor(automationId: string, scheduledFor: number, horizon: number) {
    super(
      `Occurrence ${scheduledFor} of automation ${automationId} is at or before the replay horizon ${horizon}; it cannot be proved new, so no run was created.`
    )
    this.name = 'CoordinatedReplayHorizonError'
  }
}

export function coordinatedExecutionAuthority(automation: Automation): string {
  return `${automation.executionTargetType}:${automation.executionTargetId}`
}

/** Canonical occurrence identity; the target generation is excluded so re-adoption replays. */
export function coordinatedOccurrenceFingerprint(input: {
  automationId: string
  trigger: AutomationRunTrigger
  scheduledFor: number
  executionAuthority: string
}): string {
  return `sha256:${sha256Hex(
    toCanonicalJson({
      version: 1,
      automationId: input.automationId,
      trigger: input.trigger,
      scheduledFor: input.scheduledFor,
      executionAuthority: input.executionAuthority
    })
  )}`
}

export function readableLedger(state: PersistedState): CoordinatedAutomationLedger {
  const ledger = state.coordinatedAutomationLedger ?? emptyCoordinatedAutomationLedger()
  if (ledger.unreadable) {
    throw new CoordinatedOccurrenceConflictError(
      'The coordinated automation ledger is unreadable; restore it before creating or archiving coordinated runs.'
    )
  }
  return ledger
}

export type OccurrenceLookup =
  | { kind: 'replay'; record: CoordinatedOccurrenceRecord }
  | { kind: 'new'; fingerprint: string; idempotencyKey: string }

export function lookupCoordinatedOccurrence(
  ledger: CoordinatedAutomationLedger,
  input: {
    automationId: string
    trigger: AutomationRunTrigger
    scheduledFor: number
    executionAuthority: string
    idempotencyKey?: string
  }
): OccurrenceLookup {
  if (
    input.idempotencyKey !== undefined &&
    (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128)
  ) {
    throw new CoordinatedOccurrenceConflictError('Idempotency key must be 1-128 characters.')
  }
  const fingerprint = coordinatedOccurrenceFingerprint(input)
  const records = ledger.occurrences.filter((r) => r.automationId === input.automationId)
  const replay = records.find((r) => r.occurrenceFingerprint === fingerprint)
  if (replay) {
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== replay.idempotencyKey) {
      throw new CoordinatedOccurrenceConflictError(
        'This occurrence was already recorded under a different idempotency key.'
      )
    }
    return { kind: 'replay', record: replay }
  }
  const sameOccurrence = records.find(
    (r) => r.trigger === input.trigger && r.scheduledFor === input.scheduledFor
  )
  if (sameOccurrence) {
    throw new CoordinatedOccurrenceConflictError(
      `This occurrence was recorded under authority ${sameOccurrence.executionAuthority}, not ${input.executionAuthority}.`
    )
  }
  const idempotencyKey = input.idempotencyKey ?? fingerprint
  if (records.some((r) => r.idempotencyKey === idempotencyKey)) {
    throw new CoordinatedOccurrenceConflictError(
      'This idempotency key already identifies a different occurrence.'
    )
  }
  const horizon = ledger.replayHorizons[input.automationId]
  if (horizon !== undefined && input.scheduledFor <= horizon) {
    throw new CoordinatedReplayHorizonError(input.automationId, input.scheduledFor, horizon)
  }
  return { kind: 'new', fingerprint, idempotencyKey }
}

function revisionKey(automationId: string, revision: number): string {
  return `${automationId}:${revision}`
}

/** One revision has exactly one canonical snapshot; a second digest means non-determinism. */
export function assertRevisionDigest(
  ledger: CoordinatedAutomationLedger,
  automationId: string,
  revision: number,
  canonicalDigest: string
): void {
  const recorded = ledger.revisionDigests[revisionKey(automationId, revision)]
  if (recorded !== undefined && recorded !== canonicalDigest) {
    throw new CoordinatedOccurrenceConflictError(
      `Revision ${revision} already resolved to ${recorded}; refusing a different snapshot ${canonicalDigest}.`
    )
  }
}

export function ledgerWithOccurrence(
  ledger: CoordinatedAutomationLedger,
  record: CoordinatedOccurrenceRecord,
  maxPerAutomation = MAX_OCCURRENCE_RECORDS_PER_AUTOMATION
): CoordinatedAutomationLedger {
  const mine = [...ledger.occurrences.filter((r) => r.automationId === record.automationId), record]
  const others = ledger.occurrences.filter((r) => r.automationId !== record.automationId)
  mine.sort((a, b) => b.scheduledFor - a.scheduledFor || b.recordedAt - a.recordedAt)
  const kept = mine.slice(0, Math.max(1, maxPerAutomation))
  const evicted = mine.slice(Math.max(1, maxPerAutomation))
  const replayHorizons = { ...ledger.replayHorizons }
  for (const gone of evicted) {
    replayHorizons[record.automationId] = Math.max(
      replayHorizons[record.automationId] ?? Number.NEGATIVE_INFINITY,
      gone.scheduledFor
    )
  }
  return {
    ...ledger,
    occurrences: [...others, ...kept],
    replayHorizons,
    revisionDigests: {
      ...ledger.revisionDigests,
      [revisionKey(record.automationId, record.definitionRevision)]: record.canonicalDigest
    }
  }
}
