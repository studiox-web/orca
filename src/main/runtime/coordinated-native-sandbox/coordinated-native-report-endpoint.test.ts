import '../rpc/unused-default-rpc-methods.test-fixture'
import { expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installNativeStubAttemptHooks,
  setupNativeStubAttempt
} from '../coordinated-native-stub-attempt.test-support'
import {
  createNativeRun,
  dispatchWriter,
  evidenceFor,
  structuredReport
} from '../coordinated-native-stub-run.test-support'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import {
  RuntimeRpcEnvelopeSchema,
  type RuntimeRpcResponse
} from '../../../shared/runtime-rpc-envelope'
import { RpcDispatcher } from '../rpc/dispatcher'
import { publishHostDescriptor } from '../host-descriptor'
import { createCoordinatedNativeReportEndpoint } from './coordinated-native-report-endpoint'
import { createCoordinatedNativeReportSession } from './coordinated-native-report-session'
import { createCoordinatedNativeReportTool } from './coordinated-native-report-tool'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
installNativeStubAttemptHooks(native.spawn)

function exchange(endpoint: string, request: unknown): Promise<RuntimeRpcResponse<unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000, () => socket.destroy(new Error('fixture_socket_timeout')))
    socket.once('error', reject)
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (bytes) => {
      buffer += String(bytes)
      if (buffer.includes('\n')) {
        socket.end()
        const response = RuntimeRpcEnvelopeSchema.parse(
          JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        )
        if ('ok' in response) {
          resolve(response)
        } else {
          reject(new Error('unexpected_keepalive'))
        }
      }
    })
  })
}

it('keeps forbidden calls out of dispatch and settles the exact authenticated report with native replay', async () => {
  const f = await setupNativeStubAttempt({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(
    f,
    undefined,
    30,
    {},
    {
      agentId: 'muse',
      model: 'frozen-model',
      reasoningEffort: 'high'
    }
  )
  const dispatchId = await dispatchWriter(f, run.id)
  const terminal = f.createdTerminals.at(-1)!
  const sourceId = 'b7ac5d7e-9e4a-40d4-a310-88baecf1c2cd'
  const directory = mkdtempSync(join(tmpdir(), 'orca-report-'))
  const endpoint = await createCoordinatedNativeReportEndpoint({
    runtime: f.runtime,
    pendingLaunch: f.providerPermits.at(-1)!,
    directory,
    identity: {
      runtimeId: f.runtime.getRuntimeId(),
      sourceId,
      runId: run.orchestrationRunId!,
      taskId: writerTaskId,
      dispatchId,
      terminalHandle: terminal.handle,
      paneKey: terminal.paneKey!,
      launchToken: terminal.launchToken!,
      consumerGeneration: f.db.getDispatchContextById(dispatchId)!.consumer_generation
    }
  })
  try {
    const metadata = JSON.parse(readFileSync(join(endpoint.directory, 'orca-runtime.json'), 'utf8'))
    expect(statSync(endpoint.endpoint).mode & 0o777).toBe(0o600)
    expect(statSync(endpoint.directory).mode & 0o777).toBe(0o700)
    const request = {
      id: 'report',
      authToken: metadata.authToken,
      method: 'orchestration.send',
      params: {
        from: terminal.handle,
        type: 'worker_done',
        subject: 'Synthetic completion',
        payload: JSON.stringify({
          taskId: writerTaskId,
          dispatchId,
          outcome: 'succeeded',
          structuredResult: structuredReport(run, {
            childDefinitionId: 'writer',
            taskId: writerTaskId,
            dispatchId
          })
        })
      },
      orchestrationRequestId: 'exact-report-request',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      expectedRuntimeSource: { sourceId, runtimeId: f.runtime.getRuntimeId() },
      orchestrationCompatibilityEvidence: evidenceFor(terminal)
    }
    const dispatch = vi.spyOn(RpcDispatcher.prototype, 'dispatch')
    for (const forbidden of [
      null,
      [],
      { ...request, authToken: 'foreign' },
      { ...request, method: 'terminal.create' },
      { ...request, method: 'orchestration.taskCreate' },
      { ...request, params: { ...request.params, type: 'status' } },
      { ...request, params: { ...request.params, to: `run:${run.orchestrationRunId}` } },
      { ...request, params: { ...request.params, from: 'term_other' } },
      {
        ...request,
        params: { ...request.params, payload: JSON.stringify({ taskId: 'other', dispatchId }) }
      },
      {
        ...request,
        orchestrationCompatibilityEvidence: { ...evidenceFor(terminal), launchToken: 'foreign' }
      },
      {
        ...request,
        orchestrationCompatibilityEvidence: { ...evidenceFor(terminal), paneKey: 'other' }
      },
      { ...request, expectedRuntimeSource: { sourceId, runtimeId: 'restarted' } },
      { ...request, orchestrationContractVersion: 0 }
    ]) {
      expect(await exchange(endpoint.endpoint, forbidden)).toMatchObject({ ok: false })
    }
    const changedDatabase = vi
      .spyOn(f.runtime, 'getOrchestrationDb')
      .mockReturnValue(Object.create(f.db))
    expect(await exchange(endpoint.endpoint, request)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    changedDatabase.mockRestore()
    publishHostDescriptor(f.runtime.getRuntimeId(), { installationId: 'changed-profile' })
    expect(await exchange(endpoint.endpoint, request)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    publishHostDescriptor(f.runtime.getRuntimeId(), { installationId: sourceId })
    expect(dispatch).not.toHaveBeenCalled()
    expect(f.db.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    const status = await exchange(endpoint.endpoint, {
      id: 'handshake',
      authToken: metadata.authToken,
      method: 'status.get'
    })
    expect(status).toMatchObject({
      ok: true,
      result: { hostDescriptor: { installationId: sourceId } }
    })
    if (status.ok && status.result && typeof status.result === 'object') {
      expect(Object.keys(status.result).sort()).toEqual([
        'capabilities',
        'hostDescriptor',
        'runtimeId'
      ])
    }
    const accepted = await exchange(endpoint.endpoint, request)
    expect(accepted).toMatchObject({ ok: true })
    expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    const replay = await exchange(endpoint.endpoint, { ...request, id: 'lost-ack-replay' })
    expect(replay).toMatchObject({
      ok: true,
      result: { mutation: { requestId: 'exact-report-request', replayed: true } }
    })
    if (accepted.ok && replay.ok && accepted.result && typeof accepted.result === 'object') {
      expect(replay.result).toEqual({
        ...accepted.result,
        mutation: { requestId: 'exact-report-request', replayed: true }
      })
    }
    expect(
      await exchange(endpoint.endpoint, {
        ...request,
        id: 'changed-replay',
        params: { ...request.params, subject: 'Changed result' }
      })
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    expect((await f.adapter.reconcileRun(run.id)).state).toBe('completed')
    expect(native.spawn).toHaveBeenCalledTimes(1)
  } finally {
    await endpoint.stop()
    rmSync(directory, { recursive: true, force: true })
  }
  expect(existsSync(endpoint.endpoint)).toBe(false)
  expect(() => endpoint.assertCurrent()).toThrow('coordinated_native_report_revoked')
})

it('keeps tool delivery on native settlement, replay, and runtime revocation without a socket', async () => {
  const f = await setupNativeStubAttempt({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(
    f,
    undefined,
    30,
    {},
    {
      agentId: 'muse',
      model: 'frozen-model',
      reasoningEffort: 'high'
    }
  )
  const dispatchId = await dispatchWriter(f, run.id)
  const terminal = f.createdTerminals.at(-1)!
  const identity = {
    runtimeId: f.runtime.getRuntimeId(),
    sourceId: 'b7ac5d7e-9e4a-40d4-a310-88baecf1c2cd',
    runId: run.orchestrationRunId!,
    taskId: writerTaskId,
    dispatchId,
    terminalHandle: terminal.handle,
    paneKey: terminal.paneKey!,
    launchToken: terminal.launchToken!,
    consumerGeneration: f.db.getDispatchContextById(dispatchId)!.consumer_generation
  }
  const authToken = 'fixture-tool-token'
  const session = createCoordinatedNativeReportSession({
    runtime: f.runtime,
    identity,
    authToken,
    pendingLaunch: f.providerPermits.at(-1)!
  })
  const tool = createCoordinatedNativeReportTool({
    identity,
    authToken,
    exchange: (request) => session.handle(JSON.stringify(request))
  })
  const args = {
    requestId: 'tool-report-request',
    subject: 'Synthetic worker result',
    body: 'Fixture authored report; no physical provider acceptance.',
    payload: JSON.stringify({
      taskId: writerTaskId,
      dispatchId,
      outcome: 'succeeded',
      structuredResult: structuredReport(run, {
        childDefinitionId: 'writer',
        taskId: writerTaskId,
        dispatchId
      })
    })
  }
  try {
    expect((await tool.call('worker_done', args)).isError).toBe(false)
    expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    const replay = await tool.call('worker_done', args)
    expect(JSON.parse(replay.content[0].text)).toMatchObject({
      ok: true,
      result: { mutation: { requestId: args.requestId, replayed: true } }
    })
    const changed = await tool.call('worker_done', { ...args, body: 'Different report' })
    expect(changed.isError).toBe(true)
    expect(JSON.parse(changed.content[0].text)).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
    session.revoke()
    const stale = await tool.call('worker_done', args)
    expect(stale.isError).toBe(true)
    expect(JSON.parse(stale.content[0].text)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    expect(native.spawn).toHaveBeenCalledTimes(1)
  } finally {
    tool.revoke()
    session.revoke()
  }
})

it.each(['admission', 'host-stopped', 'owner'])(
  'refuses a new report after %s revocation, including a revocation at dispatch entry',
  async (change) => {
    let active = true
    const f = await setupNativeStubAttempt({ kind: 'provider', isActive: () => active })
    const { run, writerTaskId } = await createNativeRun(
      f,
      undefined,
      30,
      {},
      {
        agentId: 'muse',
        model: 'frozen-model',
        reasoningEffort: 'high'
      }
    )
    const dispatchId = await dispatchWriter(f, run.id)
    const terminal = f.createdTerminals.at(-1)!
    const identity = {
      runtimeId: f.runtime.getRuntimeId(),
      sourceId: 'b7ac5d7e-9e4a-40d4-a310-88baecf1c2cd',
      runId: run.orchestrationRunId!,
      taskId: writerTaskId,
      dispatchId,
      terminalHandle: terminal.handle,
      paneKey: terminal.paneKey!,
      launchToken: terminal.launchToken!,
      consumerGeneration: f.db.getDispatchContextById(dispatchId)!.consumer_generation
    }
    const session = createCoordinatedNativeReportSession({
      runtime: f.runtime,
      identity,
      authToken: 'revocation-test',
      pendingLaunch: f.providerPermits.at(-1)!
    })
    const tool = createCoordinatedNativeReportTool({
      identity,
      authToken: 'revocation-test',
      exchange: (request) => session.handle(JSON.stringify(request))
    })
    const original = RpcDispatcher.prototype.dispatch
    vi.spyOn(RpcDispatcher.prototype, 'dispatch').mockImplementationOnce(function (
      this: RpcDispatcher,
      request,
      context
    ) {
      if (change === 'admission') {
        f.host.revoke()
      } else if (change === 'host-stopped') {
        active = false
      } else {
        vi.spyOn(f.store, 'listAutomations').mockReturnValue([])
      }
      return original.call(this, request, context)
    })
    const result = await tool.call('worker_done', {
      requestId: 'revoked-result',
      subject: 'Must not settle',
      body: 'Synthetic fixture',
      payload: JSON.stringify({
        taskId: writerTaskId,
        dispatchId,
        outcome: 'succeeded',
        structuredResult: structuredReport(run, {
          childDefinitionId: 'writer',
          taskId: writerTaskId,
          dispatchId
        })
      })
    })
    expect(result).toMatchObject({ isError: true })
    expect(f.db.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    expect(f.db.getTask(writerTaskId)?.result).toBeFalsy()
    expect(() => session.assertCurrent()).toThrow()
  }
)
