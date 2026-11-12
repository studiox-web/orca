import { expect, it, vi } from 'vitest'
import { createCoordinatedNativeReportMcp } from './coordinated-native-report-mcp'

it('negotiates stdio MCP and exposes only the assigned result tool after initialization', async () => {
  const tool = {
    call: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'native receipt' }],
      isError: false
    })),
    revoke: vi.fn()
  }
  const server = createCoordinatedNativeReportMcp(tool)
  const request = (id: number, method: string, params?: unknown) =>
    server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
  expect(await request(1, 'tools/list')).toMatchObject({ error: { code: -32000 } })
  expect(
    await request(2, 'initialize', {
      protocolVersion: 'future',
      capabilities: {},
      clientInfo: { name: 'fixture', version: '1' }
    })
  ).toMatchObject({
    result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
  })
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
  expect(await request(3, 'tools/list')).toMatchObject({
    result: { tools: [{ name: 'worker_done' }] }
  })
  expect(await request(4, 'resources/read', { uri: 'file:///private' })).toMatchObject({
    error: { code: -32601 }
  })
  expect(await request(5, 'tools/call', { name: 'terminal_create', arguments: {} })).toMatchObject({
    error: { code: -32602 }
  })
  const args = {
    requestId: 'original-report',
    subject: 'Done',
    body: 'Authored report',
    payload: '{}'
  }
  expect(await request(6, 'tools/call', { name: 'worker_done', arguments: args })).toMatchObject({
    result: { isError: false }
  })
  expect(tool.call).toHaveBeenCalledExactlyOnceWith('worker_done', args)
  tool.call.mockRejectedValueOnce(new Error('secret information must not enter MCP output'))
  expect(
    JSON.stringify(await request(7, 'tools/call', { name: 'worker_done', arguments: args }))
  ).not.toContain('secret information')
  server.close()
  expect(await request(8, 'tools/call', { name: 'worker_done', arguments: args })).toMatchObject({
    error: { code: -32000 }
  })
  expect(tool.revoke).toHaveBeenCalledOnce()
})
