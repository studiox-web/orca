import { getAutomationRunRepoId } from '../../../shared/automation-run-identity'
import type { OrcadMigrationManifest } from '../../../shared/orcad-migration/orcad-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { createOrcadMigrationSourceScope, orcadMigrationOwnsRepoId } from './orcad-source-scope'
import { assertNoCoordinatedStateInOrcadMigration } from './orcad-coordinated-automation-refusal'

/** Include rows a downgraded build added to moved projects. */
export function subtractOrcadMigrationSourceAutomationState(
  state: PersistedState,
  manifest: OrcadMigrationManifest
): void {
  const scope = createOrcadMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const automationIds = new Set([
    ...(manifest.payload.dormantState?.automations ?? []).map((entry) => entry.id),
    ...state.automations
      .filter(
        (entry) =>
          orcadMigrationOwnsRepoId(scope, getAutomationRunRepoId(entry)) &&
          (entry.executionTargetType !== 'ssh' || entry.executionTargetId === scope.targetId)
      )
      .map((entry) => entry.id)
  ])
  const runIds = new Set((manifest.payload.dormantState?.automationRuns ?? []).map((run) => run.id))
  // Refuse before mutating: subtracting coordinated rows alone would orphan their ledger.
  assertNoCoordinatedStateInOrcadMigration({
    state,
    automations: state.automations.filter((entry) => automationIds.has(entry.id)),
    runs: state.automationRuns.filter(
      (run) => runIds.has(run.id) || automationIds.has(run.automationId)
    ),
    sshTargetId: scope.targetId
  })
  state.automations = state.automations.filter((entry) => !automationIds.has(entry.id))
  state.automationRuns = state.automationRuns.filter(
    (run) => !runIds.has(run.id) && !automationIds.has(run.automationId)
  )
}
