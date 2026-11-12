import { z } from 'zod'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  requireNativeProviderLaunch,
  type PreparedNativeProviderLaunch
} from '../native-provider-execution-admission'
import type { RpcRequest, RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { errorResponse } from '../rpc/errors'
import { ORCHESTRATION_SEND_METHODS } from '../rpc/methods/orchestration/messaging/send-methods'
import { STATUS_METHODS } from '../rpc/methods/status'
import { LOCAL_CLI_RPC_CALLER } from '../rpc/rpc-caller-identity'
import { ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  assertCoordinatedNativeReportCurrent,
  assertCoordinatedNativeReportCreation,
  assertCoordinatedNativeReportRequest,
  equalReportSecret,
  type CoordinatedNativeReportIdentity
} from './coordinated-native-report-admission'

const ReportRpcRequest = z
  .object({
    id: z.string().min(1).max(128),
    authToken: z.string(),
    method: z.string(),
    params: z.unknown().optional(),
    orchestrationContractVersion: z.number().optional(),
    orchestrationRequestId: z.string().optional(),
    compatibilityInvocationId: z.string().optional(),
    orchestrationCompatibilityEvidence: z
      .object({
        terminalHandle: z.string().optional(),
        paneKey: z.string().optional(),
        launchToken: z.string().optional(),
        host: z.never().optional(),
        agentSessionId: z.never().optional()
      })
      .strict()
      .optional(),
    expectedRuntimeSource: z.unknown().optional(),
    executionHost: z.unknown().optional()
  })
  .strict()

export function createCoordinatedNativeReportSession(input: {
  runtime: OrcaRuntimeService
  identity: CoordinatedNativeReportIdentity
  authToken: string
  pendingLaunch: PreparedNativeProviderLaunch
}) {
  const identity = Object.freeze({ ...input.identity })
  const authToken = input.authToken
  assertCoordinatedNativeReportCreation(input.runtime, identity, input.pendingLaunch)
  const database = input.runtime.getOrchestrationDb()
  let revoked = false
  const assertCurrent = () => {
    if (revoked || input.runtime.getOrchestrationDb() !== database) {
      throw new Error('coordinated_native_report_revoked')
    }
    requireNativeProviderLaunch(input.pendingLaunch, input.runtime)
    assertCoordinatedNativeReportCurrent(input.runtime, identity)
  }
  const dispatcher = new RpcDispatcher({
    runtime: input.runtime,
    methods: [
      ...STATUS_METHODS,
      ...ORCHESTRATION_SEND_METHODS.map((method) => ({
        ...method,
        handler: (...args: Parameters<typeof method.handler>) => {
          assertCurrent()
          return method.handler(...args)
        }
      }))
    ]
  })
  const refuse = (id: string, code: string): RpcResponse =>
    errorResponse(id, { runtimeId: identity.runtimeId }, code, code)
  const handle = async (raw: string): Promise<RpcResponse> => {
    if (Buffer.byteLength(raw) > 1024 * 1024) {
      return refuse('unknown', 'bad_request')
    }
    let request: RpcRequest
    try {
      request = ReportRpcRequest.parse(JSON.parse(raw))
    } catch {
      return refuse('unknown', 'bad_request')
    }
    if (!equalReportSecret(request.authToken, authToken)) {
      return refuse(request.id, 'unauthorized')
    }
    try {
      assertCurrent()
      assertCoordinatedNativeReportRequest(request, identity)
    } catch {
      return refuse(request.id, 'forbidden')
    }
    const response = await dispatcher.dispatch(request, {
      caller: LOCAL_CLI_RPC_CALLER,
      beforeInvoke: assertCurrent
    })
    if (response.ok && request.method === 'status.get') {
      const status = response.result
      const supportsContract =
        status &&
        typeof status === 'object' &&
        'capabilities' in status &&
        Array.isArray(status.capabilities) &&
        status.capabilities.includes(ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY)
      return {
        ...response,
        result: {
          runtimeId: identity.runtimeId,
          capabilities: supportsContract ? [ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY] : [],
          hostDescriptor: { installationId: identity.sourceId }
        }
      }
    }
    return response
  }
  return Object.freeze({
    handle,
    assertCurrent,
    refuse,
    revoke() {
      revoked = true
    }
  })
}
