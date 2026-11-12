import { z } from 'zod'
import {
  coordinatedNativeReportToolDefinition,
  type createCoordinatedNativeReportTool
} from './coordinated-native-report-tool'

const Message = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(128), z.number().int()]).optional(),
    method: z.string().max(128),
    params: z.unknown().optional()
  })
  .strict()
const Initialize = z
  .object({
    protocolVersion: z.string(),
    capabilities: z.object({}).passthrough(),
    clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough()
  })
  .passthrough()
const Call = z
  .object({ name: z.literal('worker_done'), arguments: z.unknown(), _meta: z.unknown().optional() })
  .strict()
const Empty = z.object({ _meta: z.unknown().optional() }).strict()
const versions = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

export function createCoordinatedNativeReportMcp(
  tool: ReturnType<typeof createCoordinatedNativeReportTool>
) {
  let phase: 'new' | 'initializing' | 'ready' | 'closed' = 'new'
  return {
    async handle(raw: unknown) {
      const parsed = Message.safeParse(raw)
      const error = (id: string | number | null, code: number, message: string) => ({
        jsonrpc: '2.0',
        id,
        error: { code, message }
      })
      if (!parsed.success) {
        return error(null, -32600, 'Invalid request')
      }
      const request = parsed.data
      if (request.id === undefined) {
        if (request.method === 'notifications/initialized' && phase === 'initializing') {
          phase = 'ready'
        }
        return undefined
      }
      const reply = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result })
      if (phase === 'closed') {
        return error(request.id, -32000, 'Report channel closed')
      }
      if (request.method === 'ping') {
        return reply({})
      }
      if (request.method === 'initialize') {
        const initialize = Initialize.safeParse(request.params)
        if (phase !== 'new' || !initialize.success) {
          return error(request.id, -32602, 'Invalid initialization')
        }
        phase = 'initializing'
        return reply({
          protocolVersion: versions.has(initialize.data.protocolVersion)
            ? initialize.data.protocolVersion
            : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'orca-assigned-worker-report', version: '1.0.0' }
        })
      }
      if (phase !== 'ready') {
        return error(request.id, -32000, 'Report channel not initialized')
      }
      if (request.method === 'tools/list') {
        if (!Empty.safeParse(request.params ?? {}).success) {
          return error(request.id, -32602, 'Invalid tool listing')
        }
        return reply({ tools: [coordinatedNativeReportToolDefinition] })
      }
      if (request.method !== 'tools/call') {
        return error(request.id, -32601, 'Method not found')
      }
      const call = Call.safeParse(request.params)
      if (!call.success) {
        return error(request.id, -32602, 'Only assigned worker_done is supported')
      }
      try {
        return reply(await tool.call(call.data.name, call.data.arguments))
      } catch {
        return reply({
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Report was refused or its acknowledgement is uncertain. Inspect the native receipt before another action; preserve the original requestId and arguments.'
            }
          ]
        })
      }
    },
    close() {
      phase = 'closed'
      tool.revoke()
    }
  }
}
