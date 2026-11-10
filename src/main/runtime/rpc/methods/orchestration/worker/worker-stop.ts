import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { defineMethod } from '../../../core'
import { ORCHESTRATION_WORKER_STOP_VERDICT_RUNTIME_CAPABILITY } from '../../../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { resolvePinnedFederatedServer } from './worker-observation'
import { refuseFederatedStopWhileKeptOpen } from './worker-keep-open'
import { finishLocalWorkerStop } from './worker-stop-local-finish'
import { WorkerDispatchParams } from '../../../../../../shared/rpc-contract/orchestration-worker-stop-params'

export const ORCHESTRATION_WORKER_STOP_METHODS = [
  defineMethod({
    name: 'orchestration.workerStop',
    permission: 'workspace',
    params: WorkerDispatchParams,
    handler: (params, { runtime, orchestrationMutation }) =>
      dedupeWorkerStop(runtime, params.dispatch, async () => {
        const db = runtime.getOrchestrationDb()
        const federated = db.getFederatedDispatch(params.dispatch)
        if (federated) {
          if (!orchestrationMutation) {
            throw new OrchestrationError(
              'invalid_argument',
              'Remote worker-stop requires a durable retry request.'
            )
          }
          await refuseFederatedStopWhileKeptOpen(runtime, federated)
          const server = resolvePinnedFederatedServer(runtime, federated)
          const begun = db.beginWorkerStop(params.dispatch, runtime.getRuntimeId())
          if (begun.disposition === 'already_settled') {
            return settledReceipt(params.dispatch, begun.worker.state)
          }
          try {
            const status = (await runtime.callOrchestrationWorkerServer(
              server.environmentId,
              'status.get',
              undefined,
              30_000,
              undefined,
              { expectedEnvironmentPairingRevision: server.pairingRevision }
            )) as RuntimeStatus
            if (
              !status.capabilities?.includes(ORCHESTRATION_WORKER_STOP_VERDICT_RUNTIME_CAPABILITY)
            ) {
              return unknownReceipt(
                params.dispatch,
                db.markWorkerStopUnknown(
                  params.dispatch,
                  `Connected server ${server.name} cannot prove the worker stop outcome.`
                ),
                'none'
              )
            }
            const remote = (await runtime.callOrchestrationWorkerServer(
              server.environmentId,
              'orchestration.federationStop',
              { dispatchId: params.dispatch },
              30_000,
              { orchestrationRequestId: orchestrationMutation.requestId },
              { expectedEnvironmentPairingRevision: server.pairingRevision }
            )) as RemoteStopReceipt
            if (remote.state === 'stopped') {
              const worker = db.reconcileFederatedWorkerStop(params.dispatch)
              return {
                dispatchId: params.dispatch,
                state: worker.state,
                alreadySettled: remote.alreadySettled,
                processAction: remote.processAction,
                close: remote.close
              }
            }
            if (remote.state === 'succeeded' || remote.state === 'failed') {
              db.resumeFederatedWorkerForTerminalRelay(params.dispatch)
              await runtime
                .syncOrchestrationFederatedDispatchAfterCurrent(params.dispatch)
                .catch(() => undefined)
              return {
                dispatchId: params.dispatch,
                state: db.getWorkerDispatch(params.dispatch)?.state ?? remote.state,
                alreadySettled: true,
                processAction: 'none'
              }
            }
            return unknownReceipt(
              params.dispatch,
              db.markWorkerStopUnknown(
                params.dispatch,
                remote.lastError ?? `The worker server returned ${remote.state}.`
              ),
              remote.processAction
            )
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            return unknownReceipt(
              params.dispatch,
              db.markWorkerStopUnknown(params.dispatch, reason),
              'unknown'
            )
          }
        }

        const begun = db.beginWorkerStop(params.dispatch, runtime.getRuntimeId())
        if (begun.disposition === 'already_settled') {
          return settledReceipt(params.dispatch, begun.worker.state)
        }
        if (begun.disposition === 'context_only') {
          if (!begun.alreadySettled) {
            runtime.notifyMessageArrived(`dispatch:${params.dispatch}`, 'status')
          }
          return {
            dispatchId: params.dispatch,
            state: begun.state,
            alreadySettled: begun.alreadySettled,
            processAction: 'none' as const,
            warning: contextOnlyStopWarning(begun)
          }
        }
        const finished = await finishLocalWorkerStop(runtime, db, params.dispatch, begun.worker)
        if (finished.kind === 'stopped') {
          runtime.notifyMessageArrived(`dispatch:${params.dispatch}`, 'status')
          return {
            dispatchId: params.dispatch,
            state: finished.worker.state,
            alreadySettled: false,
            processAction: finished.processAction,
            ...(finished.close !== undefined ? { close: finished.close } : {})
          }
        }
        return unknownReceipt(params.dispatch, finished.worker, finished.processAction)
      })
  })
]

const activeStopByRuntime = new WeakMap<OrcaRuntimeService, Map<string, Promise<unknown>>>()

/** Coalesce same-runtime stops so only one closes; beginWorkerStop admits this epoch only to recover a row stranded by a dead runtime. */
function dedupeWorkerStop(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  stop: () => Promise<unknown>
): Promise<unknown> {
  let active = activeStopByRuntime.get(runtime)
  if (!active) {
    active = new Map()
    activeStopByRuntime.set(runtime, active)
  }
  const inFlight = active.get(dispatchId)
  if (inFlight) {
    return inFlight
  }
  const started: Promise<unknown> = stop().finally(() => {
    if (active.get(dispatchId) === started) {
      active.delete(dispatchId)
    }
  })
  active.set(dispatchId, started)
  return started
}

type RemoteStopReceipt = {
  state: string
  alreadySettled: boolean
  processAction: string
  close?: unknown
  lastError?: string | null
}

function settledReceipt(dispatchId: string, state: string) {
  return { dispatchId, state, alreadySettled: true, processAction: 'none' }
}

function contextOnlyStopWarning(result: {
  state: string
  alreadySettled: boolean
  releasedCurrentTask: boolean
}): string {
  if (result.alreadySettled) {
    return `Dispatch was already ${result.state}; no terminal process changed.`
  }
  return result.releasedCurrentTask
    ? 'The assignment was stopped without closing its unsupervised terminal process.'
    : 'The superseded assignment was stopped without changing the current Task or terminal process.'
}

function unknownReceipt(
  dispatchId: string,
  worker: { state: string; last_error: string | null },
  processAction: string
) {
  return {
    dispatchId,
    state: worker.state,
    alreadySettled: false,
    processAction,
    lastError: worker.last_error
  }
}
