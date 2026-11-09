import type { Automation, AutomationRun } from '../../shared/automations-types'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import type {
  HeadlessAutomationDispatcher,
  HeadlessAutomationDispatchLaunch
} from './headless-dispatch'
import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'
import {
  CoordinatedAutomationLaunchRefusedError,
  materializeCoordinatedRun,
  orchestrationRecordProbe
} from './coordinated-automation-materialization'
import { selectEligibleTasksForDispatch } from './coordinated-automation-lane-scheduler'

export { CoordinatedAutomationLaunchRefusedError, orchestrationRecordProbe }

export type CoordinatedWorkerIdentity = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
}>

export type CoordinatedWorkerProvider = {
  run: (identity: CoordinatedWorkerIdentity) => Promise<StructuredWorkerResult>
}

export type CoordinatedAutomationAdapterContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  workerProvider?: CoordinatedWorkerProvider
  runInParentLane?: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
}

export class CoordinatedAutomationAdapter {
  readonly #store: Store
  readonly #orchestrationDb: OrchestrationDb
  readonly #workerProvider: CoordinatedWorkerProvider
  readonly #probe: CoordinatedOrchestrationRecordProbe
  readonly #runInParentLane: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  readonly #parentLanes = new Map<string, Promise<void>>()
  readonly #activeTasks = new Set<string>()

  constructor(ctx: CoordinatedAutomationAdapterContext) {
    this.#store = ctx.store
    this.#orchestrationDb = ctx.orchestrationDb
    this.#probe = orchestrationRecordProbe(ctx.orchestrationDb)
    this.#workerProvider = ctx.workerProvider ?? {
      run: async (identity) => ({
        schemaVersion: 1,
        ...identity,
        definitionRevision: 1,
        resolvedConfigDigest: '',
        outcome: 'succeeded',
        summary: `Fake worker ${identity.childDefinitionId} completed`,
        reportMarkdown: `Fake worker ${identity.childDefinitionId} report`,
        artifacts: [],
        checks: [],
        effects: [],
        blockers: []
      })
    }
    this.#runInParentLane =
      ctx.runInParentLane ??
      ((automationId, op) => runKeyedSerializedOperation(this.#parentLanes, automationId, op))
  }

  get probe(): CoordinatedOrchestrationRecordProbe {
    return this.#probe
  }

  async runInParentLane<T>(automationId: string, operation: () => Promise<T>): Promise<T> {
    return this.#runInParentLane(automationId, operation)
  }

  async materializeRun(automationRunId: string): Promise<AutomationRun> {
    return materializeCoordinatedRun(
      this.#store,
      this.#orchestrationDb,
      this.#probe,
      automationRunId
    )
  }

  async dispatchTask(
    automationRunId: string,
    taskId: string,
    retryOfDispatchId?: string
  ): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
    const run = this.#getRunOrThrow(automationRunId)
    const snapshot = run.resolvedSnapshot
    if (!snapshot || !run.orchestrationRunId) {
      throw new Error(`Run "${automationRunId}" is not ready for dispatch.`)
    }

    const mapping = (run.childMappings ?? []).find((m) => m.taskId === taskId)
    if (!mapping) {
      throw new Error(
        `Task "${taskId}" has no mapped child definition in run "${automationRunId}".`
      )
    }
    const child = snapshot.resolvedChildren.find(
      (c) => c.childDefinitionId === mapping.childDefinitionId
    )
    if (!child) {
      throw new Error(`Child definition "${mapping.childDefinitionId}" not found in snapshot.`)
    }

    const { dispatch } = this.#orchestrationDb.createStartingWorkerDispatch({
      taskId,
      taskRunId: run.orchestrationRunId,
      retryOf: retryOfDispatchId,
      creator: { kind: 'system' },
      maxDepth: 5,
      startOptions: {
        agent: child.launchConfig.agentId,
        mode: { mode: 'headless' },
        timeoutMs: (child.launchConfig.timeoutSeconds ?? 60) * 1000
      }
    })

    this.#store.recordCoordinatedChildDispatch({
      automationRunId: run.id,
      childDefinitionId: child.childDefinitionId,
      dispatchId: dispatch.id
    })

    this.#activeTasks.add(taskId)
    try {
      const identity: CoordinatedWorkerIdentity = {
        automationRunId: run.id,
        orchestrationRunId: run.orchestrationRunId,
        childDefinitionId: child.childDefinitionId,
        taskId,
        dispatchId: dispatch.id
      }

      let report: StructuredWorkerResult
      try {
        report = await this.#workerProvider.run(identity)
      } catch (error) {
        this.#orchestrationDb.settleWorkerReport({
          taskId,
          dispatchId: dispatch.id,
          outcome: 'failed',
          result: error instanceof Error ? error.message : String(error)
        })
        return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
      }

      // External effects are denied in Phase 4; only fake worker provider runs.
      if (report.effects && report.effects.length > 0) {
        this.#orchestrationDb.settleWorkerReport({
          taskId,
          dispatchId: dispatch.id,
          outcome: 'failed',
          result: 'External effects are denied.'
        })
        return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
      }

      const outcome = report.outcome === 'succeeded' ? 'succeeded' : 'failed'
      this.#orchestrationDb.settleWorkerReport({
        taskId,
        dispatchId: dispatch.id,
        outcome,
        result: report.summary || JSON.stringify(report)
      })

      return { taskId, dispatchId: dispatch.id, outcome: report.outcome }
    } finally {
      this.#activeTasks.delete(taskId)
    }
  }

  async retryTask(input: {
    automationRunId: string
    taskId: string
    retryOfDispatchId: string
  }): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
    return this.dispatchTask(input.automationRunId, input.taskId, input.retryOfDispatchId)
  }

  async dispatchReadyTasks(
    automationRunId: string
  ): Promise<{ taskId: string; dispatchId: string; outcome: string }[]> {
    const run = this.#getRunOrThrow(automationRunId)
    const snapshot = run.resolvedSnapshot
    if (!snapshot || !run.orchestrationRunId) {
      throw new Error(`Run "${automationRunId}" is not ready for dispatch.`)
    }

    const tasks = this.#orchestrationDb.listTasks({ runId: run.orchestrationRunId })
    const readyTasks = tasks.filter((t) => t.status === 'ready')
    if (readyTasks.length === 0) {
      return []
    }

    const childMap = new Map(snapshot.resolvedChildren.map((c) => [c.childDefinitionId, c]))
    const taskToChild = new Map(
      (run.childMappings ?? []).map((m) => [m.taskId, childMap.get(m.childDefinitionId)!])
    )

    const inFlightTasks = tasks.filter(
      (t) => t.status === 'dispatched' || this.#activeTasks.has(t.id)
    )
    const maxConcurrency = snapshot.globalCeilings?.maxConcurrency ?? Infinity

    const candidateTasks = selectEligibleTasksForDispatch({
      readyTasks,
      inFlightTasks,
      taskToChild,
      maxConcurrency
    })

    if (candidateTasks.length === 0) {
      return []
    }

    const results = await Promise.all(
      candidateTasks.map((task) => this.dispatchTask(automationRunId, task.id))
    )
    return results
  }

  async runUntilSettled(automationRunId: string): Promise<AutomationRun> {
    let run = this.#getRunOrThrow(automationRunId)
    run = await this.runInParentLane(run.automationId, () => this.materializeRun(automationRunId))

    while (true) {
      const tasks = this.#orchestrationDb.listTasks({ runId: run.orchestrationRunId! })
      const allSettled = tasks.every((t) => t.status === 'completed' || t.status === 'failed')
      if (allSettled) {
        const anyFailed = tasks.some((t) => t.status === 'failed')
        run = this.#store.recordCoordinatedRunSettlement({
          automationRunId: run.id,
          status: anyFailed ? 'dispatch_failed' : 'completed',
          error: anyFailed ? 'One or more tasks failed.' : null
        })
        break
      }

      const dispatched = await this.dispatchReadyTasks(run.id)
      if (dispatched.length === 0 && this.#activeTasks.size === 0) {
        // No progress possible (e.g. unresolvable dependency failure).
        const tasksAfter = this.#orchestrationDb.listTasks({ runId: run.orchestrationRunId! })
        const anyFailed = tasksAfter.some((t) => t.status === 'failed')
        run = this.#store.recordCoordinatedRunSettlement({
          automationRunId: run.id,
          status: 'dispatch_failed',
          error: anyFailed ? 'Prerequisite tasks failed.' : 'No runnable tasks.'
        })
        break
      }
    }

    return run
  }

  async dispatch(request: {
    automation: Automation
    run: AutomationRun
  }): Promise<HeadlessAutomationDispatchLaunch> {
    const runId = request.run.id
    const completionPromise = this.runUntilSettled(runId)
    return {
      sessionKind: 'terminal',
      workspaceId: request.automation.workspaceId ?? '',
      terminalSessionId: null,
      completion: completionPromise.then(
        (finalRun) => ({
          status: finalRun.status === 'completed' ? 'completed' : 'dispatch_failed',
          error: finalRun.error ?? null
        }),
        (error) => ({
          status: 'dispatch_failed',
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  #getRunOrThrow(automationRunId: string): AutomationRun {
    const run = this.#store.listAutomationRuns().find((r) => r.id === automationRunId)
    if (!run) {
      throw new Error(`Automation run "${automationRunId}" not found.`)
    }
    return run
  }
}

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
