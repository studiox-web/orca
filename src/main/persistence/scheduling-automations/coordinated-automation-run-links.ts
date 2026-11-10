import type { AutomationRun } from '../../../shared/automations-types'
import { detachCoordinatedRun } from '../../../shared/coordinated-automation-run-seal'
import type { CoordinatedRunChildMapping } from '../../../shared/coordinated-automation-saga-types'
import type { SemanticCompletionReceipt } from '../../../shared/coordinated-automation-receipt-types'
import type { CoordinatedCompletionTrust } from '../../../shared/coordinated-automation-types'
import { coordinatedRunProblem } from '../../../shared/coordinated-automation-run-validation'
import {
  assertPhase,
  CoordinatedRunConflictError,
  isCoordinatedRunDispatchable,
  mappingProblem,
  replaceRun,
  requireCoordinatedRun,
  type CoordinatedAutomationRunOperations,
  type CoordinatedOrchestrationRecordProbe
} from './coordinated-automation-run-records'

export function linkCoordinatedOrchestrationRun(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    orchestrationRunId: string
    probe: CoordinatedOrchestrationRecordProbe
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  if (run.orchestrationRunId) {
    if (run.orchestrationRunId !== input.orchestrationRunId) {
      throw new CoordinatedRunConflictError('Run is already linked to another orchestration Run.')
    }
    return detachCoordinatedRun(run)
  }
  assertPhase(run, ['intent_persisted'])
  if (!input.orchestrationRunId || !input.probe.hasRun(input.orchestrationRunId)) {
    throw new CoordinatedRunConflictError(
      'Orchestration Run must exist before an AutomationRun links to it.'
    )
  }
  const claimed = operations.state.automationRuns.find(
    (other) => other.id !== run.id && other.orchestrationRunId === input.orchestrationRunId
  )
  if (claimed) {
    throw new CoordinatedRunConflictError(
      'Orchestration Run is already linked to another AutomationRun.'
    )
  }
  return replaceRun(operations, {
    ...run,
    orchestrationRunId: input.orchestrationRunId,
    materializationPhase: 'orchestration_run_created'
  })
}

export function recordCoordinatedTasksCreated(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    taskIds: readonly string[]
    probe: CoordinatedOrchestrationRecordProbe
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  if (run.materializationPhase === 'tasks_created') {
    return detachCoordinatedRun(run)
  }
  assertPhase(run, ['orchestration_run_created'])
  const orchestrationRunId = run.orchestrationRunId
  if (!orchestrationRunId || !input.probe.hasRun(orchestrationRunId)) {
    throw new CoordinatedRunConflictError('Run has no linked orchestration Run.')
  }
  for (const taskId of input.taskIds) {
    if (!input.probe.hasTask(orchestrationRunId, taskId)) {
      throw new CoordinatedRunConflictError(
        `Task "${taskId}" does not exist in orchestration Run "${orchestrationRunId}".`
      )
    }
  }
  return replaceRun(operations, {
    ...run,
    materializationPhase: 'tasks_created'
  })
}

function sameMappings(
  left: readonly CoordinatedRunChildMapping[],
  right: readonly CoordinatedRunChildMapping[]
): boolean {
  const key = (m: CoordinatedRunChildMapping): string => `${m.childDefinitionId}\u0000${m.taskId}`
  const leftKeys = new Set(left.map(key))
  return left.length === right.length && right.every((m) => leftKeys.has(key(m)))
}

export function persistCoordinatedChildMappings(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    mappings: readonly CoordinatedRunChildMapping[]
    probe: CoordinatedOrchestrationRecordProbe
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  const orchestrationRunId = run.orchestrationRunId
  if (
    (run.materializationPhase === 'mappings_persisted' ||
      run.materializationPhase === 'ready_for_dispatch') &&
    sameMappings(run.childMappings ?? [], input.mappings)
  ) {
    return detachCoordinatedRun(run)
  }
  assertPhase(run, ['orchestration_run_created', 'tasks_created'])
  if (!orchestrationRunId || !run.resolvedSnapshot) {
    throw new CoordinatedRunConflictError('Run has no linked orchestration Run.')
  }
  const problem = mappingProblem(run.resolvedSnapshot, input.mappings)
  if (problem) {
    throw new CoordinatedRunConflictError(problem)
  }
  for (const mapping of input.mappings) {
    if (mapping.dispatchId) {
      throw new CoordinatedRunConflictError('Child mappings are persisted before any Dispatch.')
    }
    if (!input.probe.hasTask(orchestrationRunId, mapping.taskId)) {
      throw new CoordinatedRunConflictError(
        `Task "${mapping.taskId}" does not exist in orchestration Run "${orchestrationRunId}".`
      )
    }
  }
  return replaceRun(operations, {
    ...run,
    childMappings: input.mappings.map((m) => ({
      childDefinitionId: m.childDefinitionId,
      taskId: m.taskId,
      dispatchId: null
    })),
    materializationPhase: 'mappings_persisted'
  })
}

export function markCoordinatedRunReadyForDispatch(
  operations: CoordinatedAutomationRunOperations,
  input: { automationRunId: string; probe: CoordinatedOrchestrationRecordProbe }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  if (run.materializationPhase === 'ready_for_dispatch') {
    return detachCoordinatedRun(run)
  }
  assertPhase(run, ['mappings_persisted'])
  const orchestrationRunId = run.orchestrationRunId
  if (
    !orchestrationRunId ||
    !input.probe.hasRun(orchestrationRunId) ||
    !(run.childMappings ?? []).every((m) => input.probe.hasTask(orchestrationRunId, m.taskId))
  ) {
    throw new CoordinatedRunConflictError('Linked orchestration records are no longer present.')
  }
  const ready: AutomationRun = { ...run, materializationPhase: 'ready_for_dispatch' }
  if (!isCoordinatedRunDispatchable(ready)) {
    throw new CoordinatedRunConflictError('Coordinated run links are incomplete.')
  }
  return replaceRun(operations, ready)
}

export function recordCoordinatedMaterializationFailure(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    phase: 'orphaned_reconciling' | 'materialization_failed' | 'compensation_failed'
    error: string
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  if (run.materializationPhase === 'ready_for_dispatch') {
    throw new CoordinatedRunConflictError(
      'A dispatchable run cannot be marked as a failed materialization.'
    )
  }
  const terminal = input.phase !== 'orphaned_reconciling'
  return replaceRun(operations, {
    ...run,
    materializationPhase: input.phase,
    materializationError: input.error,
    ...(terminal ? { status: 'dispatch_failed' as const, error: input.error } : {})
  })
}

export function recordCoordinatedChildDispatch(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    childDefinitionId: string
    dispatchId: string
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  assertPhase(run, ['ready_for_dispatch'])
  const orchestrationRunId = run.orchestrationRunId
  if (!orchestrationRunId) {
    throw new CoordinatedRunConflictError('Run has no linked orchestration Run.')
  }
  const mappings = run.childMappings ?? []
  const mappingIndex = mappings.findIndex((m) => m.childDefinitionId === input.childDefinitionId)
  if (mappingIndex === -1) {
    throw new CoordinatedRunConflictError(
      `Child "${input.childDefinitionId}" is not mapped in this run.`
    )
  }
  const updatedMappings = mappings.map((m) =>
    m.childDefinitionId === input.childDefinitionId ? { ...m, dispatchId: input.dispatchId } : m
  )
  return replaceRun(operations, {
    ...run,
    status: 'dispatched',
    dispatchedAt: run.dispatchedAt ?? Date.now(),
    childMappings: updatedMappings
  })
}

export function recordCoordinatedRunSettlement(
  operations: CoordinatedAutomationRunOperations,
  input: {
    automationRunId: string
    status: 'completed' | 'dispatch_failed'
    error?: string | null
    completionReceipt?: SemanticCompletionReceipt | null
    completionTrust?: CoordinatedCompletionTrust | null
  }
): AutomationRun {
  const run = requireCoordinatedRun(operations, input.automationRunId)
  assertPhase(run, ['ready_for_dispatch'])

  if (input.status === 'completed') {
    if (!input.completionReceipt || !input.completionTrust) {
      throw new Error(
        `Cannot settle run "${input.automationRunId}" as completed without trusted completionReceipt and completionTrust.`
      )
    }
  }

  const updatedRun: AutomationRun = {
    ...run,
    status: input.status,
    error: input.error ?? null,
    ...(input.completionReceipt !== undefined
      ? { completionReceipt: input.completionReceipt }
      : {}),
    ...(input.completionTrust !== undefined ? { completionTrust: input.completionTrust } : {})
  }

  if (input.status === 'completed') {
    const problem = coordinatedRunProblem(updatedRun)
    if (problem) {
      throw new Error(`Cannot settle coordinated run "${input.automationRunId}": ${problem}`)
    }
  }

  return replaceRun(operations, updatedRun)
}
