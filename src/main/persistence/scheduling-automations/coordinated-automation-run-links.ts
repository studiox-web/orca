import type { AutomationRun } from '../../../shared/automations-types'
import type { CoordinatedRunChildMapping } from '../../../shared/coordinated-automation-saga-types'
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
    return run
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
    return run
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
    return run
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
