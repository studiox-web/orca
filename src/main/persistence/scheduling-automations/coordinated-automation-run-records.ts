import type { Automation, AutomationRun } from '../../../shared/automations-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { isCoordinatedAutomation } from '../../../shared/coordinated-automation-types'
import type { CoordinatedRunMaterializationPhase } from '../../../shared/coordinated-automation-saga-types'
import {
  isCoordinatedAutomationRun,
  type CoordinatedAutomationLedger
} from '../../../shared/coordinated-automation-ledger-types'
import {
  detachCoordinatedRun,
  sealCoordinatedRun
} from '../../../shared/coordinated-automation-run-seal'
import {
  coordinatedRunProblem,
  mappingProblem
} from '../../../shared/coordinated-automation-run-validation'
import type { AutomationStorageAuthority } from './automation-owner-projection'
import { CoordinatedAutomationExecutionRefusedError } from './coordinated-automation-revisions'

export type CoordinatedAutomationRunOperations = {
  state: PersistedState
  storageAuthority: AutomationStorageAuthority
  flush: () => void
  recordAutomationRunsMutation?: (runs: readonly AutomationRun[]) => void
  getWorkspaceDisplayName: (workspaceId: string | null | undefined) => string | null
}

/** Read-only view of the orchestration store; links are written only to records it confirms. */
export type CoordinatedOrchestrationRecordProbe = {
  hasRun: (orchestrationRunId: string) => boolean
  hasTask: (orchestrationRunId: string, taskId: string) => boolean
}

export { mappingProblem }

export class CoordinatedRunConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedRunConflictError'
  }
}

export function isCoordinatedRun(run: AutomationRun): boolean {
  return isCoordinatedAutomationRun(run)
}

/** A run may dispatch only when every link the snapshot requires is durably recorded. */
export function isCoordinatedRunDispatchable(run: AutomationRun): boolean {
  if (run.coordinatedQuarantine !== undefined) {
    return false
  }
  if (
    run.materializationPhase !== 'ready_for_dispatch' ||
    !run.orchestrationRunId ||
    !run.resolvedSnapshot ||
    run.resolvedSnapshot.automationId !== run.automationId ||
    run.resolvedSnapshot.definitionRevision !== run.automationDefinitionRevision
  ) {
    return false
  }
  return coordinatedRunProblem(run) === null
}

/** Write one in-memory change; restore it if the durable write throws so no half state survives. */
export function commitRuns(
  operations: CoordinatedAutomationRunOperations,
  next: {
    automations?: Automation[]
    automationRuns: AutomationRun[]
    ledger?: CoordinatedAutomationLedger
  }
): void {
  const previousAutomations = operations.state.automations
  const previousRuns = operations.state.automationRuns
  const previousLedger = operations.state.coordinatedAutomationLedger
  if (next.automations) {
    operations.state.automations = next.automations
  }
  if (next.ledger) {
    operations.state.coordinatedAutomationLedger = next.ledger
  }
  operations.state.automationRuns = next.automationRuns
  try {
    operations.recordAutomationRunsMutation?.(next.automationRuns)
    operations.flush()
  } catch (error) {
    operations.state.automations = previousAutomations
    operations.state.automationRuns = previousRuns
    operations.state.coordinatedAutomationLedger = previousLedger
    operations.recordAutomationRunsMutation?.(previousRuns)
    throw error
  }
}

export function requireCoordinatedRun(
  operations: CoordinatedAutomationRunOperations,
  automationRunId: string
): AutomationRun {
  const run = (operations.state.automationRuns ?? []).find((entry) => entry.id === automationRunId)
  if (!run) {
    throw new Error('Automation run not found.')
  }
  if (run.coordinatedQuarantine) {
    throw new CoordinatedRunConflictError(
      `Coordinated run is quarantined: ${run.coordinatedQuarantine.reason}`
    )
  }
  if (!isCoordinatedRun(run) || !run.resolvedSnapshot) {
    throw new Error('Automation run is not a coordinated run.')
  }
  return run
}

export function replaceRun(
  operations: CoordinatedAutomationRunOperations,
  updated: AutomationRun
): AutomationRun {
  const sealed = sealCoordinatedRun(updated)
  commitRuns(operations, {
    automationRuns: operations.state.automationRuns.map((run) =>
      run.id === sealed.id ? sealed : run
    )
  })
  return detachCoordinatedRun(sealed)
}

export function assertPhase(
  run: AutomationRun,
  allowed: readonly CoordinatedRunMaterializationPhase[]
): void {
  if (!run.materializationPhase || !allowed.includes(run.materializationPhase)) {
    throw new CoordinatedRunConflictError(
      `Coordinated run is in phase "${run.materializationPhase}", expected ${allowed.join(' or ')}.`
    )
  }
}

/** Single-run writers must not rewrite coordinated runs, whose lifecycle the saga owns. */
export function assertNotCoordinatedRunWrite(run: AutomationRun | undefined): void {
  if (run && isCoordinatedRun(run)) {
    throw new CoordinatedAutomationExecutionRefusedError(
      'Coordinated runs are updated only through the coordinated materialization path.'
    )
  }
}

export function assertNotCoordinatedAutomationExecution(automation: Automation): void {
  if (isCoordinatedAutomation(automation)) {
    throw new CoordinatedAutomationExecutionRefusedError()
  }
}
