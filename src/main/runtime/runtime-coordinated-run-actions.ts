import { isFinalAutomationRunStatus } from '../../shared/automations-types'
import type {
  AutomationOwnerFenceOperation,
  AutomationOwnerPrecondition
} from '../../shared/automation-owner-precondition'
import type { CoordinatedRunInspection } from '../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunActionAvailability as Availability } from '../../shared/coordinated-automation-run-view'
import { assertCoordinatedDefinitionLocalTarget } from './coordinated-definition-write-gate'
import type { RuntimeStore } from './runtime-store-contract'

/** Store-backed facts every coordinated run request revalidates before acting. */
type RunStore = Pick<
  RuntimeStore,
  | 'listAutomations'
  | 'listAutomationRuns'
  | 'assertAutomationOwnerFence'
  | 'automationOwnerPrecondition'
  | 'getRepo'
>

/** Parent admission for new manual runs: disabled coordinated definition, exact local owner. */
export function assertCoordinatedRunParent(
  store: RunStore,
  input: {
    runtimeId: string
    automationId: string
    expectedOwner: AutomationOwnerPrecondition
  },
  runtimeId: string,
  operation: AutomationOwnerFenceOperation
): void {
  if (input.runtimeId !== runtimeId) {
    throw new Error('Coordinated request belongs to a different runtime authority.')
  }
  const parent = store.listAutomations!().find((entry) => entry.id === input.automationId)
  if (!parent || parent.kind !== 'coordinated' || parent.enabled) {
    throw new Error('A disabled coordinated Automation is required.')
  }
  store.assertAutomationOwnerFence!({
    id: parent.id,
    expectedOwner: input.expectedOwner,
    operation
  })
  if (
    input.expectedOwner.selector.kind !== 'self' ||
    store.automationOwnerPrecondition!(parent.id)?.selector.kind !== 'self' ||
    parent.executionTargetType !== 'local' ||
    parent.schedulerOwner !== 'local_host_service'
  ) {
    throw new Error('Coordinated fake runs require a confirmed local desktop owner.')
  }
  assertCoordinatedDefinitionLocalTarget(store.getRepo(parent.projectId))
}

/** Run selection admission: exact local runtime, frozen self owner, live coordinated run. */
export function assertCoordinatedRunSelection(
  store: RunStore,
  input: {
    runtimeId: string
    automationId: string
    automationRunId: string
    expectedOwner: AutomationOwnerPrecondition
  },
  runtimeId: string
): void {
  if (input.runtimeId !== runtimeId || input.expectedOwner.selector.kind !== 'self') {
    throw new Error('Coordinated run selection requires the exact local runtime and frozen owner.')
  }
  const parent = store.listAutomations!().find((entry) => entry.id === input.automationId)
  if (!parent || parent.kind !== 'coordinated') {
    throw new Error('The coordinated parent is unavailable or archived.')
  }
  const run = store.listAutomationRuns!().find((entry) => entry.id === input.automationRunId)
  if (
    !run ||
    run.automationId !== input.automationId ||
    run.materializationPhase === undefined ||
    run.coordinatedQuarantine !== undefined
  ) {
    throw new Error(
      'Coordinated AutomationRun does not belong to this Automation or is unavailable.'
    )
  }
}

/** Run-scoped stop admission: host available, run not final, no stop recorded yet. */
export function stopActionAvailability(
  available: Availability,
  inspection: CoordinatedRunInspection
): Availability {
  if (!available.available) {
    return available
  }
  if (isFinalAutomationRunStatus(inspection.runStatus)) {
    return { available: false, state: 'refused', reason: 'The run is already settled.' }
  }
  if (inspection.operatorStop) {
    return {
      available: false,
      state: 'refused',
      reason: 'Operator stop is already recorded; awaiting exit evidence.'
    }
  }
  return { available: true, state: available.state }
}

/** Run-scoped retry admission mirrors per-stage eligibility: any eligible stage admits it. */
export function retryActionAvailability(
  available: Availability,
  inspection: CoordinatedRunInspection
): Availability {
  if (!available.available) {
    return available
  }
  for (const stage of inspection.stages) {
    if (stage.retryEligibility.canRetry) {
      return { available: true, state: stage.childDefinitionId }
    }
  }
  const reason = inspection.stages.find((stage) => stage.retryEligibility.reason)?.retryEligibility
    .reason
  return {
    available: false,
    state: 'refused',
    reason: reason ?? 'No stage of this run is eligible for a retry.'
  }
}

/** Run-scoped human resolution mirrors pending decision keys. */
export function humanResolutionActionAvailability(
  available: Availability,
  inspection: CoordinatedRunInspection
): Availability {
  if (!available.available) {
    return available
  }
  return inspection.humanResolution.available
    ? { available: true, state: 'pending_decisions' }
    : {
        available: false,
        state: 'refused',
        reason: inspection.humanResolution.reason ?? 'No pending human decisions.'
      }
}
