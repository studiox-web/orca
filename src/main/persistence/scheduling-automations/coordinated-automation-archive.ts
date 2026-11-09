import { isFinalAutomationRunStatus } from '../../../shared/automations-types'
import { isCoordinatedAutomation } from '../../../shared/coordinated-automation-types'
import type { CoordinatedParentTombstone } from '../../../shared/coordinated-automation-ledger-types'
import {
  assertAutomationOwnerFence,
  type AutomationOwnerPrecondition
} from '../../../shared/automation-owner-precondition'
import { invalidateLocalWorktreeMetadataPruneInputs } from '../../local-worktree-metadata-prune-gate'
import { automationProjectionContext } from './automation-owner-projection'
import { readableLedger } from './coordinated-automation-occurrence-ledger'
import {
  commitRuns,
  CoordinatedRunConflictError,
  type CoordinatedAutomationRunOperations
} from './coordinated-automation-run-records'

/**
 * Remove a coordinated parent from scheduling while keeping its identity tombstone and every
 * run, snapshot, receipt, link, mapping, and replay record. Refused while any run is unsettled.
 */
export function archiveCoordinatedAutomation(
  operations: CoordinatedAutomationRunOperations,
  input: { automationId: string; expectedOwner?: AutomationOwnerPrecondition }
): CoordinatedParentTombstone {
  const ledger = readableLedger(operations.state)
  const stored = (operations.state.automations ?? []).find((a) => a.id === input.automationId)
  if (!stored) {
    throw new Error('Automation not found.')
  }
  if (!isCoordinatedAutomation(stored)) {
    throw new Error('Only coordinated automations are archived; delete single automations.')
  }
  assertAutomationOwnerFence({
    automation: stored,
    expectedOwner: input.expectedOwner,
    operation: 'mutate',
    context: automationProjectionContext(operations.state, operations.storageAuthority, false)
  })
  const unsettled = operations.state.automationRuns.filter(
    (run) => run.automationId === stored.id && !isFinalAutomationRunStatus(run.status)
  )
  if (unsettled.length > 0) {
    throw new CoordinatedRunConflictError(
      `Archive refused: ${unsettled.length} run(s) have not settled.`
    )
  }
  const tombstone: CoordinatedParentTombstone = {
    automationId: stored.id,
    name: stored.name,
    lastDefinitionRevision: stored.definitionRevision ?? 1,
    definitionFingerprint: stored.definitionFingerprint ?? null,
    executionTarget: {
      type: stored.executionTargetType,
      id: stored.executionTargetId,
      ...(stored.executionTargetGeneration !== undefined
        ? { generation: stored.executionTargetGeneration }
        : {})
    },
    children: (stored.children ?? []).map((child) => ({
      childDefinitionId: child.id,
      name: child.name,
      role: child.role
    })),
    archivedAt: Date.now()
  }
  commitRuns(operations, {
    automations: operations.state.automations.filter((a) => a.id !== stored.id),
    automationRuns: operations.state.automationRuns,
    ledger: { ...ledger, parentTombstones: [...ledger.parentTombstones, tombstone] }
  })
  // The archived definition no longer claims its workspace (#17775).
  invalidateLocalWorktreeMetadataPruneInputs()
  return { ...tombstone, children: tombstone.children.map((c) => ({ ...c })) }
}
