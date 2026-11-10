import type { AutomationRun } from '../../shared/automations-types'
import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'
import { coordinatedRunProblem } from '../../shared/coordinated-automation-run-validation'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import {
  deterministicCoordinatedRunId,
  deterministicCoordinatedTaskId
} from './coordinated-automation-deterministic-ids'
import {
  coordinatedRunObjective,
  nativeRunOwnershipProblem,
  nativeTaskDefinitionProblem
} from './coordinated-automation-native-validation'

export class CoordinatedAutomationLaunchRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedAutomationLaunchRefusedError'
  }
}

export function orchestrationRecordProbe(db: OrchestrationDb): CoordinatedOrchestrationRecordProbe {
  return {
    hasRun: (orchestrationRunId: string) => Boolean(db.getRun(orchestrationRunId)),
    hasTask: (orchestrationRunId: string, taskId: string) => {
      const task = db.getTask(taskId)
      return Boolean(task && task.run_id === orchestrationRunId)
    }
  }
}

export function topologicallySortChildren(
  children: readonly ResolvedChildSnapshot[]
): ResolvedChildSnapshot[] {
  const childMap = new Map(children.map((child) => [child.childDefinitionId, child]))
  const visited = new Set<string>()
  const sorted: ResolvedChildSnapshot[] = []

  function visit(childId: string): void {
    if (visited.has(childId)) {
      return
    }
    visited.add(childId)
    const child = childMap.get(childId)
    if (!child) {
      return
    }
    for (const dep of child.dependencies) {
      if (childMap.has(dep.childId)) {
        visit(dep.childId)
      }
    }
    sorted.push(child)
  }

  for (const child of children) {
    visit(child.childDefinitionId)
  }
  return sorted
}

export function materializeCoordinatedRun(
  store: Store,
  orchestrationDb: OrchestrationDb,
  probe: CoordinatedOrchestrationRecordProbe,
  automationRunId: string
): AutomationRun {
  const runFound = store.listAutomationRuns().find((r) => r.id === automationRunId)
  if (!runFound) {
    throw new Error(`Automation run "${automationRunId}" not found.`)
  }
  let run = runFound

  const automation = store.listAutomations().find((a) => a.id === run.automationId)
  if (!automation) {
    throw new CoordinatedAutomationLaunchRefusedError(`Automation "${run.automationId}" not found.`)
  }
  if (run.coordinatedQuarantine !== undefined) {
    throw new CoordinatedAutomationLaunchRefusedError(
      `Coordinated run is quarantined: ${run.coordinatedQuarantine.reason}`
    )
  }
  if (run.status === 'completed' && (!run.completionReceipt || !run.completionTrust)) {
    throw new CoordinatedAutomationLaunchRefusedError(
      `Completed coordinated run "${run.id}" is missing a valid completionReceipt or completionTrust.`
    )
  }
  const problem = coordinatedRunProblem(run)
  if (problem) {
    if (run.materializationPhase !== 'ready_for_dispatch') {
      store.recordCoordinatedMaterializationFailure({
        automationRunId,
        phase: 'materialization_failed',
        error: problem
      })
    }
    throw new CoordinatedAutomationLaunchRefusedError(problem)
  }

  if (run.materializationPhase === 'ready_for_dispatch') {
    return run
  }

  if (run.materializationPhase === 'intent_persisted') {
    const exactRunId = run.orchestrationRunId ?? deterministicCoordinatedRunId(run.id)
    const existingRun = orchestrationDb.getRun(exactRunId)
    const objective = coordinatedRunObjective(run)

    if (existingRun) {
      const problem = nativeRunOwnershipProblem(existingRun, {
        exactRunId,
        linkedRunId: run.orchestrationRunId ?? null,
        objective
      })
      if (problem) {
        throw new CoordinatedAutomationLaunchRefusedError(
          `Existing native Run "${exactRunId}" does not match coordinated run ownership or objective.`
        )
      }
    } else {
      orchestrationDb.createRun({
        id: exactRunId,
        objective,
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
    }
    run = store.linkCoordinatedOrchestrationRun({
      automationRunId: run.id,
      orchestrationRunId: exactRunId,
      probe
    })
  }

  if (run.materializationPhase === 'orchestration_run_created') {
    const snapshot = run.resolvedSnapshot!
    const includedChildren = topologicallySortChildren(
      snapshot.resolvedChildren.filter((child) => child.enabled)
    )
    const childToTask = new Map<string, string>()
    const createdTaskIds: string[] = []

    for (const child of includedChildren) {
      const exactTaskId = deterministicCoordinatedTaskId(
        run.orchestrationRunId!,
        child.childDefinitionId
      )
      childToTask.set(child.childDefinitionId, exactTaskId)
      createdTaskIds.push(exactTaskId)

      const deps = child.dependencies
        .map((d) => childToTask.get(d.childId))
        .filter((id): id is string => Boolean(id))

      const existingTask = orchestrationDb.getTask(exactTaskId)
      if (existingTask) {
        const problem = nativeTaskDefinitionProblem(existingTask, {
          exactTaskId,
          orchestrationRunId: run.orchestrationRunId!,
          child,
          dependencyTaskIds: deps,
          requireAdoptableStatus: true
        })
        if (problem) {
          throw new CoordinatedAutomationLaunchRefusedError(
            `Existing ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`
          )
        }
      } else {
        orchestrationDb.createTask({
          id: exactTaskId,
          runId: run.orchestrationRunId!,
          spec: child.prompt.text,
          displayName: child.name,
          taskTitle: child.name,
          deps
        })
      }
    }

    run = store.recordCoordinatedTasksCreated({
      automationRunId: run.id,
      taskIds: createdTaskIds,
      probe
    })
  }

  if (run.materializationPhase === 'tasks_created') {
    const snapshot = run.resolvedSnapshot!
    const includedChildren = topologicallySortChildren(
      snapshot.resolvedChildren.filter((child) => child.enabled)
    )
    const mappings = includedChildren.map((child) => ({
      childDefinitionId: child.childDefinitionId,
      taskId: deterministicCoordinatedTaskId(run.orchestrationRunId!, child.childDefinitionId)
    }))

    run = store.persistCoordinatedChildMappings({
      automationRunId: run.id,
      mappings,
      probe
    })
  }

  if (run.materializationPhase === 'mappings_persisted') {
    run = store.markCoordinatedRunReadyForDispatch({
      automationRunId: run.id,
      probe
    })
  }

  return run
}
