import { z } from 'zod'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import type { RpcRequest, RpcResponse } from '../rpc/core'
import {
  assertCoordinatedNativeReportRequest,
  type CoordinatedNativeReportIdentity
} from './coordinated-native-report-admission'

const ReportArguments = z
  .object({
    requestId: z.string().min(1).max(128),
    subject: z.string().min(1).max(1024),
    body: z.string().max(64 * 1024),
    payload: z
      .string()
      .min(1)
      .max(512 * 1024)
  })
  .strict()

export const coordinatedNativeReportToolDefinition = Object.freeze({
  name: 'worker_done',
  description:
    'Submit this assigned worker result to Orca. Preserve requestId and every argument when reconciling an uncertain response. A receipt records technical settlement; it does not grant editorial or publication approval.',
  inputSchema: z.toJSONSchema(ReportArguments),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
})

// The host binds authority; tool arguments cannot choose a recipient, method, endpoint or identity.
export function createCoordinatedNativeReportTool(input: {
  identity: CoordinatedNativeReportIdentity
  authToken: string
  exchange: (request: RpcRequest) => Promise<RpcResponse>
}) {
  const identity = Object.freeze({ ...input.identity })
  const authToken = input.authToken
  const exchange = input.exchange
  let revoked = false
  let inFlight = false
  return Object.freeze({
    async call(name: string, args: unknown) {
      if (revoked || inFlight || name !== coordinatedNativeReportToolDefinition.name) {
        throw new Error('coordinated_native_report_tool_unavailable')
      }
      const parsed = ReportArguments.parse(args)
      const request: RpcRequest = {
        id: parsed.requestId,
        authToken,
        method: 'orchestration.send',
        params: {
          from: identity.terminalHandle,
          senderPaneKey: identity.paneKey,
          run: identity.runId,
          type: 'worker_done',
          subject: parsed.subject,
          body: parsed.body,
          payload: parsed.payload
        },
        orchestrationRequestId: parsed.requestId,
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        expectedRuntimeSource: { sourceId: identity.sourceId, runtimeId: identity.runtimeId },
        orchestrationCompatibilityEvidence: {
          terminalHandle: identity.terminalHandle,
          paneKey: identity.paneKey,
          launchToken: identity.launchToken
        }
      }
      assertCoordinatedNativeReportRequest(request, identity)
      if (Buffer.byteLength(JSON.stringify(request)) > 768 * 1024) {
        throw new Error('coordinated_native_report_tool_too_large')
      }
      inFlight = true
      try {
        const response = await exchange(request)
        if (
          revoked ||
          response.id !== request.id ||
          response._meta.runtimeId !== identity.runtimeId
        ) {
          throw new Error('coordinated_native_report_response_uncertain')
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response) }],
          isError: !response.ok
        }
      } finally {
        inFlight = false
      }
    },
    revoke() {
      revoked = true
    }
  })
}
