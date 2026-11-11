import type { CoordinatedNativeStubWorker } from './coordinated-automation-native-stub-worker'
import type { CoordinatedNativeProviderWorker } from './coordinated-automation-native-provider-worker'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedHostApproval } from './coordinated-automation-approval-validation'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import type { CoordinatedBoundaryHook } from './coordinated-automation-progress-ledger'
import type {
  CoordinatedClock,
  CoordinatedFakeEffectAdapter,
  CoordinatedLaneLockProvider,
  CoordinatedWorkerProvider
} from './coordinated-automation-recovery-context'

export type CoordinatedAutomationAdapterContext = {
  store: Store
  orchestrationDb: OrchestrationDb
  workerProvider?: CoordinatedWorkerProvider
  nativeStubWorker?: CoordinatedNativeStubWorker
  /** Process-local isolated admission; no run host injection or RPC payload carries it. */
  nativeProviderWorker?: CoordinatedNativeProviderWorker
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
