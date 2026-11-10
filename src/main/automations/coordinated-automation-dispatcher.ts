import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import {
  createFileCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import { acceptedStageIds } from './coordinated-automation-native-readiness'
import { selectEligibleTasksForDispatch } from './coordinated-automation-lane-scheduler'
import { executeCoordinatedTaskDispatch } from './coordinated-automation-task-execution'
import type { CoordinatedRecoveryContext } from './coordinated-automation-recovery-context'

export const defaultCoordinatedProgressStore = (): CoordinatedRunProgressStore =>
  createFileCoordinatedRunProgressStore(
    join(getAppEnvironment().getPath('userData'), 'coordinated-automation-progress')
  )

export function createCoordinatedAutomationDispatcher(
  adapter: CoordinatedAutomationAdapter,
  fallbackDispatcher?: HeadlessAutomationDispatcher
): HeadlessAutomationDispatcher {
  return async (request) => {
    if (!isCoordinatedAutomation(request.automation)) {
      if (!fallbackDispatcher) {
        throw new Error('No fallback dispatcher provided for single automation.')
      }
      return fallbackDispatcher(request)
    }
    return adapter.dispatch(request)
  }
}

/**
 * Low-level native dispatch of every ready Task whose dependencies are durably accepted.
 * Native readiness is never enough on its own; this is a test/operator convenience over the
 * same `executeCoordinatedTaskDispatch` path the reconciler uses.
 */
export async function dispatchReadyCoordinatedTasks(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun
): Promise<{ taskId: string; dispatchId: string; outcome: string }[]> {
  if (run.status === 'completed' || run.completionReceipt) {
    return []
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot || !run.orchestrationRunId) {
    throw new Error(`Run "${run.id}" is not ready for dispatch.`)
  }
  const tasks = ctx.orchestrationDb.listTasks({ runId: run.orchestrationRunId })
  const accepted = acceptedStageIds(ctx.progressStore.read(run.id))
  const childByTask = new Map(
    (run.childMappings ?? []).map((m) => [m.taskId, m.childDefinitionId] as const)
  )
  const readyTasks = tasks.filter((task) => {
    const child = snapshot.resolvedChildren.find(
      (c) => c.childDefinitionId === childByTask.get(task.id)
    )
    return (
      task.status === 'ready' &&
      child !== undefined &&
      !accepted.has(child.childDefinitionId) &&
      child.dependencies.every((dep) => accepted.has(dep.childId))
    )
  })
  const childMap = new Map(snapshot.resolvedChildren.map((c) => [c.childDefinitionId, c]))
  const taskToChild = new Map(
    (run.childMappings ?? []).flatMap((m) => {
      const child = childMap.get(m.childDefinitionId)
      return child ? [[m.taskId, child] as const] : []
    })
  )
  const candidateTasks = selectEligibleTasksForDispatch({
    readyTasks,
    inFlightTasks: tasks.filter(
      (task) => task.status === 'dispatched' || ctx.inFlightTaskIds.has(task.id)
    ),
    taskToChild,
    maxConcurrency: snapshot.globalCeilings?.maxConcurrency ?? Infinity
  })
  return Promise.all(
    candidateTasks.map(async (task) => {
      ctx.inFlightTaskIds.add(task.id)
      try {
        return await executeCoordinatedTaskDispatch(ctx, {
          automationRunId: run.id,
          taskId: task.id
        })
      } finally {
        ctx.inFlightTaskIds.delete(task.id)
      }
    })
  )
}
