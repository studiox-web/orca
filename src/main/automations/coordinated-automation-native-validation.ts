import type { AutomationRun } from '../../shared/automations-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { DispatchContextRow, RunRow, TaskRow } from '../runtime/orchestration/types'
import {
  deterministicCoordinatedRunId,
  deterministicCoordinatedTaskId
} from './coordinated-automation-deterministic-ids'

/**
 * Pure native-record ownership checks shared by materialization (adoption) and read-only
 * inspection. Each returns null when the record is exactly the coordinated one, else a reason.
 */

export function coordinatedRunObjective(run: AutomationRun): string {
  return (
    run.resolvedSnapshot?.outcomeContract.humanStatement ||
    run.title ||
    'Coordinated Automation Run'
  )
}

export function nativeRunOwnershipProblem(
  native: RunRow,
  input: { exactRunId: string; linkedRunId: string | null; objective: string }
): string | null {
  return native.id !== input.exactRunId ||
    (input.linkedRunId !== null && native.id !== input.linkedRunId) ||
    native.objective !== input.objective ||
    native.coordinator_handle !== null ||
    native.coordinator_pane_key !== null ||
    native.coordinator_orca_session_id !== null ||
    native.coordinator_orca_session_id_generation !== 1 ||
    native.consumer_generation !== 1 ||
    native.legacy !== 0 ||
    native.home_database !== 'this_database'
    ? `Native Run "${input.exactRunId}" does not match coordinated run ownership or objective.`
    : null
}

/** Dependency Task IDs exactly as materialization writes them for this child. */
export function expectedChildDependencyTaskIds(
  orchestrationRunId: string,
  child: ResolvedChildSnapshot,
  enabledChildIds: ReadonlySet<string>
): string[] {
  return child.dependencies
    .filter((dep) => enabledChildIds.has(dep.childId))
    .map((dep) => deterministicCoordinatedTaskId(orchestrationRunId, dep.childId))
}

export function nativeTaskDefinitionProblem(
  task: TaskRow,
  input: {
    exactTaskId: string
    orchestrationRunId: string
    child: ResolvedChildSnapshot
    dependencyTaskIds: readonly string[]
    /** Adoption accepts only states materialization could have left; inspection accepts any. */
    requireAdoptableStatus: boolean
  }
): string | null {
  let deps: unknown
  try {
    deps = JSON.parse(task.deps ?? '[]')
  } catch {
    deps = null
  }
  const depsMatch =
    Array.isArray(deps) &&
    deps.length === input.dependencyTaskIds.length &&
    deps.every((dep, index) => dep === input.dependencyTaskIds[index])
  const adoptable = ['pending', 'ready', 'dispatched', 'completed'].includes(task.status)
  return task.id !== input.exactTaskId ||
    task.run_id !== input.orchestrationRunId ||
    task.parent_id !== null ||
    task.task_title !== input.child.name ||
    task.display_name !== input.child.name ||
    task.spec !== input.child.prompt.text ||
    !depsMatch ||
    task.created_by_terminal_handle !== null ||
    task.created_by_pane_key !== null ||
    task.created_by_process_incarnation !== null ||
    task.created_by_run_generation !== null ||
    (input.requireAdoptableStatus && !adoptable)
    ? `Native Task "${input.exactTaskId}" does not match coordinated child definition "${input.child.childDefinitionId}".`
    : null
}

/** A coordinator-created attempt of exactly this Task, with retry lineage inside the same Task. */
export function nativeDispatchLineageProblem(
  db: OrchestrationDb,
  dispatch: DispatchContextRow | undefined,
  input: { dispatchId: string; taskId: string; orchestrationRunId: string }
): string | null {
  if (
    !dispatch ||
    dispatch.id !== input.dispatchId ||
    dispatch.task_id !== input.taskId ||
    dispatch.run_id !== input.orchestrationRunId ||
    dispatch.creator_dispatch_id !== null ||
    dispatch.creator_handle !== null ||
    dispatch.creator_pane_key !== null ||
    dispatch.creator_orca_session_id !== null ||
    dispatch.follow_up_of_dispatch_id !== null
  ) {
    return `Dispatch ${input.dispatchId} is not a coordinator attempt of Task ${input.taskId}.`
  }
  const prior = dispatch.retry_of_dispatch_id
  if (prior !== null && db.getDispatchContextById(prior)?.task_id !== input.taskId) {
    return `Dispatch ${input.dispatchId} retries ${prior}, which is not an attempt of Task ${input.taskId}.`
  }
  return null
}

/**
 * The whole child mapping must be exactly the materialized one: one deterministic Task per
 * enabled child, unique and complete, each native Task matching its frozen definition and
 * dependencies, and each mapped Dispatch a coordinator attempt of that same Task.
 */
export function coordinatedMappingProblem(
  db: OrchestrationDb,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): string | null {
  const orchestrationRunId = run.orchestrationRunId
  if (!orchestrationRunId) {
    return 'The run has no linked orchestration Run.'
  }
  const exactRunId = deterministicCoordinatedRunId(run.id)
  const native = db.getRun(exactRunId)
  const runProblem = native
    ? nativeRunOwnershipProblem(native, {
        exactRunId,
        linkedRunId: orchestrationRunId,
        objective: coordinatedRunObjective(run)
      })
    : `Native Run "${exactRunId}" is missing.`
  if (runProblem) {
    return runProblem
  }
  const enabled = snapshot.resolvedChildren.filter((child) => child.enabled)
  const enabledIds = new Set(enabled.map((child) => child.childDefinitionId))
  const mappings = run.childMappings ?? []
  const childIds = mappings.map((m) => m.childDefinitionId)
  const taskIds = mappings.map((m) => m.taskId)
  if (
    new Set(childIds).size !== childIds.length ||
    new Set(taskIds).size !== taskIds.length ||
    childIds.length !== enabledIds.size ||
    childIds.some((id) => !enabledIds.has(id))
  ) {
    return 'Child mappings are not exactly one unique mapping per enabled child.'
  }
  for (const mapping of mappings) {
    const child = enabled.find((c) => c.childDefinitionId === mapping.childDefinitionId)!
    const exactTaskId = deterministicCoordinatedTaskId(orchestrationRunId, child.childDefinitionId)
    if (mapping.taskId !== exactTaskId) {
      return `Child "${child.childDefinitionId}" maps to Task ${mapping.taskId}, not its stable Task ${exactTaskId}.`
    }
    const task = db.getTask(exactTaskId)
    const taskProblem = task
      ? nativeTaskDefinitionProblem(task, {
          exactTaskId,
          orchestrationRunId,
          child,
          dependencyTaskIds: expectedChildDependencyTaskIds(orchestrationRunId, child, enabledIds),
          requireAdoptableStatus: false
        })
      : `Native Task "${exactTaskId}" is missing.`
    if (taskProblem) {
      return taskProblem
    }
    if (mapping.dispatchId) {
      const dispatchProblem = nativeDispatchLineageProblem(
        db,
        db.getDispatchContextById(mapping.dispatchId),
        { dispatchId: mapping.dispatchId, taskId: exactTaskId, orchestrationRunId }
      )
      if (dispatchProblem) {
        return dispatchProblem
      }
    }
  }
  return null
}
