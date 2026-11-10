import type { AutomationRun } from '../../shared/automations-types'
import { assertNativeStubComposition } from '../runtime/native-stub-session-test-host'
import { finishLocalWorkerStop } from '../runtime/rpc/methods/orchestration/worker/worker-stop-local-finish'
import {
  CoordinatedHostStoppedError,
  type CoordinatedRecoveryContext
} from './coordinated-automation-recovery-context'
import { isCoordinatedNativeAttempt } from './coordinated-automation-native-attempt'
import {
  resolveActiveNativeStubHost,
  type CoordinatedNativeStubWorker
} from './coordinated-automation-native-stub-worker'

const TERMINAL_WORKER_STATES = ['succeeded', 'failed', 'stopped', 'abandoned']

export type CoordinatedNativeStopRequests = {
  /** Dispatches that accepted a new stop request in this call. */
  requested: string[]
  /** Dispatches already terminal (or context-only) before the call. */
  alreadyTerminal: string[]
  /** Dispatches whose stop request the native authority refused (e.g. mid-start). */
  problems: string[]
}

/**
 * Cancellation through native authority: every still-open mapped native Dispatch of the run is
 * asked to stop under the admitted composition generation. Idempotent per Dispatch — a replay
 * finds the earlier `stopping` row and counts it as already requested.
 */
export function requestCoordinatedNativeStops(
  worker: CoordinatedNativeStubWorker,
  run: AutomationRun
): CoordinatedNativeStopRequests {
  const host = resolveActiveNativeStubHost(worker)
  const identity = assertNativeStubComposition(host.composition, host.runtime, host.store)
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
      const begun = host.db.beginWorkerStop(dispatchId, identity.generation)
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

/**
 * Drive every stopping native Dispatch of the run to its proven terminal stop outcome: exit
 * evidence settles, anything unproven is marked stop-unknown. Never synthesizes worker reports.
 */
export async function settleStoppingCoordinatedNativeAttempts(
  worker: CoordinatedNativeStubWorker,
  run: AutomationRun
): Promise<{ settled: string[]; unknown: string[] }> {
  const host = resolveActiveNativeStubHost(worker)
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

/** Reconcile-pass step: settle stopping attempts and report whether any settled (progress signal). */
export async function settleStoppingAttemptsForReconcile(
  ctx: Pick<CoordinatedRecoveryContext, 'nativeStubWorker' | 'isActive'>,
  run: AutomationRun
): Promise<boolean> {
  if (!ctx.nativeStubWorker) {
    return false
  }
  const { settled } = await settleStoppingCoordinatedNativeAttempts(ctx.nativeStubWorker, run)
  if (!ctx.isActive()) {
    throw new CoordinatedHostStoppedError()
  }
  return settled.length > 0
}
