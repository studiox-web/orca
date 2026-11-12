import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import { COORDINATED_NATIVE_PROVIDER_CAPABILITY } from './coordinated-automation-native-provider-plan'
import {
  createFileCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import type { CoordinatedWorkerProvider } from './coordinated-automation-recovery-context'
import type { CoordinatedRunHostLane } from './coordinated-automation-run-host'
import type { CoordinatedRunHostInjection } from './coordinated-automation-run-host-types'

export const COORDINATED_PROGRESS_DIRECTORY = 'coordinated-automation-progress'

function workerProvider(injection: CoordinatedRunHostInjection): CoordinatedWorkerProvider {
  if (injection.capability !== COORDINATED_NATIVE_PROVIDER_CAPABILITY) {
    return injection.workerProvider
  }
  return {
    capability: COORDINATED_NATIVE_PROVIDER_CAPABILITY,
    run: async () => {
      throw new Error('Native attempts must use authenticated Task/Dispatch execution.')
    },
    estimateCostUsd: (identity) => {
      const cost = injection.estimateCostUsd(identity)
      if (!Number.isFinite(cost) || cost <= 0) {
        throw new Error(
          'Native attempt cost is unknown; an explicit positive estimate is required.'
        )
      }
      return cost
    }
  }
}

export function createCoordinatedRunHostExecution(input: {
  store: Store
  injection: CoordinatedRunHostInjection
  lane: CoordinatedRunHostLane
  isActive: () => boolean
  onProgressCommitted: () => void
}): { adapter: CoordinatedAutomationAdapter; progressStore: CoordinatedRunProgressStore } {
  const { injection } = input
  const stored = createFileCoordinatedRunProgressStore(
    join(injection.profile.root, COORDINATED_PROGRESS_DIRECTORY)
  )
  const progressStore: CoordinatedRunProgressStore = {
    read: (id) => stored.read(id),
    write: (next, expectedSequence) => {
      stored.write(next, expectedSequence)
      try {
        input.onProgressCommitted()
      } catch (error) {
        console.warn('[automations] coordinated progress listener failed:', error)
      }
    }
  }
  const effects = injection.effects
  const adapter = new CoordinatedAutomationAdapter({
    store: input.store,
    orchestrationDb: injection.orchestrationDb,
    workerProvider: workerProvider(injection),
    nativeProviderWorker: injection.nativeProviderWorker,
    workspacePath: injection.workspacePath,
    runInParentLane: input.lane,
    progressStore,
    clock: injection.clock,
    laneLocks: injection.laneLocks,
    durableBoundary: injection.durableBoundary,
    ...(effects.policy === 'fake' ? { effectAdapter: effects.adapter } : {}),
    isActive: input.isActive
  })
  return { adapter, progressStore }
}
