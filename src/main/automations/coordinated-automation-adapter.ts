import type { Automation, AutomationRun } from '../../shared/automations-types'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
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
  createMemoryCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import type { CoordinatedBoundaryHook } from './coordinated-automation-progress-ledger'
import type {
  CoordinatedClock,
  CoordinatedFakeEffectAdapter,
  CoordinatedLaneLockProvider,
  CoordinatedRecoveryContext,
  CoordinatedWorkerIdentity,
  CoordinatedWorkerProvider
} from './coordinated-automation-recovery-context'
import {
  type CoordinatedRunOutcome,
  reconcileCoordinatedRun
} from './coordinated-automation-run-reconciler'
import {
  type CoordinatedReportSubmission,
  submitCoordinatedWorkerReport
} from './coordinated-automation-report-submission'

export {
  type CoordinatedHostApproval,
  type CoordinatedParentHostApproval,
  type CoordinatedStageHostApproval,
  type CoordinatedRunOutcome,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider,
  CoordinatedAutomationLaunchRefusedError,
  orchestrationRecordProbe
}

export type CoordinatedAutomationAdapterContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  workerProvider?: CoordinatedWorkerProvider
  runInParentLane?: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  /** Host-owned approvals; a function is re-read at every evaluation. */
  hostApprovals?: readonly CoordinatedHostApproval[] | (() => readonly CoordinatedHostApproval[])
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  workspacePath?: string
  trustedAuthorIdentity?: string
  /** Durable progress; defaults to process memory, which does not survive restart. */
  progressStore?: CoordinatedRunProgressStore
  clock?: CoordinatedClock
  durableBoundary?: CoordinatedBoundaryHook
  effectAdapter?: CoordinatedFakeEffectAdapter
  laneLocks?: CoordinatedLaneLockProvider
}

export class CoordinatedAutomationAdapter {
  readonly #ctx: CoordinatedRecoveryContext
  readonly #runInParentLane: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  readonly #parentLanes = new Map<string, Promise<void>>()

  constructor(ctx: CoordinatedAutomationAdapterContext) {
    const approvals = ctx.hostApprovals
    this.#ctx = {
      store: ctx.store,
      orchestrationDb: ctx.orchestrationDb,
      probe: orchestrationRecordProbe(ctx.orchestrationDb),
      workerProvider: ctx.workerProvider ?? createDefaultFakeNoEffectsWorkerProvider(ctx.store),
      progressStore: ctx.progressStore ?? createMemoryCoordinatedRunProgressStore(),
      clock: ctx.clock ?? { now: () => Date.now() },
      boundary: ctx.durableBoundary ?? (() => {}),
      hostApprovals: typeof approvals === 'function' ? approvals : () => approvals ?? [],
      hostEffectReceipts: ctx.hostEffectReceipts,
      effectAdapter: ctx.effectAdapter,
      laneLocks: ctx.laneLocks,
      workspacePath: ctx.workspacePath,
      trustedAuthorIdentity: ctx.trustedAuthorIdentity,
      inFlightTaskIds: new Set()
    }
    this.#runInParentLane =
      ctx.runInParentLane ??
      ((automationId, op) => runKeyedSerializedOperation(this.#parentLanes, automationId, op))
  }

  get probe(): CoordinatedOrchestrationRecordProbe {
    return this.#ctx.probe
  }

  async runInParentLane<T>(automationId: string, operation: () => Promise<T>): Promise<T> {
    return this.#runInParentLane(automationId, operation)
  }

  async materializeRun(automationRunId: string): Promise<AutomationRun> {
    return materializeCoordinatedRun(
      this.#ctx.store,
      this.#ctx.orchestrationDb,
      this.#ctx.probe,
      automationRunId
    )
  }

  async dispatchTask(
    automationRunId: string,
    taskId: string,
    retryOfDispatchId?: string
  ): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
    this.#ctx.inFlightTaskIds.add(taskId)
    try {
      return await executeCoordinatedTaskDispatch(this.#ctx, {
        automationRunId,
        taskId,
        retryOfDispatchId
      })
    } finally {
      this.#ctx.inFlightTaskIds.delete(taskId)
    }
  }

  async retryTask(input: { automationRunId: string; taskId: string; retryOfDispatchId: string }) {
    return this.dispatchTask(input.automationRunId, input.taskId, input.retryOfDispatchId)
  }

  /** Low-level native dispatch of ready Tasks; stage acceptance is applied by `reconcileRun`. */
  async dispatchReadyTasks(
    automationRunId: string
  ): Promise<{ taskId: string; dispatchId: string; outcome: string }[]> {
    const run = this.#getRunOrThrow(automationRunId)
    if (run.status === 'completed' || run.completionReceipt) {
      return []
    }
    const snapshot = run.resolvedSnapshot
    if (!snapshot || !run.orchestrationRunId) {
      throw new Error(`Run "${automationRunId}" is not ready for dispatch.`)
    }
    const tasks = this.#ctx.orchestrationDb.listTasks({ runId: run.orchestrationRunId })
    const readyTasks = tasks.filter((t) => t.status === 'ready')
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
        (t) => t.status === 'dispatched' || this.#ctx.inFlightTaskIds.has(t.id)
      ),
      taskToChild,
      maxConcurrency: snapshot.globalCeilings?.maxConcurrency ?? Infinity
    })
    return Promise.all(candidateTasks.map((task) => this.dispatchTask(automationRunId, task.id)))
  }

  /** Materializes if needed, then reconciles persisted evidence until the run cannot advance. */
  async reconcileRun(automationRunId: string): Promise<CoordinatedRunOutcome> {
    const run = this.#getRunOrThrow(automationRunId)
    return this.runInParentLane(run.automationId, async () => {
      await this.materializeRun(automationRunId)
      return reconcileCoordinatedRun(this.#ctx, automationRunId)
    })
  }

  async runUntilSettled(automationRunId: string): Promise<AutomationRun> {
    return (await this.reconcileRun(automationRunId)).run
  }

  /** Admits a worker report through the native worker-report path; duplicates are idempotent. */
  submitWorkerReport(input: {
    automationRunId: string
    taskId: string
    dispatchId: string
    report: unknown
  }): CoordinatedReportSubmission {
    return submitCoordinatedWorkerReport(this.#ctx, input)
  }

  inspectProgress(automationRunId: string): CoordinatedRunProgress | null {
    return this.#ctx.progressStore.read(automationRunId)
  }

  async dispatch(request: {
    automation: Automation
    run: AutomationRun
  }): Promise<HeadlessAutomationDispatchLaunch> {
    return {
      sessionKind: 'terminal',
      workspaceId: request.automation.workspaceId ?? '',
      terminalSessionId: null,
      completion: this.reconcileRun(request.run.id).then(
        (outcome) => ({
          status: outcome.state === 'completed' ? 'completed' : 'dispatch_failed',
          error:
            outcome.state === 'completed'
              ? null
              : (outcome.run.error ?? `Coordinated run is ${outcome.state}: ${outcome.reason}`)
        }),
        (error) => ({
          status: 'dispatch_failed',
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  #getRunOrThrow(automationRunId: string): AutomationRun {
    const run = this.#ctx.store.listAutomationRuns().find((r) => r.id === automationRunId)
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
