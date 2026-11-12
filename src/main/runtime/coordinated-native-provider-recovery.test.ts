import './rpc/unused-default-rpc-methods.test-fixture'
// Provider failure fencing runs through the real composed attempt path with controlled PTYs.

import { expect, it, vi } from 'vitest'
import { CoordinatedAutomationAdapter } from '../automations/coordinated-automation-adapter'
import { child } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  installNativeStubAttemptHooks,
  nativeStubAttemptRoot,
  setupNativeStubAttempt as setup
} from './coordinated-native-stub-attempt.test-support'
import {
  createNativeRun,
  dispatchWriter,
  operatorScope
} from './coordinated-native-stub-run.test-support'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

installNativeStubAttemptHooks(native.spawn)

const FROZEN_LAUNCH = {
  agentId: 'muse',
  model: 'frozen-model',
  reasoningEffort: 'high'
} as const

it('refuses an unsupported host before allocating a Dispatch or spawning', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  Object.defineProperty(f.runtime, 'servesHeadlessGraph', { value: true })

  await expect(f.adapter.dispatchTask(run.id, writerTaskId)).rejects.toThrow(
    /host_not_local_desktop/
  )
  expect(f.db.getDispatchContext(writerTaskId)).toBeUndefined()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('retains exact provider custody when the terminal-create acknowledgement is lost', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const create = f.runtime.createTerminal.bind(f.runtime)
  vi.mocked(f.runtime.createTerminal).mockImplementationOnce(async (selector, options) => {
    await create(selector, options)
    throw new Error('Simulated lost provider create acknowledgement')
  })

  const first = await f.adapter.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned',
    terminal_handle: expect.any(String)
  })
  expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')
  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each(['revoked', 'generation', 'profile', 'owner'])(
  'fences a provider launch when %s authority changes across the terminal-create await',
  async (change) => {
    const f = await setup({ kind: 'provider' })
    const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
    const create = f.runtime.createTerminal.bind(f.runtime)
    vi.mocked(f.runtime.createTerminal).mockImplementationOnce(async (selector, options) => {
      const created = await create(selector, options)
      if (change === 'revoked') {
        f.host.revoke()
      } else if (change === 'generation') {
        Object.defineProperty(f.runtime, 'runtimeId', { value: 'stale-provider-generation' })
      } else if (change === 'profile') {
        vi.spyOn(f.store, 'getProfileStorageDirectory').mockReturnValue(f.home)
      } else {
        vi.spyOn(f.store, 'listAutomations').mockReturnValue([])
      }
      return created
    })

    const reconcile = f.adapter.reconcileRun(run.id)
    await (change === 'owner'
      ? expect(reconcile).resolves.toMatchObject({ state: 'outcome_uncertain' })
      : expect(reconcile).rejects.toThrow(/host stopped/i))
    const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
    expect(native.spawn).toHaveBeenCalledTimes(1)
    expect(native.spawn.mock.results[0].value.write).not.toHaveBeenCalled()
    expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')
    expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
      ownership_state: 'owned'
    })
  }
)

it('retains a provider attempt without its host and refuses a fresh fake fallback', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(
    f,
    [child('writer'), child('reviewer')],
    30,
    {},
    FROZEN_LAUNCH
  )
  const reviewerTaskId = run.childMappings!.find(
    (mapping) => mapping.childDefinitionId === 'reviewer'
  )!.taskId
  const launched = await f.adapter.dispatchTask(run.id, writerTaskId)
  const plain = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })

  await expect(plain.dispatchTask(run.id, writerTaskId)).resolves.toMatchObject({
    dispatchId: launched.dispatchId,
    outcome: 'native_retained'
  })
  await expect(plain.dispatchTask(run.id, reviewerTaskId)).rejects.toThrow(
    /without the same native host/
  )
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(reviewerTaskId)).toBeUndefined()
})

it('stops a provider attempt only through its admitted runtime and proven exit', async () => {
  const f = await setup({ kind: 'provider' })
  const { run } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const dispatchId = await dispatchWriter(f, run.id)

  const stopped = await f.adapter.stopRun(operatorScope(run))
  expect(stopped.state).toBe('failed')
  expect(stopped.reason).toContain('Operator stop requested')
  expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({ state: 'stopped' })
  expect(native.spawn).toHaveBeenCalledTimes(1)
  const replay = await f.adapter.stopRun(operatorScope(run))
  expect(replay.disposition).toBe('already_recorded')
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each(['revoked', 'generation', 'profile', 'owner', 'owner-transfer', 'workspace'])(
  'refuses physical dispatch when %s changes while provider environment preparation awaits',
  async (change) => {
    const f = await setup({ kind: 'provider' })
    const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
    f.buildSpawnEnv.mockImplementationOnce(async (_id, env) => {
      await Promise.resolve()
      if (change === 'revoked') {
        f.host.revoke()
      } else if (change === 'generation') {
        Object.defineProperty(f.runtime, 'runtimeId', { value: 'replacement' })
      } else if (change === 'profile') {
        vi.spyOn(f.store, 'getProfileStorageDirectory').mockReturnValue(f.home)
      } else if (change === 'owner') {
        vi.spyOn(f.store, 'listAutomations').mockReturnValue([])
      } else if (change === 'owner-transfer') {
        vi.spyOn(f.store, 'automationOwnerPrecondition').mockReturnValue({
          selector: { kind: 'ssh', targetId: 'transferred', targetGeneration: 1 }
        })
      } else {
        const folder = f.store.getFolderWorkspace(f.workspaceId.slice('folder:'.length))!
        vi.spyOn(f.store, 'getFolderWorkspace').mockReturnValue({ ...folder, folderPath: f.home })
      }
      return env
    })
    const result = f.adapter.reconcileRun(run.id)
    await (['owner', 'owner-transfer', 'workspace'].includes(change)
      ? expect(result).resolves.toMatchObject({ state: 'outcome_uncertain' })
      : expect(result).rejects.toThrow(/host stopped/i))
    expect(f.buildSpawnEnv).toHaveBeenCalledTimes(1)
    expect(native.spawn).not.toHaveBeenCalled()
    const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
    expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toBeFalsy()
    expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')
  }
)

it('retains physical custody if authority is revoked at the spawn acknowledgement boundary', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const spawn = native.spawn.getMockImplementation()!
  native.spawn.mockImplementationOnce((...args) => {
    const process = spawn(...args)
    f.host.revoke()
    return process
  })
  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/host stopped/i)
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })
  const replacement = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })
  await expect(replacement.reconcileRun(run.id)).resolves.toMatchObject({
    state: 'outcome_uncertain'
  })
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('reopens a provider attempt on a fresh runtime without rebinding or launching a replacement', async () => {
  const first = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(first, undefined, 30, {}, FROZEN_LAUNCH)
  const dispatchId = await dispatchWriter(first, run.id)
  await first.store.flushPendingOrThrowAsync()
  const second = await setup({
    kind: 'provider',
    rootDir: nativeStubAttemptRoot(),
    homeDir: first.home,
    workspaceDir: first.workspace
  })
  await expect(second.adapter.reconcileRun(run.id)).resolves.toMatchObject({
    state: 'outcome_uncertain'
  })
  expect(second.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(second.db.getWorkerDispatch(dispatchId)!.runtime_epoch).toBe(first.runtime.getRuntimeId())
  expect(second.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('never treats a malformed native binding as permission for fake recovery', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const dispatchId = await dispatchWriter(f, run.id)
  const row = f.db.getWorkerDispatch(dispatchId)!
  const options = JSON.parse(row.start_options!)
  options.coordinatedNativeProvider.version = 999
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify(options), dispatchId)
  const replacement = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })
  await expect(replacement.dispatchTask(run.id, writerTaskId)).rejects.toThrow(
    /identity is incomplete/
  )
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each(['ssh', 'remote', 'archived'])(
  'reads %s workspace refusal from Store before allocating a Dispatch',
  async (kind) => {
    const f = await setup({ kind: 'provider' })
    const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
    const folder = f.store.getFolderWorkspace(f.workspaceId.slice('folder:'.length))!
    vi.spyOn(f.store, 'getFolderWorkspace').mockReturnValue({
      ...folder,
      ...(kind === 'ssh' ? { connectionId: 'foreign-ssh' } : {}),
      ...(kind === 'remote' ? { executionHostId: 'runtime:foreign' } : {}),
      ...(kind === 'archived' ? { isArchived: true } : {})
    })
    await expect(f.adapter.dispatchTask(run.id, writerTaskId)).rejects.toThrow(
      /workspace_(not_local|unresolved)/
    )
    expect(f.db.getDispatchContext(writerTaskId)).toBeUndefined()
    expect(native.spawn).not.toHaveBeenCalled()
  }
)

it('refuses a forged worker capability before allocating a Dispatch', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const forged = new CoordinatedAutomationAdapter({
    store: f.store,
    orchestrationDb: f.db,
    nativeProviderWorker: { kind: 'native_provider_worker' }
  })
  await expect(forged.dispatchTask(run.id, writerTaskId)).rejects.toThrow(
    /host stopped|host_refused/i
  )
  expect(f.db.getDispatchContext(writerTaskId)).toBeUndefined()
  expect(native.spawn).not.toHaveBeenCalled()
})
