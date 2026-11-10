import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { Store } from '../persistence/loading-store/store'
import { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import {
  createFileCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import { FAKE_EFFECT_ADAPTER_KIND } from './coordinated-automation-recovery-context'
import { inspectCoordinatedRun } from './coordinated-automation-run-inspection'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  CoordinatedRunHostRefusedError,
  createUnavailableCoordinatedRunHost,
  type CoordinatedAutomationRunHost,
  type CoordinatedManualRunRequest,
  type CoordinatedManualRunResult,
  type CoordinatedRunHostEnvironment,
  type CoordinatedRunHostInjection,
  type CoordinatedRunInspection,
  type CoordinatedRunReconcileResult
} from './coordinated-automation-run-host-types'

export { createUnavailableCoordinatedRunHost }

export const COORDINATED_PROGRESS_DIRECTORY = 'coordinated-automation-progress'

/** Lane the host shares with ordinary automation dispatch for the same parent. */
export type CoordinatedRunHostLane = <T>(
  automationId: string,
  operation: () => Promise<T>
) => Promise<T>

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(resolve(path))
  } catch {
    return null
  }
}

/** Every refusal is decided from host-owned facts before any Store, DB, or file write. */
export function coordinatedRunHostRefusal(input: {
  injection: CoordinatedRunHostInjection | undefined
  headless: boolean
  environment: CoordinatedRunHostEnvironment | null
}): string | null {
  const { injection, environment } = input
  if (!injection) {
    return 'Coordinated fake runs are not configured for this host.'
  }
  if (input.headless) {
    return 'Coordinated fake runs are refused on headless and remote hosts.'
  }
  if (injection.capability !== COORDINATED_FAKE_RUNS_CAPABILITY) {
    return `Unknown coordinated run capability "${String(injection.capability)}".`
  }
  if (!environment) {
    return 'The host environment is unavailable, so local desktop authority cannot be confirmed.'
  }
  if (environment.isPackaged()) {
    return 'Coordinated fake runs are refused in packaged builds.'
  }
  if (injection.profile.kind !== 'isolated_test' && injection.profile.kind !== 'developer') {
    return 'Coordinated fake runs need an isolated test or developer profile.'
  }
  const root = canonicalPath(injection.profile.root)
  if (!root || root !== canonicalPath(environment.userDataPath())) {
    return 'The injected profile root is not this host’s active profile.'
  }
  const provider = injection.workerProvider
  const capabilities = [
    ...(provider.capability ? [provider.capability] : []),
    ...(provider.capabilities ?? [])
  ]
  if (capabilities.length === 0 || capabilities.some((c) => c !== 'fake_no_effects')) {
    return 'Only the fake_no_effects worker provider is accepted.'
  }
  if (typeof injection.clock.setTimer !== 'function') {
    return 'The coordinator clock must provide setTimer for persisted stage deadlines.'
  }
  if (
    injection.effects.policy !== 'deny' &&
    injection.effects.adapter.kind !== FAKE_EFFECT_ADAPTER_KIND
  ) {
    return 'Only the deny policy or the fake effect adapter is accepted.'
  }
  return null
}

type Phase = 'idle' | 'recovering' | 'ready' | 'stopped'

/**
 * Host-owned manual fake runs for disabled coordinated definitions. Retained runs are
 * reconciled at startup before any manual admission; stop fences every further write.
 */
export class LocalCoordinatedAutomationRunHost implements CoordinatedAutomationRunHost {
  readonly availability = { available: true } as const
  readonly #store: Store
  readonly #injection: CoordinatedRunHostInjection
  readonly #adapter: CoordinatedAutomationAdapter
  readonly #progressStore: CoordinatedRunProgressStore
  #phase: Phase = 'idle'
  #recovery: Promise<void> = Promise.resolve()

  constructor(input: {
    store: Store
    injection: CoordinatedRunHostInjection
    lane: CoordinatedRunHostLane
  }) {
    this.#store = input.store
    this.#injection = input.injection
    this.#progressStore = createFileCoordinatedRunProgressStore(
      join(input.injection.profile.root, COORDINATED_PROGRESS_DIRECTORY)
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
      isActive: () => this.#phase !== 'stopped'
    })
  }

  /** Called before the service starts its watcher, so the recovery hook lands in this phase. */
  beginStartup(): void {
    if (this.#phase === 'idle') {
      this.#phase = 'recovering'
    }
  }

  /** The watcher's `recoverCoordinatedRuns` hook: reconcile retained runs from durable evidence. */
  recoverRetainedRuns(runs: readonly AutomationRun[]): void {
    if (this.#phase === 'stopped') {
      return
    }
    const eligible = runs.filter(
      (run) =>
        !isFinalAutomationRunStatus(run.status) &&
        run.coordinatedQuarantine === undefined &&
        this.#refuseAutomation(run.automationId) === null
    )
    this.#recovery = this.#recovery.then(async () => {
      for (const run of eligible) {
        if (this.#phase === 'stopped') {
          return
        }
        await this.#adapter.reconcileRun(run.id).catch((error: unknown) => {
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

  stop(): void {
    this.#phase = 'stopped'
  }

  async startManualRun(request: CoordinatedManualRunRequest): Promise<CoordinatedManualRunResult> {
    await this.#admit()
    if (request.expectedOwner?.selector?.kind !== 'self') {
      throw new CoordinatedRunHostRefusedError(
        'Manual coordinated runs need exact local desktop owner authority.'
      )
    }
    if (!Number.isInteger(request.expectedDefinitionRevision)) {
      throw new CoordinatedRunHostRefusedError('An exact expected definition revision is required.')
    }
    if (
      typeof request.idempotencyKey !== 'string' ||
      request.idempotencyKey.length === 0 ||
      request.idempotencyKey.length > 128
    ) {
      throw new CoordinatedRunHostRefusedError(
        'An idempotency key of 1-128 characters is required.'
      )
    }
    const refusal = this.#refuseAutomation(request.automationId)
    if (refusal) {
      throw new CoordinatedRunHostRefusedError(refusal)
    }
    // A replay keeps the original occurrence time so the same key maps to the same occurrence.
    const prior = this.#store
      .listAutomationRuns(request.automationId)
      .find((run) => run.idempotencyKey === request.idempotencyKey)
    const creation = this.#store.createCoordinatedAutomationRun({
      automationId: request.automationId,
      scheduledFor: prior?.scheduledFor ?? this.#injection.clock.now(),
      trigger: 'manual',
      idempotencyKey: request.idempotencyKey,
      expectedDefinitionRevision: request.expectedDefinitionRevision,
      expectedOwner: request.expectedOwner
    })
    const automationRunId = creation.run?.id ?? creation.occurrence.automationRunId
    return { ...(await this.reconcileRun(automationRunId)), created: creation.created }
  }

  async reconcileRun(automationRunId: string): Promise<CoordinatedRunReconcileResult> {
    await this.#admit()
    const run = this.#requireRun(automationRunId)
    const refusal = this.#refuseAutomation(run.automationId)
    if (refusal) {
      throw new CoordinatedRunHostRefusedError(refusal)
    }
    const outcome = await this.#adapter.reconcileRun(automationRunId)
    return {
      automationRunId,
      state: outcome.state,
      reason: outcome.reason,
      inspection: this.inspectRun(automationRunId)
    }
  }

  inspectRun(automationRunId: string): CoordinatedRunInspection {
    return inspectCoordinatedRun({
      run: this.#requireRun(automationRunId),
      orchestrationDb: this.#injection.orchestrationDb,
      progressStore: this.#progressStore
    })
  }

  async #admit(): Promise<void> {
    if (this.#phase === 'idle') {
      throw new CoordinatedRunHostRefusedError('The automation service has not started.')
    }
    await this.#recovery
    if (this.#phase === 'stopped') {
      throw new CoordinatedRunHostRefusedError('The automation service stopped.')
    }
  }

  #requireRun(automationRunId: string): AutomationRun {
    const run = this.#store.listAutomationRuns().find((entry) => entry.id === automationRunId)
    if (!run || run.materializationPhase === undefined) {
      throw new CoordinatedRunHostRefusedError(
        `Coordinated run "${automationRunId}" was not found.`
      )
    }
    return run
  }

  #refuseAutomation(automationId: string): string | null {
    const automation = this.#store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation || !isCoordinatedAutomation(automation)) {
      return `Coordinated automation "${automationId}" was not found.`
    }
    if (automation.enabled) {
      return 'Manual fake runs are limited to disabled coordinated definitions.'
    }
    if (automation.executionTargetType !== 'local') {
      return 'Manual fake runs are limited to local desktop execution targets.'
    }
    return null
  }
}

type StartStopService = {
  coordinatedRuns: CoordinatedAutomationRunHost
  start: () => void
  stop: () => void
  runInAutomationLane: CoordinatedRunHostLane
}

/**
 * Wires the opt-in host into an AutomationService: the watcher's recovery hook reconciles retained
 * runs during start(), manual work waits for that recovery, and stop() fences before teardown.
 * Without a valid injection the service keeps the unavailable host and the hook stays a no-op.
 */
export function createCoordinatedRunHostBinding(input: {
  store: Store
  injection: CoordinatedRunHostInjection | undefined
  headless: boolean
  environment: CoordinatedRunHostEnvironment | null
}): {
  recoverCoordinatedRuns: (runs: readonly AutomationRun[]) => void
  attach: (service: StartStopService) => void
} {
  const refusal = coordinatedRunHostRefusal(input)
  let host: LocalCoordinatedAutomationRunHost | null = null
  return {
    recoverCoordinatedRuns: (runs) => host?.recoverRetainedRuns(runs),
    attach: (service) => {
      if (refusal || !input.injection) {
        service.coordinatedRuns = createUnavailableCoordinatedRunHost(
          refusal ?? 'Coordinated fake runs are not configured for this host.'
        )
        return
      }
      const local = new LocalCoordinatedAutomationRunHost({
        store: input.store,
        injection: input.injection,
        lane: (automationId, operation) => service.runInAutomationLane(automationId, operation)
      })
      host = local
      service.coordinatedRuns = local
      const start = service.start.bind(service)
      const stop = service.stop.bind(service)
      service.start = () => {
        local.beginStartup()
        start()
        local.finishStartup()
      }
      service.stop = () => {
        local.stop()
        stop()
      }
    }
  }
}
