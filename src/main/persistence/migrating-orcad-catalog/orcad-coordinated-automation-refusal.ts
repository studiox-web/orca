import type { Automation, AutomationRun } from '../../../shared/automations-types'
import { isCoordinatedAutomation } from '../../../shared/coordinated-automation-types'
import { isCoordinatedAutomationRun } from '../../../shared/coordinated-automation-ledger-types'
import type { PersistedState } from '../../../shared/persisted-state-types'

/**
 * Phase 2 cannot carry coordinated definitions, runs, tombstones, revisions and their replay
 * ledger atomically, and moving or subtracting any part alone would split their identity.
 * So any coordinated state a move would touch refuses the move outright; "Move anyway" cannot
 * override it.
 */
export const ORCAD_MIGRATION_COORDINATED_STATE_REFUSAL =
  'orcad_migration_coordinated_automation_state'

export function coordinatedStateTouchedByOrcadMigration(input: {
  state: PersistedState
  automations: readonly Automation[]
  runs: readonly AutomationRun[]
  sshTargetId: string | null
}): number {
  const ledger = input.state.coordinatedAutomationLedger
  if (ledger?.unreadable) {
    // An unreadable ledger cannot prove none of its records belong to this scope.
    return 1
  }
  const automationIds = new Set([
    ...input.automations.map((entry) => entry.id),
    ...input.runs.map((entry) => entry.automationId)
  ])
  return (
    input.automations.filter(isCoordinatedAutomation).length +
    input.runs.filter(isCoordinatedAutomationRun).length +
    (ledger?.parentTombstones ?? []).filter(
      (tombstone) =>
        automationIds.has(tombstone.automationId) ||
        (input.sshTargetId !== null &&
          tombstone.executionTarget.type === 'ssh' &&
          tombstone.executionTarget.id === input.sshTargetId)
    ).length +
    (ledger?.occurrences ?? []).filter((record) => automationIds.has(record.automationId)).length
  )
}

export function assertNoCoordinatedStateInOrcadMigration(
  input: Parameters<typeof coordinatedStateTouchedByOrcadMigration>[0]
): void {
  const count = coordinatedStateTouchedByOrcadMigration(input)
  if (count > 0) {
    throw new Error(`${ORCAD_MIGRATION_COORDINATED_STATE_REFUSAL}:${count}`)
  }
}

/** A destination never accepts coordinated rows: they would arrive without their ledger. */
export function assertNoIncomingCoordinatedState(
  automations: readonly Automation[],
  runs: readonly AutomationRun[]
): void {
  const incoming =
    automations.filter(
      (entry) => isCoordinatedAutomation(entry) || entry.kind !== undefined || entry.children
    ).length + runs.filter(isCoordinatedAutomationRun).length
  if (incoming > 0) {
    throw new Error(`orcad_migration_dormant_coordinated_automation_unsupported:${incoming}`)
  }
}
