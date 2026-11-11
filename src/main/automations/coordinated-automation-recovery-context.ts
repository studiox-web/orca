import type { CoordinatedNativeStubWorker } from './coordinated-automation-native-stub-worker'
import type { CoordinatedNativeProviderHostFacts } from './coordinated-automation-native-provider-plan'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import type { CoordinatedHostApproval } from './coordinated-automation-approval-validation'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import type {
  CoordinatedBoundaryHook,
  CoordinatedProgressLedger
} from './coordinated-automation-progress-ledger'

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
  run: (identity: CoordinatedWorkerIdentity) => Promise<unknown>
  /** Host-owned spend estimate charged when an attempt is admitted. */
  estimateCostUsd?: (identity: CoordinatedWorkerIdentity) => number
}

/** A provider that could not start the worker at all; counts toward the start circuit. */
export class CoordinatedWorkerStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedWorkerStartError'
  }
}

export type CoordinatedFakeEffectState =
  | 'not_started'
  | 'applied'
  | 'verified'
  | 'uncertain'
  | 'denied'

export type CoordinatedFakeEffectObservation = Readonly<{
  state: CoordinatedFakeEffectState
  receipt?: string
}>

/** Only the deterministic fake adapter is accepted; no live effect path exists in this phase. */
export const FAKE_EFFECT_ADAPTER_KIND = 'fake-effect-state-adapter'

export type CoordinatedFakeEffectAdapter = {
  readonly kind: typeof FAKE_EFFECT_ADAPTER_KIND
  apply: (effectId: string) => Promise<CoordinatedFakeEffectObservation>
  query: (effectId: string) => Promise<CoordinatedFakeEffectObservation>
}

export type CoordinatedLaneLockResult =
  | { acquired: true; release: () => void }
  | { acquired: false; holder: string; expiresAt?: number }

/** Existing domain locks stay authoritative: the coordinator only tries, never steals. */
export type CoordinatedLaneLockProvider = {
  tryAcquire: (lane: string, owner: string) => CoordinatedLaneLockResult
}

export type CoordinatedClock = {
  now: () => number
  /** Fires `callback` after `delayMs` on this clock; returns a cancel function. */
  setTimer?: (delayMs: number, callback: () => void) => () => void
}

export type CoordinatedRecoveryContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  probe: CoordinatedOrchestrationRecordProbe
  workerProvider: CoordinatedWorkerProvider
  nativeStubWorker?: CoordinatedNativeStubWorker
  /** Guarded normal-provider planning facts; absent in every app root. Never launches. */
  nativeProviderHost?: CoordinatedNativeProviderHostFacts
  progressStore: CoordinatedRunProgressStore
  clock: CoordinatedClock
  boundary: CoordinatedBoundaryHook
  hostApprovals: () => readonly CoordinatedHostApproval[]
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  effectAdapter?: CoordinatedFakeEffectAdapter
  laneLocks?: CoordinatedLaneLockProvider
  workspacePath?: string
  trustedAuthorIdentity?: string
  /** Task IDs whose worker is running in this coordinator generation. */
  inFlightTaskIds: Set<string>
  /** False once the owning host stopped; no further claim, settle, or dispatch is allowed. */
  isActive: () => boolean
  /** Abandon callbacks for in-flight worker waits; host stop runs them to free every timer. */
  pendingWaits: Set<() => void>
}

/** Cancels every registered deadline timer and abandons waits; the external worker is not assumed stopped. */
export function abandonCoordinatorWaits(
  ctx: Pick<CoordinatedRecoveryContext, 'pendingWaits'>
): void {
  for (const abandon of ctx.pendingWaits) {
    abandon()
  }
  ctx.pendingWaits.clear()
}

export class CoordinatedHostStoppedError extends Error {
  constructor() {
    super('The coordinated run host stopped; no further coordinator writes are allowed.')
    this.name = 'CoordinatedHostStoppedError'
  }
}

export function assertCoordinatorActive(ctx: Pick<CoordinatedRecoveryContext, 'isActive'>): void {
  if (!ctx.isActive()) {
    throw new CoordinatedHostStoppedError()
  }
}

export type CoordinatedPassContext = CoordinatedRecoveryContext & {
  ledger: CoordinatedProgressLedger
}

/** The author identity a stage's worker attempt signs with; it may never approve itself. */
export function coordinatedWorkerAuthorIdentity(childDefinitionId: string): string {
  return `worker:${childDefinitionId}`
}
