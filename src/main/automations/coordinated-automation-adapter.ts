import type { Automation, AutomationRun } from '../../shared/automations-types'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type {
  SemanticReceiptEffect,
  StructuredWorkerResult
} from '../../shared/coordinated-automation-receipt-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import type {
  HeadlessAutomationDispatcher,
  HeadlessAutomationDispatchLaunch
} from './headless-dispatch'
import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'
import type {
  CoordinatedHostApproval,
  CoordinatedParentHostApproval,
  CoordinatedStageHostApproval
} from './coordinated-automation-approval-validation'
import {
  CoordinatedAutomationLaunchRefusedError,
  materializeCoordinatedRun,
  orchestrationRecordProbe
} from './coordinated-automation-materialization'
import { selectEligibleTasksForDispatch } from './coordinated-automation-lane-scheduler'
import {
  createDefaultFakeNoEffectsWorkerProvider,
  executeCoordinatedTaskDispatch
} from './coordinated-automation-task-execution'
import {
  evaluateParentOutcomeAcceptance,
  reconcilePersistedCompletionReceipt
} from './coordinated-automation-parent-acceptance'

export {
  type CoordinatedHostApproval,
  type CoordinatedParentHostApproval,
  type CoordinatedStageHostApproval,
  CoordinatedAutomationLaunchRefusedError,
  orchestrationRecordProbe
}

export type CoordinatedWorkerIdentity = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
}>

export type CoordinatedWorkerProvider = {
  capability?: string
  capabilities?: readonly string[]
  run: (identity: CoordinatedWorkerIdentity) => Promise<StructuredWorkerResult>
}

export type CoordinatedAutomationAdapterContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  workerProvider?: CoordinatedWorkerProvider
  runInParentLane?: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  hostApprovals?: readonly CoordinatedHostApproval[]
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  workspacePath?: string
  trustedAuthorIdentity?: string
}

export class CoordinatedAutomationAdapter {
  readonly #store: Store
  readonly #orchestrationDb: OrchestrationDb
  readonly #workerProvider: CoordinatedWorkerProvider
  readonly #probe: CoordinatedOrchestrationRecordProbe
  readonly #runInParentLane: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  readonly #hostApprovals?: readonly CoordinatedHostApproval[]
  readonly #hostEffectReceipts?: readonly SemanticReceiptEffect[]
  readonly #workspacePath?: string
  readonly #trustedAuthorIdentity?: string
  readonly #parentLanes = new Map<string, Promise<void>>()
  readonly #activeTasks = new Set<string>()

  constructor(ctx: CoordinatedAutomationAdapterContext) {
    this.#store = ctx.store
    this.#orchestrationDb = ctx.orchestrationDb
    this.#probe = orchestrationRecordProbe(ctx.orchestrationDb)
    this.#hostApprovals = ctx.hostApprovals
    this.#hostEffectReceipts = ctx.hostEffectReceipts
    this.#workspacePath = ctx.workspacePath
    this.#trustedAuthorIdentity = ctx.trustedAuthorIdentity
    this.#workerProvider = ctx.workerProvider ?? createDefaultFakeNoEffectsWorkerProvider(ctx.store)
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
    this.#activeTasks.add(taskId)
    try {
      return await executeCoordinatedTaskDispatch({
        automationRunId,
        taskId,
        retryOfDispatchId,
        store: this.#store,
        orchestrationDb: this.#orchestrationDb,
        probe: this.#probe,
        workerProvider: this.#workerProvider,
        hostApprovals: this.#hostApprovals,
        hostEffectReceipts: this.#hostEffectReceipts,
        workspacePath: this.#workspacePath,
        trustedAuthorIdentity: this.#trustedAuthorIdentity
      })
    } finally {
      this.#activeTasks.delete(taskId)
    }
  }

  async retryTask(input: { automationRunId: string; taskId: string; retryOfDispatchId: string }) {
    return this.dispatchTask(input.automationRunId, input.taskId, input.retryOfDispatchId)
  }

  async dispatchReadyTasks(
    automationRunId: string
  ): Promise<{ taskId: string; dispatchId: string; outcome: string }[]> {
    const run = this.#getRunOrThrow(automationRunId)
    if (
      reconcilePersistedCompletionReceipt({
        run,
        store: this.#store,
        trustedAuthorIdentity: this.#trustedAuthorIdentity
      })
    ) {
      return []
    }
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
    const candidateTasks = selectEligibleTasksForDispatch({
      readyTasks,
      inFlightTasks,
      taskToChild,
      maxConcurrency: snapshot.globalCeilings?.maxConcurrency ?? Infinity
    })
    return candidateTasks.length === 0
      ? []
      : Promise.all(candidateTasks.map((task) => this.dispatchTask(automationRunId, task.id)))
  }

  async runUntilSettled(automationRunId: string): Promise<AutomationRun> {
    let run = this.#getRunOrThrow(automationRunId)
    run = await this.runInParentLane(run.automationId, () => this.materializeRun(automationRunId))
    const reconciled = reconcilePersistedCompletionReceipt({
      run,
      store: this.#store,
      trustedAuthorIdentity: this.#trustedAuthorIdentity
    })
    if (reconciled) {
      return reconciled
    }

    while (true) {
      const tasks = this.#orchestrationDb.listTasks({ runId: run.orchestrationRunId! })
      const allSettled = tasks.every((t) => t.status === 'completed' || t.status === 'failed')
      if (allSettled) {
        run = this.#getRunOrThrow(automationRunId)
        const anyFailed = tasks.some((t) => t.status === 'failed')
        if (anyFailed) {
          run = this.#store.recordCoordinatedRunSettlement({
            automationRunId: run.id,
            status: 'dispatch_failed',
            error: 'One or more tasks failed.'
          })
          break
        }

        const acceptance = evaluateParentOutcomeAcceptance({
          run,
          snapshot: run.resolvedSnapshot!,
          orchestrationDb: this.#orchestrationDb,
          probe: this.#probe,
          trustedAuthorIdentity: this.#trustedAuthorIdentity,
          hostApprovals: this.#hostApprovals,
          hostEffectReceipts: this.#hostEffectReceipts
        })

        if (!acceptance.accepted) {
          run = this.#store.recordCoordinatedRunSettlement({
            automationRunId: run.id,
            status: 'dispatch_failed',
            error: `Parent outcome acceptance validation failed: ${acceptance.errors.join('; ')}`
          })
          break
        }

        run = this.#store.recordCoordinatedRunSettlement({
          automationRunId: run.id,
          status: 'completed',
          error: null,
          completionReceipt: acceptance.receipt,
          completionTrust: acceptance.trust
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
    return {
      sessionKind: 'terminal',
      workspaceId: request.automation.workspaceId ?? '',
      terminalSessionId: null,
      completion: this.runUntilSettled(request.run.id).then(
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
