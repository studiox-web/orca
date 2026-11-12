import { describe, expect, it, vi } from 'vitest'
import type { RpcRequest, RpcResponse } from '../rpc/core'
import { createCoordinatedNativeReportTool } from './coordinated-native-report-tool'

function fixture() {
  const identity = {
    runtimeId: 'runtime',
    sourceId: 'source',
    runId: 'run',
    taskId: 'task',
    dispatchId: 'dispatch',
    terminalHandle: 'terminal',
    paneKey: 'pane',
    launchToken: 'secret-launch',
    consumerGeneration: 1
  }
  const args = {
    requestId: 'stable-request',
    subject: 'Draft ready',
    body: 'Human readable report',
    payload: JSON.stringify({ taskId: 'task', dispatchId: 'dispatch', outcome: 'succeeded' })
  }
  const exchange = vi.fn(async (request: RpcRequest): Promise<RpcResponse> => ({
    id: request.id,
    ok: true,
    _meta: { runtimeId: 'runtime' },
    result: { mutation: { requestId: request.orchestrationRequestId } }
  }))
  const tool = createCoordinatedNativeReportTool({ identity, authToken: 'secret-rpc', exchange })
  return { identity, args, exchange, tool }
}

describe('attempt-bound report tool', () => {
  it('forwards the unchanged authored report with frozen authority and stable replay identity', async () => {
    const f = fixture()
    f.identity.dispatchId = 'foreign'
    const result = await f.tool.call('worker_done', f.args)
    await f.tool.call('worker_done', f.args)
    expect(f.exchange.mock.calls[0][0]).toEqual(f.exchange.mock.calls[1][0])
    expect(f.exchange.mock.calls[0][0]).toMatchObject({
      method: 'orchestration.send',
      params: {
        from: 'terminal',
        run: 'run',
        type: 'worker_done',
        subject: f.args.subject,
        body: f.args.body,
        payload: f.args.payload
      },
      orchestrationRequestId: f.args.requestId,
      orchestrationCompatibilityEvidence: {
        terminalHandle: 'terminal',
        paneKey: 'pane',
        launchToken: 'secret-launch'
      }
    })
    expect(JSON.stringify(result)).not.toContain('secret-')
  })

  it('rejects extra authority, other tools, malformed and oversized reports before delivery', async () => {
    const f = fixture()
    for (const args of [
      null,
      { ...f.args, endpoint: '/other.sock' },
      { ...f.args, method: 'terminal.create' },
      { ...f.args, requestId: '' },
      { ...f.args, payload: 'not json' },
      { ...f.args, payload: JSON.stringify({ taskId: 'foreign', dispatchId: 'dispatch' }) },
      { ...f.args, payload: JSON.stringify({ taskId: 'task', dispatchId: 'foreign' }) },
      { ...f.args, body: 'x'.repeat(64 * 1024 + 1) },
      {
        ...f.args,
        payload: JSON.stringify({
          taskId: 'task',
          dispatchId: 'dispatch',
          summary: '界'.repeat(300 * 1024)
        })
      }
    ]) {
      await expect(f.tool.call('worker_done', args)).rejects.toThrow()
    }
    await expect(f.tool.call('terminal_create', f.args)).rejects.toThrow('unavailable')
    expect(f.exchange).not.toHaveBeenCalled()
  })

  it('does not retry an uncertain delivery or accept a response from another runtime', async () => {
    const f = fixture()
    f.exchange.mockRejectedValueOnce(new Error('ack_lost'))
    await expect(f.tool.call('worker_done', f.args)).rejects.toThrow('ack_lost')
    expect(f.exchange).toHaveBeenCalledTimes(1)
    f.exchange.mockResolvedValueOnce({
      id: f.args.requestId,
      ok: true,
      result: {},
      _meta: { runtimeId: 'restarted' }
    })
    await expect(f.tool.call('worker_done', f.args)).rejects.toThrow('response_uncertain')
    expect(f.exchange).toHaveBeenCalledTimes(2)
  })

  it('allows only one delivery at a time and revokes pending and future acknowledgements', async () => {
    const f = fixture()
    let resolve!: (response: RpcResponse) => void
    f.exchange.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    const pending = f.tool.call('worker_done', f.args)
    await expect(f.tool.call('worker_done', f.args)).rejects.toThrow('unavailable')
    f.tool.revoke()
    resolve({
      id: f.args.requestId,
      ok: true,
      result: {},
      _meta: { runtimeId: 'runtime' }
    })
    await expect(pending).rejects.toThrow('response_uncertain')
    await expect(f.tool.call('worker_done', f.args)).rejects.toThrow('unavailable')
    expect(f.exchange).toHaveBeenCalledTimes(1)
  })
})
