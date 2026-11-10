import type { WorkerDispatchRow } from '../../../../orchestration/types'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { describeUnconfirmedAgentStop } from '../../../../../../shared/pty-liveness-verdict'
import { isStructuredWorkerHandle } from '../../../../../../shared/structured-worker-handle'
import { inspectWorkerTerminal } from './worker-observation'
import { archiveWorkerOutputBeforeStop } from './worker-stop-archive'
import {
  resolveStructuredWorkerForDispatch,
  stopStructuredWorker
} from '../../orchestration-structured-worker-lifecycle'

export type LocalWorkerStopFinish =
  | {
      kind: 'stopped'
      processAction: 'closed_agent_terminal' | 'none'
      worker: WorkerDispatchRow
      close?: unknown
    }
  | {
      kind: 'unknown'
      processAction: 'none' | 'unknown' | 'closed_agent_terminal'
      worker: WorkerDispatchRow
    }

/**
 * Everything `orchestration.workerStop` does after `beginWorkerStop` admitted a local stop:
 * prove the terminal, archive output, close it, and settle only a proven exit — otherwise the
 * Dispatch is marked stop-unknown. Shared by the RPC handler and the coordinated stop authority.
 */
export async function finishLocalWorkerStop(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  dispatchId: string,
  begunWorker: WorkerDispatchRow
): Promise<LocalWorkerStopFinish> {
  const handle = begunWorker.agent_terminal_handle
  if (!handle) {
    return unknownFinish(
      db.markWorkerStopUnknown(dispatchId, 'The Dispatch has no recorded agent terminal.'),
      'none'
    )
  }
  if (isStructuredWorkerHandle(handle)) {
    await runtime.ensureStructuredAgentSessionHost().catch((error: unknown) => {
      console.warn('[orchestration] structured host install failed before stop', handle, error)
    })
  }
  const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
  const liveHandle = observation.terminalHandle ?? handle
  // The host exit can settle this stop while terminal inspection is awaiting inventory.
  if (db.getWorkerDispatch(dispatchId)?.state === 'stopped') {
    return {
      kind: 'stopped',
      processAction: 'none',
      worker: db.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    }
  }
  // Still attempt stop on unverifiable contact. Structured exited is also addressable: close/hide its current /clear session to prevent restart on mail.
  if (
    !observation.exact ||
    (observation.status !== 'live' &&
      observation.status !== 'unverifiable' &&
      !isStructuredWorkerHandle(handle))
  ) {
    return unknownFinish(
      db.markWorkerStopUnknown(
        dispatchId,
        `The recorded worker process is ${observation.status}; no terminal was closed.`
      ),
      'none'
    )
  }
  const resource = db.getWorkerTerminalResourceByOwner(dispatchId)
  if (!resource || resource.ownership_state !== 'owned') {
    const ownership = resource?.ownership_state ?? 'unproven'
    return unknownFinish(
      db.markWorkerStopUnknown(
        dispatchId,
        `The worker terminal is ${ownership}; no terminal was closed.`
      ),
      'none'
    )
  }
  await archiveWorkerOutputBeforeStop({
    runtime,
    db,
    dispatchId,
    terminalHandle: liveHandle,
    attachedAt: begunWorker.created_at
  })
  const structured = resolveStructuredWorkerForDispatch(db, dispatchId)
  if (structured) {
    const stop = await stopStructuredWorker(structured, runtime)
    if (!stop.stopped) {
      // Only proven exit settles; if no close was issued, the receipt must not claim one.
      return unknownFinish(
        db.markWorkerStopUnknown(dispatchId, stop.reason ?? 'The close was not proven.'),
        stop.closeAttempted ? 'closed_agent_terminal' : 'none'
      )
    }
    return {
      kind: 'stopped',
      processAction: 'closed_agent_terminal',
      worker: db.settleWorkerStop(dispatchId)
    }
  }
  const closed = await runtime
    .closeTerminal(liveHandle)
    .then((close) => ({ close }) as const)
    .catch(
      (error: unknown) =>
        ({ error: error instanceof Error ? error.message : String(error) }) as const
    )
  if ('error' in closed) {
    if (db.getWorkerDispatch(dispatchId)?.state !== 'stopped') {
      return unknownFinish(db.markWorkerStopUnknown(dispatchId, closed.error), 'unknown')
    }
    return {
      kind: 'stopped',
      processAction: 'closed_agent_terminal',
      worker: db.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    }
  }
  // A concurrent process exit already proves and settles stop; do not re-settle or report uncertainty.
  if (db.getWorkerDispatch(dispatchId)?.state !== 'stopped') {
    if (!closed.close.ptyKilled) {
      return unknownFinish(
        db.markWorkerStopUnknown(dispatchId, describeUnconfirmedAgentStop(closed.close)),
        'closed_agent_terminal'
      )
    }
    db.settleWorkerStop(dispatchId)
  }
  return {
    kind: 'stopped',
    processAction: 'closed_agent_terminal',
    worker: db.getWorkerDispatch(dispatchId) as WorkerDispatchRow,
    close: closed.close
  }
}

function unknownFinish(
  worker: WorkerDispatchRow,
  processAction: 'none' | 'unknown' | 'closed_agent_terminal'
): LocalWorkerStopFinish {
  return { kind: 'unknown', processAction, worker }
}
