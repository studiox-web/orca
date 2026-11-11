import {
  coordinatedNativeStubHostIsActive,
  type CoordinatedNativeStubWorker
} from './coordinated-automation-native-stub-worker'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { CoordinatedOperatorActionDisposition } from '../../shared/coordinated-automation-run-inspection'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import type { HeadlessAutomationDispatchLaunch } from './headless-dispatch'
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
import {
  createDefaultFakeNoEffectsWorkerProvider,
  executeCoordinatedTaskDispatch
} from './coordinated-automation-task-execution'
import {
  operatorResolveGate,
  type CoordinatedOperatorGateInput
} from './coordinated-automation-operator-gate-resolution'
import {
  operatorRetryStage,
  operatorStopRun,
  type CoordinatedOperatorScopeInput
} from './coordinated-automation-operator-actions'
import { requestCoordinatedNativeStops } from './coordinated-automation-native-stub-stop'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import {
  type CoordinatedBoundaryHook,
  CoordinatedProgressLedger
} from './coordinated-automation-progress-ledger'
import {
  defaultCoordinatedProgressStore,
  dispatchReadyCoordinatedTasks
} from './coordinated-automation-dispatcher'
import {
  abandonCoordinatorWaits,
  assertCoordinatorActive,
  type CoordinatedClock,
  type CoordinatedFakeEffectAdapter,
  type CoordinatedLaneLockProvider,
  type CoordinatedRecoveryContext,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider
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

export type CoordinatedOperatorOutcome = CoordinatedRunOutcome & {
  disposition: CoordinatedOperatorActionDisposition
}

export type CoordinatedAutomationAdapterContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  workerProvider?: CoordinatedWorkerProvider
  nativeStubWorker?: CoordinatedNativeStubWorker
  /** Guarded normal-provider planning facts; no run host injection carries them. */
  nativeProviderHost?: CoordinatedRecoveryContext['nativeProviderHost']
  runInParentLane?: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  /** Host-owned approvals; a function is re-read at every evaluation. */
  hostApprovals?: readonly CoordinatedHostApproval[] | (() => readonly CoordinatedHostApproval[])
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  workspacePath?: string
  trustedAuthorIdentity?: string
  /** Durable progress; defaults to the profile's coordinated progress directory. */
  progressStore?: CoordinatedRunProgressStore
  clock?: CoordinatedClock
  durableBoundary?: CoordinatedBoundaryHook
  effectAdapter?: CoordinatedFakeEffectAdapter
  laneLocks?: CoordinatedLaneLockProvider
  /** Host lifetime gate; once false, the adapter refuses new claims, writes, and dispatches. */
  isActive?: () => boolean
}

export class CoordinatedAutomationAdapter {
  readonly #ctx: CoordinatedRecoveryContext
  readonly #runInParentLane: <T>(automationId: string, operation: () => Promise<T>) => Promise<T>
  readonly #parentLanes = new Map<string, Promise<void>>()
  /** The generation this adapter last claimed per run; replaced generations are fenced. */
  readonly #ledgers = new Map<string, CoordinatedProgressLedger>()

  constructor(ctx: CoordinatedAutomationAdapterContext) {
    const approvals = ctx.hostApprovals
    this.#ctx = {
      store: ctx.store,
      orchestrationDb: ctx.orchestrationDb,
      probe: orchestrationRecordProbe(ctx.orchestrationDb),
      workerProvider: ctx.workerProvider ?? createDefaultFakeNoEffectsWorkerProvider(ctx.store),
      nativeStubWorker: ctx.nativeStubWorker,
      nativeProviderHost: ctx.nativeProviderHost,
      progressStore: ctx.progressStore ?? defaultCoordinatedProgressStore(),
      clock: ctx.clock ?? {
        now: () => Date.now(),
        setTimer: (delayMs, callback) => {
          const timer = setTimeout(callback, delayMs)
          return () => clearTimeout(timer)
        }
      },
      boundary: ctx.durableBoundary ?? (() => {}),
      hostApprovals: typeof approvals === 'function' ? approvals : () => approvals ?? [],
      hostEffectReceipts: ctx.hostEffectReceipts,
      effectAdapter: ctx.effectAdapter,
      laneLocks: ctx.laneLocks,
      workspacePath: ctx.workspacePath,
      trustedAuthorIdentity: ctx.trustedAuthorIdentity,
      inFlightTaskIds: new Set(),
      pendingWaits: new Set(),
      // A revoked or re-bound native host fences every claim, ledger write and receipt, not only launches.
      isActive: () =>
        (ctx.isActive?.() ?? true) && coordinatedNativeStubHostIsActive(ctx.nativeStubWorker)
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
    return dispatchReadyCoordinatedTasks(this.#ctx, this.#getRunOrThrow(automationRunId))
  }

  /** Operator stop: durable marker fences dispatch, native cancellation, then one reconcile. */
  async stopRun(
    input: CoordinatedOperatorScopeInput & { automationRunId: string; note?: string }
  ): Promise<CoordinatedOperatorOutcome> {
    return this.#operatorMutation(input.automationRunId, (run) => {
      const disposition = operatorStopRun(this.#ctx, run, input)
      // A replay re-requests nothing: the first request already asked native authority to stop.
      if (disposition === 'recorded' && this.#ctx.nativeStubWorker) {
        requestCoordinatedNativeStops(this.#ctx.nativeStubWorker, run)
      }
      return disposition
    })
  }

  async retryStage(
    input: CoordinatedOperatorScopeInput & {
      automationRunId: string
      childDefinitionId: string
      taskId: string
      retryOfDispatchId: string
    }
  ): Promise<CoordinatedOperatorOutcome> {
    return this.#operatorMutation(input.automationRunId, (run) =>
      operatorRetryStage(this.#ctx, run, input)
    )
  }

  async resolveGate(
    input: CoordinatedOperatorGateInput & { automationRunId: string }
  ): Promise<CoordinatedOperatorOutcome> {
    return this.#operatorMutation(input.automationRunId, (run) =>
      operatorResolveGate(this.#ctx, run, input)
    )
  }

  async #operatorMutation(
    automationRunId: string,
    mutate: (run: AutomationRun) => CoordinatedOperatorActionDisposition
  ): Promise<CoordinatedOperatorOutcome> {
    const run = this.#getRunOrThrow(automationRunId)
    return this.runInParentLane(run.automationId, async () => {
      assertCoordinatorActive(this.#ctx)
      const disposition = mutate(run)
      return { ...(await this.reconcileRunInLane(automationRunId)), disposition }
    })
  }

  /** Materializes, then reconciles until stuck; `precondition` runs in-lane before the first write. */
  async reconcileRun(
    automationRunId: string,
    options: { precondition?: () => void } = {}
  ): Promise<CoordinatedRunOutcome> {
    const run = this.#getRunOrThrow(automationRunId)
    return this.runInParentLane(run.automationId, () =>
      this.reconcileRunInLane(automationRunId, options)
    )
  }

  /** For callers already holding this parent's lane; re-entering it would deadlock. */
  async reconcileRunInLane(
    automationRunId: string,
    options: { precondition?: () => void } = {}
  ): Promise<CoordinatedRunOutcome> {
    assertCoordinatorActive(this.#ctx)
    options.precondition?.()
    await this.materializeRun(automationRunId)
    return reconcileCoordinatedRun(this.#ctx, automationRunId, (ledger) =>
      this.#ledgers.set(automationRunId, ledger)
    )
  }

  /** Cancels deadline timers and abandons in-flight waits; pair with an `isActive` gate that is now false. */
  abandonPendingWaits(): void {
    abandonCoordinatorWaits(this.#ctx)
  }

  runUntilSettled = async (id: string): Promise<AutomationRun> => (await this.reconcileRun(id)).run

  /** Admits a worker report through the native worker-report path; duplicates are idempotent. */
  submitWorkerReport(input: {
    automationRunId: string
    taskId: string
    dispatchId: string
    report: unknown
  }): CoordinatedReportSubmission {
    return submitCoordinatedWorkerReport(this.#ctx, this.#ledgerFor(input.automationRunId), input)
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

  #ledgerFor(automationRunId: string): CoordinatedProgressLedger {
    const cached = this.#ledgers.get(automationRunId)
    if (cached) {
      return cached
    }
    const run = this.#getRunOrThrow(automationRunId)
    if (!run.resolvedSnapshot || !run.orchestrationRunId) {
      throw new Error(`Run "${automationRunId}" is not materialized; reports cannot be admitted.`)
    }
    const ledger = CoordinatedProgressLedger.claim({
      store: this.#ctx.progressStore,
      automationRunId,
      orchestrationRunId: run.orchestrationRunId,
      snapshot: run.resolvedSnapshot,
      now: this.#ctx.clock.now(),
      boundary: this.#ctx.boundary,
      isActive: this.#ctx.isActive
    })
    this.#ledgers.set(automationRunId, ledger)
    return ledger
  }

  #getRunOrThrow(automationRunId: string): AutomationRun {
    const run = this.#ctx.store.listAutomationRuns().find((r) => r.id === automationRunId)
    if (!run) {
      throw new Error(`Automation run "${automationRunId}" not found.`)
    }
    return run
  }
}

export { createCoordinatedAutomationDispatcher } from './coordinated-automation-dispatcher'
