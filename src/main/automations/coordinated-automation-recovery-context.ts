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

export type CoordinatedClock = { now: () => number }

export type CoordinatedRecoveryContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  probe: CoordinatedOrchestrationRecordProbe
  workerProvider: CoordinatedWorkerProvider
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
}

export type CoordinatedPassContext = CoordinatedRecoveryContext & {
  ledger: CoordinatedProgressLedger
}

/** The author identity a stage's worker attempt signs with; it may never approve itself. */
export function coordinatedWorkerAuthorIdentity(childDefinitionId: string): string {
  return `worker:${childDefinitionId}`
}
