import type { AutomationOwnerPrecondition } from '../../shared/automation-owner-precondition'
import type {
  CoordinatedManualRunResult,
  CoordinatedRunInspection,
  CoordinatedRunReconcileResult
} from '../../shared/coordinated-automation-run-inspection'
export type {
  Availability,
  CoordinatedRunSemanticState,
  CoordinatedStageInspection,
  CoordinatedRunInspection,
  CoordinatedRunReconcileResult,
  CoordinatedManualRunResult
} from '../../shared/coordinated-automation-run-inspection'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { CoordinatedBoundaryHook } from './coordinated-automation-progress-ledger'
import type {
  CoordinatedClock,
  CoordinatedFakeEffectAdapter,
  CoordinatedLaneLockProvider,
  CoordinatedWorkerProvider
} from './coordinated-automation-recovery-context'

export const COORDINATED_FAKE_RUNS_CAPABILITY = 'coordinated_fake_runs_v1'

/**
 * Explicit, typed host opt-in. Absent by default: the coordinated run host then reports itself
 * unavailable and refuses every call before any write.
 */
export type CoordinatedRunHostInjection = {
  capability: typeof COORDINATED_FAKE_RUNS_CAPABILITY
  /** Must equal the selected active profile storage directory; the host refuses a foreign profile. */
  profile: { kind: 'isolated_test' | 'developer'; root: string }
  orchestrationDb: OrchestrationDb
  /** Must declare only the `fake_no_effects` capability; real providers are refused. */
  workerProvider: CoordinatedWorkerProvider
  clock: Required<CoordinatedClock>
  laneLocks: CoordinatedLaneLockProvider
  effects: { policy: 'deny' } | { policy: 'fake'; adapter: CoordinatedFakeEffectAdapter }
  /** Test-only crash/trace hook at coordinator durable-write boundaries. */
  durableBoundary?: CoordinatedBoundaryHook
}

/** Facts the host reads from its own environment, never from the caller. */
export type CoordinatedRunHostEnvironment = {
  isPackaged: () => boolean
  activeProfileDirectory: () => string | null
}

export type CoordinatedManualRunRequest = {
  automationId: string
  expectedOwner: AutomationOwnerPrecondition
  expectedDefinitionRevision: number
  /** 1-128 chars; a repeated key replays the original run instead of creating another. */
  idempotencyKey: string
}

// ---- Host request / precondition / lifecycle types (host-owned; DTOs above are API-owned) ----

/** Exact scope every reconcile/inspect call must name; all three are revalidated in the host. */
export type CoordinatedRunScopeRequest = {
  automationId: string
  automationRunId: string
  expectedOwner: AutomationOwnerPrecondition
}

export type CoordinatedRunHostState =
  | 'unconfigured'
  | 'refused'
  | 'not_started'
  | 'recovering'
  | 'running'
  | 'stopped'
  | 'revoked'

/** Live host gate; recomputed on every read. Only `running` admits inspection. */
export type CoordinatedRunHostAvailability =
  | { available: true; state: 'running' }
  | { available: false; state: Exclude<CoordinatedRunHostState, 'running'>; reason: string }

/**
 * Internal service surface the runtime/API owner binds; not an RPC contract. `startManualRun`
 * waits for startup recovery, then revalidates the gate and every precondition inside the
 * per-parent lane immediately before its first write.
 */
export type CoordinatedAutomationRunHost = {
  readonly availability: CoordinatedRunHostAvailability
  startManualRun: (request: CoordinatedManualRunRequest) => Promise<CoordinatedManualRunResult>
  reconcileRun: (request: CoordinatedRunScopeRequest) => Promise<CoordinatedRunReconcileResult>
  inspectRun: (request: CoordinatedRunScopeRequest) => CoordinatedRunInspection
}

export class CoordinatedRunHostRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedRunHostRefusedError'
  }
}

export function createUnavailableCoordinatedRunHost(
  reason: string,
  state: 'unconfigured' | 'refused' = 'unconfigured'
): CoordinatedAutomationRunHost {
  const refuse = (): never => {
    throw new CoordinatedRunHostRefusedError(reason)
  }
  return {
    availability: { available: false, state, reason },
    startManualRun: async () => refuse(),
    reconcileRun: async () => refuse(),
    inspectRun: () => refuse()
  }
}
