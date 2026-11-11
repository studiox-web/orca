import { publishHostDescriptor } from './host-descriptor'
import { createRuntimeTransportMetadata } from './runtime-rpc/runtime-rpc-socket-metadata'
import './rpc/unused-default-rpc-methods.test-fixture'
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runNativeStubBundle } from './native-stub-bundle-vm.test-support'
import {
  child,
  coordinatedCreateInput
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  buildNativeStubCompletionReport,
  NATIVE_STUB_BRIEF_ECHO_CHECK
} from '../../shared/native-stub-fixture-report'
import {
  formatCoordinatedReportContract,
  parseCoordinatedReportContract
} from '../../shared/coordinated-automation-report-contract'
import { nativeAttemptSettlementProblem } from '../automations/coordinated-automation-native-attempt'
import {
  installNativeStubAttemptHooks,
  setStubPtyBehavior,
  setStubEntry,
  nativeStubAttemptRoot,
  setupNativeStubAttempt as setup,
  type NativeStubAttemptFixture
} from './coordinated-native-stub-attempt.test-support'
import { createNativeRun } from './coordinated-native-stub-run.test-support'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

installNativeStubAttemptHooks(native.spawn)

function createEchoRun(f: NativeStubAttemptFixture) {
  return createNativeRun(f, [child('writer')], 30, {
    outcomeContract: {
      ...coordinatedCreateInput().outcomeContract!,
      acceptanceCriteria: [
        {
          id: NATIVE_STUB_BRIEF_ECHO_CHECK,
          description: 'Brief echoed',
          required: true,
          kind: 'custom'
        }
      ]
    }
  })
}

function letStubReport(
  f: NativeStubAttemptFixture,
  options: {
    env?: (env: Record<string, string>) => Record<string, string>
    loseAck?: boolean
    afterProbe?: () => void
    foreignEndpoint?: boolean
  } = {}
) {
  writeFileSync(
    join(nativeStubAttemptRoot(), 'orca-runtime.json'),
    JSON.stringify({
      runtimeId: f.runtime.getRuntimeId(),
      pid: process.pid,
      authToken: 'test',
      transports: [
        options.foreignEndpoint
          ? { kind: 'named-pipe', endpoint: '\\\\foreign\\pipe\\orca' }
          : createRuntimeTransportMetadata(
              nativeStubAttemptRoot(),
              process.pid,
              process.platform,
              f.runtime.getRuntimeId()
            )
      ]
    })
  )
  let entry: ReturnType<typeof runNativeStubBundle> | undefined
  setStubEntry((process, file, env) => {
    process.onData.mockImplementation((listener) => {
      queueMicrotask(() => {
        entry = runNativeStubBundle({
          file,
          env: options.env?.(env) ?? env,
          output: listener,
          dispatch: async (request) => {
            const response = await f.dispatcher.dispatch(request)
            if (request.method === 'status.get') {
              options.afterProbe?.()
            }
            return options.loseAck && request.method === 'orchestration.send' ? null : response
          }
        })
      })
      return { dispose() {} }
    })
    process.write.mockImplementation((bytes: string) => {
      entry!.stdin.emit('data', bytes)
    })
  })
  return () => entry!
}

it('executes the admitted bundle entry from its own stdin through existing transport and authenticated ingress', async () => {
  const f = await setup()
  const entry = letStubReport(f)
  const { run, writerTaskId } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_REPORTED'))
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const terminal = f.createdTerminals.at(-1)!
  const writes = entry().requests.filter((r) => r.method === 'orchestration.send')
  expect(writes).toHaveLength(1)
  expect(writes[0].expectedRuntimeSource).toEqual({
    sourceId: 'b7ac5d7e-9e4a-40d4-a310-88baecf1c2cd',
    runtimeId: f.runtime.getRuntimeId()
  })
  expect(entry().output()).not.toContain(terminal.launchToken)
  expect(JSON.stringify(writes[0].params)).not.toContain(terminal.launchToken)
  expect(JSON.stringify(native.spawn.mock.calls[0].slice(0, 2))).not.toContain(terminal.launchToken)
  expect(f.db.getDispatchContextById(dispatchId)!.status).toBe('completed')
  expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({ state: 'succeeded', stage: 'settled' })
  const current = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(nativeAttemptSettlementProblem(f.db, current, dispatchId)).toBeNull()
  expect((await f.adapter.reconcileRun(run.id)).state).toBe('completed')
  entry().stdin.emit('data', 'duplicate\r')
  expect(entry().requests.filter((r) => r.method === 'orchestration.send')).toHaveLength(1)
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each([
  [
    'bad launch token',
    (env: Record<string, string>) => ({ ...env, ORCA_AGENT_LAUNCH_TOKEN: 'not-minted' })
  ],
  ['missing root', (env: Record<string, string>) => ({ ...env, ORCA_USER_DATA_PATH: '' })],
  ['foreign root', (env: Record<string, string>) => ({ ...env, ORCA_USER_DATA_PATH: env.HOME })],
  ['missing source', (env: Record<string, string>) => ({ ...env, ORCA_RUNTIME_SOURCE_ID: '' })],
  [
    'foreign source',
    (env: Record<string, string>) => ({ ...env, ORCA_RUNTIME_SOURCE_ID: 'foreign' })
  ],
  [
    'changed incarnation',
    (env: Record<string, string>) => ({ ...env, ORCA_RUNTIME_SOURCE_INCARNATION: 'restarted' })
  ],
  [
    'missing launch identity',
    (env: Record<string, string>) => ({ ...env, ORCA_AGENT_LAUNCH_TOKEN: '' })
  ]
])('refuses %s without accepting a report', async (_name, env) => {
  const f = await setup()
  const entry = letStubReport(f, { env })
  const { run, writerTaskId } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_REFUSED'))
  expect(f.db.getDispatchContext(writerTaskId)!.status).not.toBe('completed')
  expect((await f.adapter.reconcileRun(run.id)).state).toBe('outcome_uncertain')
  expect(entry().output()).not.toContain(f.createdTerminals.at(-1)!.launchToken)
})

it('refuses foreign transport metadata before opening a connection', async () => {
  const f = await setup()
  const entry = letStubReport(f, { foreignEndpoint: true })
  const { run, writerTaskId } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_REFUSED'))
  expect(entry().requests).toHaveLength(0)
  expect(f.db.getDispatchContext(writerTaskId)!.status).not.toBe('completed')
})

it('does not claim arbitrary acceptance checks just because the stub did no work', async () => {
  const f = await setup()
  const entry = letStubReport(f)
  const { run, writerTaskId } = await createNativeRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_REFUSED'))
  expect(entry().requests).toHaveLength(0)
  expect(f.db.getDispatchContext(writerTaskId)!.status).not.toBe('completed')
})

it('keeps a lost report acknowledgement unknown without another mutation or process', async () => {
  const f = await setup()
  const entry = letStubReport(f, { loseAck: true })
  const { run, writerTaskId } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_UNKNOWN'))
  entry().stdin.emit('data', 'duplicate\r')
  expect(entry().requests.filter((r) => r.method === 'orchestration.send')).toHaveLength(1)
  expect(f.db.getDispatchContext(writerTaskId)!.status).toBe('completed')
  expect((await f.adapter.reconcileRun(run.id)).state).toBe('completed')
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('refuses a different host source appearing after the socket probe', async () => {
  const f = await setup()
  const entry = letStubReport(f, {
    afterProbe: () =>
      publishHostDescriptor(f.runtime.getRuntimeId(), {
        installationId: 'a32aad34-d115-4072-8713-284cfdd91910'
      })
  })
  const { run, writerTaskId } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(entry().output()).toContain('GOLDEN_STUB_REPORT_REFUSED'))
  expect(f.db.getDispatchContext(writerTaskId)!.status).not.toBe('completed')
})

it('waits for the complete pasted submission before reporting', async () => {
  const f = await setup()
  const connect = letStubReport(f)
  const { run } = await createEchoRun(f)
  await f.adapter.reconcileRun(run.id)
  await vi.waitFor(() => expect(connect().output()).toContain('GOLDEN_STUB_REPORT_REPORTED'))
  const [_, args, options] = native.spawn.mock.calls[0]
  const entry = runNativeStubBundle({
    file: args[0],
    env: options.env,
    dispatch: (request) => f.dispatcher.dispatch(request)
  })
  entry.stdin.emit('data', '\x1b[200~partial\nbrief')
  expect(entry.requests).toHaveLength(0)
  entry.stdin.emit('data', '\x1b[201~')
  expect(entry.requests).toHaveLength(0)
  entry.stdin.emit('data', '\r')
  expect(entry.output()).toContain('[GOLDEN_STUB_AGENT_SUBMITTED] partial\nbrief')
  expect(entry.output()).toContain('GOLDEN_STUB_REPORT_REFUSED')
  expect(entry.requests).toHaveLength(0)
})

it('keeps a ready stub that never echoes its submission start-unknown within the frozen launch budget', async () => {
  const f = await setup()
  setStubPtyBehavior('never_submits')
  const { run, writerTaskId } = await createNativeRun(f, undefined, 3)
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  try {
    const pending = f.adapter.reconcileRun(run.id)
    await vi.waitFor(() => expect(native.spawn.mock.results[0]?.value.write).toHaveBeenCalled(), {
      interval: 1
    })
    await vi.advanceTimersByTimeAsync(3_000)
    const first = await pending
    expect(first.state).toBe('outcome_uncertain')
  } finally {
    vi.useRealTimers()
  }
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const process = native.spawn.mock.results[0].value
  // Readiness was proven and the brief was written; only the turn start is unproven.
  expect(process.write).toHaveBeenCalled()
  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(['ready', 'succeeded', 'failed']).not.toContain(worker.state)
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })

  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(again.run.completionReceipt ?? null).toBeNull()
})

it('reads a report contract back only when the brief still carries it unaltered', () => {
  const contract = {
    schemaVersion: 1 as const,
    automationRunId: 'run',
    orchestrationRunId: 'orch',
    childDefinitionId: 'writer',
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    definitionRevision: 2,
    resolvedConfigDigest: `sha256:${'a'.repeat(64)}`,
    requiredCheckIds: ['draft-ready']
  }
  const brief = `Do the work.\n\n${formatCoordinatedReportContract(contract)}`
  expect(parseCoordinatedReportContract(brief)).toEqual(contract)
  expect(parseCoordinatedReportContract('Do the work.')).toBeNull()
  expect(
    parseCoordinatedReportContract(brief.replace('"definitionRevision":2', '"x":2'))
  ).toBeNull()
  expect(buildNativeStubCompletionReport({ brief: 'no contract here', env: {} })).toEqual({
    kind: 'refused',
    reason: 'brief_has_no_report_contract'
  })
})
