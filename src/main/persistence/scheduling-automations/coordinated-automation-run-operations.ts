import { randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationRun,
  AutomationRunTrigger
} from '../../../shared/automations-types'
import {
  isCoordinatedAutomation,
  type ResolvedAutomationRunSnapshot
} from '../../../shared/coordinated-automation-types'
import {
  resolveAutomationSnapshot,
  type ResolvePromptFunction
} from '../../../shared/coordinated-automation-snapshot'
import { ResolvedAutomationRunSnapshotSchema } from '../../../shared/coordinated-automation-snapshot-schemas'
import {
  nextAutomationRunNumber,
  pruneAutomationRuns
} from '../../../shared/automation-run-retention'
import {
  assertAutomationOwnerFence,
  type AutomationOwnerPrecondition
} from '../../../shared/automation-owner-precondition'
import { automationProjectionContext } from './automation-owner-projection'
import {
  assertPinnedSourceDigests,
  coordinatedDefinitionFingerprint
} from './coordinated-automation-revisions'
import type { CoordinatedOccurrenceRecord } from '../../../shared/coordinated-automation-ledger-types'
import {
  detachCoordinatedRun,
  sealCoordinatedRun
} from '../../../shared/coordinated-automation-run-seal'
import {
  assertRevisionDigest,
  coordinatedExecutionAuthority,
  ledgerWithOccurrence,
  lookupCoordinatedOccurrence,
  readableLedger
} from './coordinated-automation-occurrence-ledger'
import {
  commitRuns,
  CoordinatedRunConflictError,
  type CoordinatedAutomationRunOperations
} from './coordinated-automation-run-records'

export type CreateCoordinatedAutomationRunInput = {
  automationId: string
  scheduledFor: number
  trigger?: AutomationRunTrigger
  /** Optional caller key; defaults to the canonical occurrence fingerprint. */
  idempotencyKey?: string
  expectedDefinitionRevision?: number
  expectedOwner?: AutomationOwnerPrecondition
  promptResolver?: ResolvePromptFunction
}

export type CoordinatedRunCreation = {
  created: boolean
  occurrence: CoordinatedOccurrenceRecord
  /** Detached copy; null when a replayed run's row was later pruned. */
  run: AutomationRun | null
}

/**
 * Persist the run intent, its immutable snapshot, and the occurrence replay record in one
 * write. A repeated delivery returns the original identity, even after the run row aged out.
 */
export function createCoordinatedAutomationRun(
  operations: CoordinatedAutomationRunOperations,
  input: CreateCoordinatedAutomationRunInput
): CoordinatedRunCreation {
  const trigger = input.trigger ?? 'scheduled'
  const ledger = readableLedger(operations.state)
  const stored = (operations.state.automations ?? []).find((a) => a.id === input.automationId)
  if (!stored) {
    throw new Error('Automation not found.')
  }
  if (!isCoordinatedAutomation(stored)) {
    throw new Error('Coordinated runs can only be created for coordinated automations.')
  }
  assertAutomationOwnerFence({
    automation: stored,
    expectedOwner: input.expectedOwner,
    operation: 'execute',
    context: automationProjectionContext(operations.state, operations.storageAuthority, false)
  })
  const runs = operations.state.automationRuns ?? []
  const executionAuthority = coordinatedExecutionAuthority(stored)
  const lookup = lookupCoordinatedOccurrence(ledger, {
    automationId: stored.id,
    trigger,
    scheduledFor: input.scheduledFor,
    executionAuthority,
    idempotencyKey: input.idempotencyKey
  })
  if (lookup.kind === 'replay') {
    const original = runs.find((run) => run.id === lookup.record.automationRunId)
    return {
      created: false,
      occurrence: { ...lookup.record },
      run: original ? detachCoordinatedRun(original) : null
    }
  }

  const now = Date.now()
  // Out-of-band edits (host reselection, owner migration) never bumped the revision; do it now.
  const fingerprint = coordinatedDefinitionFingerprint(stored)
  const automation: Automation =
    stored.definitionFingerprint === fingerprint
      ? stored
      : {
          ...stored,
          definitionRevision: (stored.definitionRevision ?? 1) + 1,
          definitionFingerprint: fingerprint,
          updatedAt: now
        }
  if (
    input.expectedDefinitionRevision !== undefined &&
    input.expectedDefinitionRevision !== automation.definitionRevision
  ) {
    throw new CoordinatedRunConflictError(
      `Definition revision changed: expected ${input.expectedDefinitionRevision}, stored ${automation.definitionRevision}.`
    )
  }
  assertPinnedSourceDigests(automation)
  const resolved = resolveAutomationSnapshot({
    automation,
    promptResolver: input.promptResolver,
    createdAt: now
  })
  ResolvedAutomationRunSnapshotSchema.parse(resolved)
  assertRevisionDigest(ledger, stored.id, resolved.definitionRevision, resolved.canonicalDigest)
  // Store the exact digested content; a schema-parsed copy could strip keys the digest covers.
  const snapshot: ResolvedAutomationRunSnapshot = structuredClone(resolved)
  const runNumber = nextAutomationRunNumber(runs.filter((run) => run.automationId === stored.id))
  const run: AutomationRun = {
    id: randomUUID(),
    automationId: stored.id,
    runNumber,
    runContext: automation.runContext ?? null,
    sourceContext: automation.sourceContext ?? null,
    title: `${automation.name} run ${runNumber}`,
    scheduledFor: input.scheduledFor,
    status: 'pending',
    trigger,
    workspaceId: automation.workspaceId,
    workspaceDisplayName: operations.getWorkspaceDisplayName(automation.workspaceId),
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: null,
    dispatchedAt: null,
    createdAt: now,
    automationDefinitionRevision: snapshot.definitionRevision,
    orchestrationRunId: null,
    resolvedSnapshot: snapshot,
    completionReceipt: null,
    replanOfAutomationRunId: null,
    replanOfDefinitionRevision: null,
    replanReason: null,
    materializationPhase: 'intent_persisted',
    childMappings: [],
    idempotencyKey: lookup.idempotencyKey,
    materializationError: null
  }
  const occurrence: CoordinatedOccurrenceRecord = {
    automationId: stored.id,
    occurrenceFingerprint: lookup.fingerprint,
    idempotencyKey: lookup.idempotencyKey,
    trigger,
    scheduledFor: input.scheduledFor,
    executionAuthority,
    automationRunId: run.id,
    definitionRevision: snapshot.definitionRevision,
    canonicalDigest: snapshot.canonicalDigest,
    recordedAt: now
  }
  const sealed = sealCoordinatedRun(run)
  commitRuns(operations, {
    ledger: ledgerWithOccurrence(ledger, occurrence),
    automations:
      automation === stored
        ? undefined
        : operations.state.automations.map((entry) =>
            entry.id === stored.id ? automation : entry
          ),
    automationRuns: pruneAutomationRuns([...runs, sealed])
  })
  return { created: true, occurrence: { ...occurrence }, run: detachCoordinatedRun(sealed) }
}
