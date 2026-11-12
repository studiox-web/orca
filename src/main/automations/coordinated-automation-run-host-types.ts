import type { CoordinatedNativeStartDescriptor } from '../../shared/coordinated-automation-run-view'
import type { CoordinatedNativeProviderWorker } from './coordinated-automation-native-provider-worker'
import type { ResolvePromptFunction } from '../../shared/coordinated-automation-snapshot'
import type { COORDINATED_NATIVE_PROVIDER_CAPABILITY } from './coordinated-automation-native-provider-plan'
import type { AutomationOwnerPrecondition } from '../../shared/automation-owner-precondition'
import type { CoordinatedStageGateCandidate } from '../../shared/coordinated-automation-gate-candidate'
import type {
  CoordinatedGateScope,
  CoordinatedManualRunResult,
  CoordinatedOperatorActionResult,
  CoordinatedRunInspection,
  CoordinatedRunReconcileResult
} from '../../shared/coordinated-automation-run-inspection'
export type {
  Availability,
  CoordinatedOperatorActionResult,
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
type CoordinatedRunHostBase = {
  /** Must equal the selected active profile storage directory; the host refuses a foreign profile. */
  profile: { kind: 'isolated_test' | 'developer'; root: string }
  orchestrationDb: OrchestrationDb
  clock: Required<CoordinatedClock>
  laneLocks: CoordinatedLaneLockProvider
  promptResolver?: ResolvePromptFunction
  workspacePath?: string
  /** Test-only crash/trace hook at coordinator durable-write boundaries. */
  durableBoundary?: CoordinatedBoundaryHook
}

export type CoordinatedFakeRunHostInjection = CoordinatedRunHostBase & {
  capability: typeof COORDINATED_FAKE_RUNS_CAPABILITY
  workerProvider: CoordinatedWorkerProvider
  nativeProviderWorker?: never
  effects: { policy: 'deny' } | { policy: 'fake'; adapter: CoordinatedFakeEffectAdapter }
}

export type CoordinatedNativeRunHostInjection = CoordinatedRunHostBase & {
  capability: typeof COORDINATED_NATIVE_PROVIDER_CAPABILITY
  nativeProviderWorker: CoordinatedNativeProviderWorker
  estimateCostUsd: NonNullable<CoordinatedWorkerProvider['estimateCostUsd']>
  workerProvider?: never
  effects: { policy: 'deny' }
}

export type CoordinatedRunHostInjection =
  | CoordinatedFakeRunHostInjection
  | CoordinatedNativeRunHostInjection

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
  readonly executionKind?: 'fake' | 'native'
  readonly nativeStart?: CoordinatedNativeStartDescriptor
  readonly availability: CoordinatedRunHostAvailability
  startManualRun: (request: CoordinatedManualRunRequest) => Promise<CoordinatedManualRunResult>
  reconcileRun: (request: CoordinatedRunScopeRequest) => Promise<CoordinatedRunReconcileResult>
  inspectRun: (request: CoordinatedRunScopeRequest) => CoordinatedRunInspection
  stopRun: (request: CoordinatedRunStopRequest) => Promise<CoordinatedOperatorActionResult>
  retryStage: (request: CoordinatedRunRetryRequest) => Promise<CoordinatedOperatorActionResult>
  resolveGate: (request: CoordinatedRunGateRequest) => Promise<CoordinatedOperatorActionResult>
}

/** Operator actions bind to the run's frozen orchestration Run, revision, and authority. */
export type CoordinatedRunOperatorScope = CoordinatedRunScopeRequest & {
  orchestrationRunId: string | null
  definitionRevision: number
  targetExecutionAuthority: string
}

export type CoordinatedRunStopRequest = CoordinatedRunOperatorScope & { note?: string }

export type CoordinatedRunRetryRequest = CoordinatedRunOperatorScope & {
  childDefinitionId: string
  taskId: string
  retryOfDispatchId: string
}

export type CoordinatedRunGateRequest = CoordinatedRunOperatorScope & {
  stageCandidate?: CoordinatedStageGateCandidate
  gateId: string
  gateScope?: CoordinatedGateScope
  expectedReportDigest?: string
  decision: 'approve' | 'reject' | 'escalate'
  note?: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
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
    inspectRun: () => refuse(),
    stopRun: async () => refuse(),
    retryStage: async () => refuse(),
    resolveGate: async () => refuse()
  }
}
