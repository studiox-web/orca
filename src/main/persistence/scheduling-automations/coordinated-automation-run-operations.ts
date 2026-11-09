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
import { coordinatedDefinitionFingerprint } from './coordinated-automation-revisions'
import {
  commitRuns,
  CoordinatedRunConflictError,
  type CoordinatedAutomationRunOperations
} from './coordinated-automation-run-records'

const MAX_IDEMPOTENCY_KEY_LENGTH = 128

export function coordinatedOccurrenceIdempotencyKey(
  trigger: AutomationRunTrigger,
  scheduledFor: number
): string {
  return `${trigger}:${scheduledFor}`
}

export type CreateCoordinatedAutomationRunInput = {
  automationId: string
  scheduledFor: number
  trigger?: AutomationRunTrigger
  /** Defaults to the occurrence identity `${trigger}:${scheduledFor}`. */
  idempotencyKey?: string
  expectedDefinitionRevision?: number
  expectedOwner?: AutomationOwnerPrecondition
  promptResolver?: ResolvePromptFunction
}

/**
 * Persist the run intent with its immutable snapshot in one write. A repeated delivery of the
 * same occurrence returns the existing run instead of creating a second one.
 */
export function createCoordinatedAutomationRun(
  operations: CoordinatedAutomationRunOperations,
  input: CreateCoordinatedAutomationRunInput
): AutomationRun {
  const trigger = input.trigger ?? 'scheduled'
  const idempotencyKey =
    input.idempotencyKey ?? coordinatedOccurrenceIdempotencyKey(trigger, input.scheduledFor)
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error('Coordinated run idempotency key must be 1-128 characters.')
  }
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
  const existing = runs.find(
    (run) => run.automationId === stored.id && run.idempotencyKey === idempotencyKey
  )
  if (existing) {
    return existing
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
  const resolved = resolveAutomationSnapshot({
    automation,
    promptResolver: input.promptResolver,
    createdAt: now
  })
  ResolvedAutomationRunSnapshotSchema.parse(resolved)
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
    idempotencyKey,
    materializationError: null
  }
  commitRuns(operations, {
    automations:
      automation === stored
        ? undefined
        : operations.state.automations.map((entry) =>
            entry.id === stored.id ? automation : entry
          ),
    automationRuns: pruneAutomationRuns([...runs, run])
  })
  return run
}
