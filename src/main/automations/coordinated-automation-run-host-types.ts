import type { AutomationRunStatus } from '../../shared/automations-types'
import type { AutomationOwnerPrecondition } from '../../shared/automation-owner-precondition'
import type {
  CoordinatedAttemptRecord,
  CoordinatedEffectEntry,
  CoordinatedEscalation,
  CoordinatedRunHalt,
  CoordinatedStageStatus
} from '../../shared/coordinated-automation-progress-types'
import type { SemanticCompletionReceipt } from '../../shared/coordinated-automation-receipt-types'
import type { CoordinatedCompletionTrust } from '../../shared/coordinated-automation-types'
import type { CoordinatedRunMaterializationPhase } from '../../shared/coordinated-automation-saga-types'
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
  /** Must equal the active profile's userData root; the host refuses a foreign profile. */
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
  userDataPath: () => string
}

export type CoordinatedManualRunRequest = {
  automationId: string
  expectedOwner: AutomationOwnerPrecondition
  expectedDefinitionRevision: number
  /** 1-128 chars; a repeated key replays the original run instead of creating another. */
  idempotencyKey: string
}

export type CoordinatedRunSemanticState =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'outcome_uncertain'
  | 'waiting'

export type Availability<T> =
  | ({ kind: 'available' } & T)
  | { kind: 'absent'; reason: string }
  | { kind: 'unavailable'; reason: string }

export type CoordinatedStageInspection = {
  childDefinitionId: string
  name: string
  role: string
  enabled: boolean
  taskId: string | null
  /** Dispatch the Store mapping records for this child; null before the first Dispatch. */
  mappedDispatchId: string | null
  native: Availability<{
    taskStatus: string
    latestDispatchId: string | null
    latestDispatchStatus: string | null
  }>
  semantic: Availability<{
    status: CoordinatedStageStatus
    attempts: number
    acceptedDispatchId: string | null
    lastError: string | null
    lineage: CoordinatedAttemptRecord[]
  }>
  /** Fake workers have no chat/terminal session; never fabricated. */
  sessionTarget: { kind: 'unavailable'; reason: string }
}

export type CoordinatedRunInspection = {
  automationId: string
  automationRunId: string
  runStatus: AutomationRunStatus
  runError: string | null
  definitionRevision: number
  canonicalDigest: string | null
  idempotencyKey: string | null
  materializationPhase: CoordinatedRunMaterializationPhase | null
  orchestrationRunId: string | null
  stages: CoordinatedStageInspection[]
  progress: Availability<{
    generation: number
    sequence: number
    halt: CoordinatedRunHalt | null
    escalations: CoordinatedEscalation[]
    effects: CoordinatedEffectEntry[]
    reportCount: number
  }>
  receipt: Availability<{
    receipt: SemanticCompletionReceipt
    trust: CoordinatedCompletionTrust | null
  }>
  /** No reviewed host API resolves uncertain effects, conflicts, or limits yet. */
  humanResolution: { available: false; reason: string }
}

export type CoordinatedRunReconcileResult = {
  automationRunId: string
  state: CoordinatedRunSemanticState
  reason: string | null
  inspection: CoordinatedRunInspection
}

export type CoordinatedManualRunResult = CoordinatedRunReconcileResult & {
  /** False when the idempotency key replayed an existing run. */
  created: boolean
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
