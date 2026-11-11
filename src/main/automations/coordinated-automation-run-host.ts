import { join } from 'node:path'
import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import type { Store } from '../persistence/loading-store/store'
import { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import {
  createFileCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import {
  manualRequestShapeRefusal,
  manualStartRefusal,
  runScopeRefusal
} from './coordinated-automation-run-host-gate'
import { inspectCoordinatedRun } from './coordinated-automation-run-inspection'
import {
  CoordinatedRunHostRefusedError,
  type CoordinatedAutomationRunHost,
  type CoordinatedManualRunRequest,
  type CoordinatedManualRunResult,
  type CoordinatedRunHostAvailability,
  type CoordinatedRunScopeRequest,
  type CoordinatedRunHostInjection,
  type CoordinatedRunInspection,
  type CoordinatedRunReconcileResult,
  type CoordinatedOperatorActionResult,
  type CoordinatedRunStopRequest,
  type CoordinatedRunRetryRequest,
  type CoordinatedRunGateRequest
} from './coordinated-automation-run-host-types'

export const COORDINATED_PROGRESS_DIRECTORY = 'coordinated-automation-progress'

/** Lane the host shares with ordinary automation dispatch for the same parent. */
export type CoordinatedRunHostLane = <T>(
  automationId: string,
  operation: () => Promise<T>
) => Promise<T>

type Phase = 'idle' | 'recovering' | 'ready' | 'stopped'

/**
 * Notifies only after the durable write returned; a throwing listener is logged and never
 * undoes, retries, or replays the committed transition.
 */
function publishingProgressStore(
  store: CoordinatedRunProgressStore,
  committed: () => void
): CoordinatedRunProgressStore {
  return {
    read: (automationRunId) => store.read(automationRunId),
    write: (next, expectedSequence) => {
      store.write(next, expectedSequence)
      try {
        committed()
      } catch (error) {
        console.warn('[automations] coordinated progress listener failed:', error)
      }
    }
  }
}

/**
 * Host-owned manual fake runs for disabled coordinated definitions. Retained runs are
 * reconciled at startup before any manual admission; stop fences every further write; the
 * profile/authority gate is re-evaluated live on every call.
 */
export class LocalCoordinatedAutomationRunHost implements CoordinatedAutomationRunHost {
  readonly #store: Store
  readonly #injection: CoordinatedRunHostInjection
  readonly #gate: () => string | null
  readonly #lane: CoordinatedRunHostLane
  readonly #adapter: CoordinatedAutomationAdapter
  readonly #progressStore: CoordinatedRunProgressStore
  #phase: Phase = 'idle'
  #recovery: Promise<void> = Promise.resolve()

  constructor(input: {
    store: Store
    injection: CoordinatedRunHostInjection
    lane: CoordinatedRunHostLane
    /** Live authority/profile gate; a non-null reason revokes the host until it clears. */
    gate: () => string | null
    /** Fires after each successful durable progress write while the host is not stopped. */
    onProgressCommitted?: () => void
  }) {
    this.#store = input.store
    this.#injection = input.injection
    this.#gate = input.gate
    this.#lane = input.lane
    this.#progressStore = publishingProgressStore(
      createFileCoordinatedRunProgressStore(
        join(input.injection.profile.root, COORDINATED_PROGRESS_DIRECTORY)
      ),
      () => {
        if (this.#phase !== 'stopped') {
          input.onProgressCommitted?.()
        }
      }
    )
    const effects = input.injection.effects
    this.#adapter = new CoordinatedAutomationAdapter({
      store: input.store,
      orchestrationDb: input.injection.orchestrationDb,
      workerProvider: input.injection.workerProvider,
      runInParentLane: input.lane,
      progressStore: this.#progressStore,
      clock: input.injection.clock,
      laneLocks: input.injection.laneLocks,
      durableBoundary: input.injection.durableBoundary,
      ...(effects.policy === 'fake' ? { effectAdapter: effects.adapter } : {}),
      isActive: () => this.#phase !== 'stopped' && this.#gate() === null
    })
  }

  get availability(): CoordinatedRunHostAvailability {
    if (this.#phase === 'stopped') {
      return { available: false, state: 'stopped', reason: 'The automation service stopped.' }
    }
    const revoked = this.#gate()
    if (revoked) {
      return { available: false, state: 'revoked', reason: revoked }
    }
    if (this.#phase === 'idle') {
      return {
        available: false,
        state: 'not_started',
        reason: 'The automation service has not started.'
      }
    }
    if (this.#phase === 'recovering') {
      return {
        available: false,
        state: 'recovering',
        reason: 'Retained coordinated runs are still being recovered.'
      }
    }
    return { available: true, state: 'running' }
  }

  /** Called before the service starts its watcher, so the recovery hook lands in this phase. */
  beginStartup(): void {
    if (this.#phase === 'idle') {
      this.#phase = 'recovering'
    }
  }

  /** The watcher's `recoverCoordinatedRuns` hook: reconcile retained runs from durable evidence. */
  recoverRetainedRuns(runs: readonly AutomationRun[]): void {
    if (this.#gateRefusal() !== null) {
      return
    }
    // Eligibility follows each run's frozen authority, not later edits to the definition.
    const eligible = runs.filter(
      (run) =>
        !isFinalAutomationRunStatus(run.status) &&
        run.coordinatedQuarantine === undefined &&
        runScopeRefusal(this.#store, {
          automationId: run.automationId,
          automationRunId: run.id
        }) === null
    )
    this.#recovery = this.#recovery.then(async () => {
      for (const run of eligible) {
        if (this.#gateRefusal() !== null) {
          return
        }
        const scope = { automationId: run.automationId, automationRunId: run.id }
        await this.#adapter
          .reconcileRun(run.id, { precondition: () => this.#refuseIf(this.#runRefusal(scope)) })
          .catch((error: unknown) => {
            console.error(`[automations] coordinated run ${run.id} recovery failed:`, error)
          })
      }
    })
  }

  finishStartup(): void {
    if (this.#phase === 'recovering') {
      void this.#recovery.then(() => {
        if (this.#phase === 'recovering') {
          this.#phase = 'ready'
        }
      })
    }
  }

  /** Fences every write and frees deadline timers; external workers are not assumed stopped. */
  stop(): void {
    this.#phase = 'stopped'
    this.#adapter.abandonPendingWaits()
  }

  async startManualRun(request: CoordinatedManualRunRequest): Promise<CoordinatedManualRunResult> {
    this.#refuseIf(manualRequestShapeRefusal(request))
    await this.#admit()
    const { automationId } = request
    // One lane entry covers the rechecks, Store creation, materialization, and reconciliation.
    return this.#lane(automationId, async () => {
      this.#refuseIf(this.#gateRefusal() ?? manualStartRefusal(this.#store, request))
      const prior = this.#store
        .listAutomationRuns(automationId)
        .find((run) => run.idempotencyKey === request.idempotencyKey)
      const creation = this.#store.createCoordinatedAutomationRun({
        automationId,
        scheduledFor: prior?.scheduledFor ?? this.#injection.clock.now(),
        trigger: 'manual',
        idempotencyKey: request.idempotencyKey,
        expectedDefinitionRevision: request.expectedDefinitionRevision,
        expectedOwner: request.expectedOwner
      })
      // A replay writes nothing; it must still name the occurrence's original frozen revision.
      if (
        !creation.created &&
        creation.occurrence.definitionRevision !== request.expectedDefinitionRevision
      ) {
        this.#refuseIf(
          `Idempotency key "${request.idempotencyKey}" was recorded for revision ${creation.occurrence.definitionRevision}.`
        )
      }
      const automationRunId = creation.occurrence.automationRunId
      const scope = { automationId, automationRunId, expectedOwner: request.expectedOwner }
      const outcome = await this.#adapter.reconcileRunInLane(automationRunId, {
        precondition: () => this.#refuseIf(this.#runRefusal(scope))
      })
      return {
        automationRunId,
        state: outcome.state,
        reason: outcome.reason,
        inspection: this.#read(scope),
        created: creation.created
      }
    })
  }

  async reconcileRun(request: CoordinatedRunScopeRequest): Promise<CoordinatedRunReconcileResult> {
    this.#refuseIf(this.#runRefusal(request))
    await this.#admit()
    const outcome = await this.#adapter.reconcileRun(request.automationRunId, {
      precondition: () => this.#refuseIf(this.#runRefusal(request))
    })
    return {
      automationRunId: request.automationRunId,
      state: outcome.state,
      reason: outcome.reason,
      inspection: this.#read(request)
    }
  }

  async stopRun(request: CoordinatedRunStopRequest): Promise<CoordinatedOperatorActionResult> {
    this.#refuseIf(this.#runRefusal(request))
    await this.#admit()
    const outcome = await this.#adapter.stopRun(request)
    return this.#operatorResult(request, outcome)
  }

  async retryStage(request: CoordinatedRunRetryRequest): Promise<CoordinatedOperatorActionResult> {
    this.#refuseIf(this.#runRefusal(request))
    await this.#admit()
    const outcome = await this.#adapter.retryStage(request)
    return this.#operatorResult(request, outcome)
  }

  async resolveGate(request: CoordinatedRunGateRequest): Promise<CoordinatedOperatorActionResult> {
    this.#refuseIf(this.#runRefusal(request))
    await this.#admit()
    const outcome = await this.#adapter.resolveGate(request)
    return this.#operatorResult(request, outcome)
  }

  #operatorResult(
    request: CoordinatedRunScopeRequest,
    outcome: {
      state: CoordinatedRunReconcileResult['state']
      reason: string | null
      disposition: CoordinatedOperatorActionResult['disposition']
    }
  ): CoordinatedOperatorActionResult {
    return {
      automationRunId: request.automationRunId,
      state: outcome.state,
      reason: outcome.reason,
      disposition: outcome.disposition,
      inspection: this.#read(request)
    }
  }

  /** Read-only: never claims a generation, repairs, or writes. */
  inspectRun(request: CoordinatedRunScopeRequest): CoordinatedRunInspection {
    const availability = this.availability
    this.#refuseIf(availability.available ? null : availability.reason)
    return this.#read(request)
  }

  #read(request: CoordinatedRunScopeRequest): CoordinatedRunInspection {
    this.#refuseIf(this.#runRefusal(request))
    const run = this.#store.listAutomationRuns().find((r) => r.id === request.automationRunId)
    if (!run) {
      throw new CoordinatedRunHostRefusedError(
        `Coordinated run "${request.automationRunId}" was not found.`
      )
    }
    return inspectCoordinatedRun({
      run,
      orchestrationDb: this.#injection.orchestrationDb,
      progressStore: this.#progressStore
    })
  }

  #runRefusal(scope: Parameters<typeof runScopeRefusal>[1]): string | null {
    return this.#gateRefusal() ?? runScopeRefusal(this.#store, scope)
  }

  async #admit(): Promise<void> {
    this.#refuseIf(
      this.#phase === 'idle' ? 'The automation service has not started.' : this.#gateRefusal()
    )
    await this.#recovery
    this.#refuseIf(this.#gateRefusal())
  }

  #refuseIf(reason: string | null): void {
    if (reason) {
      throw new CoordinatedRunHostRefusedError(reason)
    }
  }

  #gateRefusal(): string | null {
    return this.#phase === 'stopped' ? 'The automation service stopped.' : this.#gate()
  }
}
