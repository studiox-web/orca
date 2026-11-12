import {
  NATIVE_PROVIDER_ATTEMPT,
  isCoordinatedNativeAttempt,
  readCoordinatedNativeBinding
} from './coordinated-automation-native-attempt'
import { COORDINATED_NATIVE_PROVIDER_CAPABILITY } from './coordinated-automation-native-provider-plan'
import {
  nativePilotStartDescriptor,
  nativePilotStartRefusal,
  nativePilotRunRefusal
} from './coordinated-automation-native-pilot-scope'
import { createCoordinatedRunHostExecution } from './coordinated-automation-run-host-execution'
export { COORDINATED_PROGRESS_DIRECTORY } from './coordinated-automation-run-host-execution'
import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
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

/** Lane the host shares with ordinary automation dispatch for the same parent. */
export type CoordinatedRunHostLane = <T>(
  automationId: string,
  operation: () => Promise<T>
) => Promise<T>

/**
 * Host-owned manual runs for disabled coordinated definitions. Retained runs are
 * reconciled at startup before any manual admission; stop fences every further write; the
 * profile/authority gate is re-evaluated live on every call.
 */
export class LocalCoordinatedAutomationRunHost implements CoordinatedAutomationRunHost {
  readonly executionKind: 'fake' | 'native'
  readonly #store: Store
  readonly #injection: CoordinatedRunHostInjection
  readonly #gate: () => string | null
  readonly #lane: CoordinatedRunHostLane
  readonly #adapter: CoordinatedAutomationAdapter
  readonly #progressStore: CoordinatedRunProgressStore
  #phase: 'idle' | 'recovering' | 'ready' | 'stopped' = 'idle'
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
    this.executionKind = input.injection.nativeProviderWorker ? 'native' : 'fake'
    this.#store = input.store
    this.#injection = input.injection
    this.#gate = input.gate
    this.#lane = input.lane
    const execution = createCoordinatedRunHostExecution({
      ...input,
      isActive: () => this.#phase !== 'stopped' && this.#gate() === null,
      onProgressCommitted: () => {
        if (this.#phase !== 'stopped') {
          input.onProgressCommitted?.()
        }
      }
    })
    this.#adapter = execution.adapter
    this.#progressStore = execution.progressStore
  }

  get nativeStart() {
    return this.availability.available &&
      this.#injection.capability === COORDINATED_NATIVE_PROVIDER_CAPABILITY
      ? nativePilotStartDescriptor(this.#store, this.#injection)
      : undefined
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
      if (this.#injection.capability === COORDINATED_NATIVE_PROVIDER_CAPABILITY) {
        this.#refuseIf(nativePilotStartRefusal(this.#store, this.#injection, request))
      }
      const prior = this.#store
        .listAutomationRuns(automationId)
        .find((run) => run.idempotencyKey === request.idempotencyKey)
      const creation = this.#store.createCoordinatedAutomationRun({
        automationId,
        scheduledFor: prior?.scheduledFor ?? this.#injection.clock.now(),
        trigger: 'manual',
        idempotencyKey: request.idempotencyKey,
        expectedDefinitionRevision: request.expectedDefinitionRevision,
        expectedOwner: request.expectedOwner,
        promptResolver: this.#injection.promptResolver
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
    const refusal = this.#gateRefusal() ?? runScopeRefusal(this.#store, scope)
    if (refusal) {
      return refusal
    }
    const run = this.#store.listAutomationRuns().find((r) => r.id === scope.automationRunId)!
    for (const mapping of run.childMappings ?? []) {
      const dispatch = this.#injection.orchestrationDb.getDispatchContext(mapping.taskId)
      if (!dispatch) {
        continue
      }
      const native = isCoordinatedNativeAttempt(this.#injection.orchestrationDb, dispatch.id)
      const binding = readCoordinatedNativeBinding(this.#injection.orchestrationDb, dispatch.id)
      if (
        native !== (this.executionKind === 'native') ||
        (native && binding?.kind !== NATIVE_PROVIDER_ATTEMPT)
      ) {
        return 'The retained run attempt execution kind does not match this host.'
      }
    }
    return this.#injection.capability === COORDINATED_NATIVE_PROVIDER_CAPABILITY
      ? nativePilotRunRefusal(this.#store, this.#injection, run)
      : null
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
