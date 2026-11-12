import { timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { RpcRequest } from '../rpc/core'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getPublishedHostDescriptor } from '../host-descriptor'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import { SendParams, parseRemoteWorkerPayload } from '../rpc/methods/orchestration/schemas'
import {
  requireNativeProviderLaunch,
  type PreparedNativeProviderLaunch
} from '../native-provider-execution-admission'

export type CoordinatedNativeReportIdentity = Readonly<{
  runtimeId: string
  sourceId: string
  runId: string
  taskId: string
  dispatchId: string
  terminalHandle: string
  paneKey: string
  launchToken: string
  consumerGeneration: number
}>

export function assertCoordinatedNativeReportCreation(
  runtime: OrcaRuntimeService,
  identity: CoordinatedNativeReportIdentity,
  pendingLaunch: PreparedNativeProviderLaunch
): void {
  const permit = requireNativeProviderLaunch(pendingLaunch)
  if (permit.phase === 'dispatched') {
    if (
      permit.runtime !== runtime ||
      permit.runId !== identity.runId ||
      permit.taskId !== identity.taskId ||
      permit.dispatchId !== identity.dispatchId
    ) {
      throw new Error('coordinated_native_report_launch_mismatch')
    }
    return assertCoordinatedNativeReportCurrent(runtime, identity)
  }
  const db = runtime.getOrchestrationDb()
  const dispatch = db.getDispatchContextById(identity.dispatchId)
  if (
    permit.runtime !== runtime ||
    permit.phase !== 'creating' ||
    !permit.admission.pilotScope ||
    permit.runId !== identity.runId ||
    permit.taskId !== identity.taskId ||
    permit.dispatchId !== identity.dispatchId ||
    runtime.getRuntimeId() !== identity.runtimeId ||
    getPublishedHostDescriptor(identity.runtimeId)?.installationId !== identity.sourceId ||
    !dispatch ||
    dispatch.task_id !== identity.taskId ||
    dispatch.run_id !== identity.runId ||
    dispatch.consumer_generation !== 0 ||
    identity.consumerGeneration !== 1 ||
    db.getWorkerDispatch(identity.dispatchId)?.state !== 'starting'
  ) {
    throw new Error('coordinated_native_report_launch_mismatch')
  }
}

export function equalReportSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') {
    return false
  }
  const bytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes)
}

export function assertCoordinatedNativeReportCurrent(
  runtime: OrcaRuntimeService,
  identity: CoordinatedNativeReportIdentity
): void {
  const db = runtime.getOrchestrationDb()
  const dispatch = db.getDispatchContextById(identity.dispatchId)
  if (
    runtime.getRuntimeId() !== identity.runtimeId ||
    getPublishedHostDescriptor(identity.runtimeId)?.installationId !== identity.sourceId ||
    !dispatch ||
    dispatch.run_id !== identity.runId ||
    dispatch.task_id !== identity.taskId ||
    dispatch.assignee_handle !== identity.terminalHandle ||
    dispatch.assignee_pane_key !== identity.paneKey ||
    dispatch.consumer_generation !== identity.consumerGeneration ||
    db.getDispatchContext(identity.taskId)?.id !== identity.dispatchId
  ) {
    throw new Error('coordinated_native_report_identity_changed')
  }
}

export function assertCoordinatedNativeReportRequest(
  request: RpcRequest,
  identity: CoordinatedNativeReportIdentity
): void {
  if (request.method === 'status.get') {
    if (request.params !== undefined && !isDeepStrictEqual(request.params, {})) {
      throw new Error('coordinated_native_report_status_params')
    }
    return
  }
  if (request.method !== 'orchestration.send') {
    throw new Error('coordinated_native_report_method_forbidden')
  }
  const evidence = request.orchestrationCompatibilityEvidence
  const params = SendParams.parse(request.params)
  const payload = parseRemoteWorkerPayload(params.payload)
  if (
    request.orchestrationContractVersion !== ORCHESTRATION_CONTRACT_VERSION ||
    !request.orchestrationRequestId ||
    request.orchestrationRequestId.length > 128 ||
    !isDeepStrictEqual(request.expectedRuntimeSource, {
      sourceId: identity.sourceId,
      runtimeId: identity.runtimeId
    }) ||
    evidence?.terminalHandle !== identity.terminalHandle ||
    evidence.paneKey !== identity.paneKey ||
    !equalReportSecret(evidence.launchToken, identity.launchToken) ||
    evidence.host !== undefined ||
    evidence.agentSessionId !== undefined ||
    request.executionHost !== undefined ||
    params.type !== 'worker_done' ||
    params.from !== identity.terminalHandle ||
    (params.senderPaneKey !== undefined && params.senderPaneKey !== identity.paneKey) ||
    (params.run !== undefined && params.run !== identity.runId) ||
    params.to !== undefined ||
    params.devMode !== undefined ||
    params.threadId !== undefined ||
    payload.taskId !== identity.taskId ||
    payload.dispatchId !== identity.dispatchId
  ) {
    throw new Error('coordinated_native_report_scope_mismatch')
  }
}
