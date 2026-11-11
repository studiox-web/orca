import type { AutomationRun } from '../../shared/automations-types'
import { assertNativeStubComposition } from '../runtime/native-stub-session-test-host'
import { finishLocalWorkerStop } from '../runtime/rpc/methods/orchestration/worker/worker-stop-local-finish'
import {
  CoordinatedHostStoppedError,
  type CoordinatedRecoveryContext
} from './coordinated-automation-recovery-context'
import {
  isCoordinatedNativeAttempt,
  NATIVE_STUB_ATTEMPT
} from './coordinated-automation-native-attempt'
import {
  resolveActiveNativeStubHost,
  type CoordinatedNativeStubWorker
} from './coordinated-automation-native-stub-worker'
import {
  resolveActiveNativeProviderHost,
  type CoordinatedNativeProviderWorker
} from './coordinated-automation-native-provider-worker'

const TERMINAL_WORKER_STATES = ['succeeded', 'failed', 'stopped', 'abandoned']
type CoordinatedNativeWorker = CoordinatedNativeStubWorker | CoordinatedNativeProviderWorker

function resolveActiveNativeHost(worker: CoordinatedNativeWorker) {
  if (worker.kind === NATIVE_STUB_ATTEMPT) {
    const host = resolveActiveNativeStubHost(worker)
    return {
      ...host,
      generation: assertNativeStubComposition(host.composition, host.runtime, host.store).generation
    }
  }
  return resolveActiveNativeProviderHost(worker)
}

export type CoordinatedNativeStopRequests = {
  requested: string[]
  alreadyTerminal: string[]
  problems: string[]
}

/** Native stop uses the admitted generation and never creates a worker report on the worker's behalf. */
export function requestCoordinatedNativeStops(
  worker: CoordinatedNativeWorker,
  run: AutomationRun
): CoordinatedNativeStopRequests {
  const host = resolveActiveNativeHost(worker)
  const result: CoordinatedNativeStopRequests = { requested: [], alreadyTerminal: [], problems: [] }
  for (const mapping of run.childMappings ?? []) {
    if (!mapping.dispatchId || !isCoordinatedNativeAttempt(host.db, mapping.dispatchId)) {
      continue
    }
    const dispatchId = mapping.dispatchId
    const row = host.db.getWorkerDispatch(dispatchId)
    if (!row || TERMINAL_WORKER_STATES.includes(row.state)) {
      result.alreadyTerminal.push(dispatchId)
      continue
    }
    try {
      const begun = host.db.beginWorkerStop(dispatchId, host.generation)
      if (begun.disposition === 'stopping') {
        result.requested.push(dispatchId)
      } else {
        result.alreadyTerminal.push(dispatchId)
      }
    } catch (error) {
      result.problems.push(
        `${dispatchId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return result
}

/** Exit evidence settles a stop; anything unproven stays stop-unknown. */
export async function settleStoppingCoordinatedNativeAttempts(
  worker: CoordinatedNativeWorker,
  run: AutomationRun
): Promise<{ settled: string[]; unknown: string[] }> {
  const host = resolveActiveNativeHost(worker)
  const settled: string[] = []
  const unknown: string[] = []
  for (const mapping of run.childMappings ?? []) {
    if (!mapping.dispatchId || !isCoordinatedNativeAttempt(host.db, mapping.dispatchId)) {
      continue
    }
    const dispatchId = mapping.dispatchId
    const row = host.db.getWorkerDispatch(dispatchId)
    if (!row || row.state !== 'stopping') {
      continue
    }
    const finished = await finishLocalWorkerStop(host.runtime, host.db, dispatchId, row)
    ;(finished.kind === 'stopped' ? settled : unknown).push(dispatchId)
  }
  return { settled, unknown }
}

export async function settleStoppingAttemptsForReconcile(
  ctx: Pick<CoordinatedRecoveryContext, 'nativeStubWorker' | 'nativeProviderWorker' | 'isActive'>,
  run: AutomationRun
): Promise<boolean> {
  const worker = ctx.nativeStubWorker ?? ctx.nativeProviderWorker
  if (!worker) {
    return false
  }
  const { settled } = await settleStoppingCoordinatedNativeAttempts(worker, run)
  if (!ctx.isActive()) {
    throw new CoordinatedHostStoppedError()
  }
  return settled.length > 0
}
