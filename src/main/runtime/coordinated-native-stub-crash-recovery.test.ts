import './rpc/unused-default-rpc-methods.test-fixture'
// Crash, lost-acknowledgement and revocation boundaries of a coordinated native stub attempt.
// Every case must retain the exact identities it already created and never spawn again.

import { expect, it, vi } from 'vitest'
import { CoordinatedAutomationAdapter } from '../automations/coordinated-automation-adapter'
import {
  installNativeStubAttemptHooks,
  setupNativeStubAttempt as setup
} from './coordinated-native-stub-attempt.test-support'
import {
  createNativeRun,
  dispatchWriter,
  evidenceFor,
  operatorScope,
  sendWorkerDone,
  structuredReport
} from './coordinated-native-stub-run.test-support'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

installNativeStubAttemptHooks(native.spawn)

it('holds a Dispatch that crashed after its mapping was persisted but before launch, without ever spawning', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  let crashed = false
  const crashing = new CoordinatedAutomationAdapter({
    store: f.store,
    orchestrationDb: f.db,
    nativeStubWorker: f.nativeStubWorker,
    durableBoundary: (boundary) => {
      if (boundary === 'dispatch.after-mapping' && !crashed) {
        crashed = true
        throw new Error('Simulated crash after mapping persistence')
      }
    }
  })
  await expect(crashing.reconcileRun(run.id)).rejects.toThrow(/Simulated crash/)
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const mapped = () =>
    f.store
      .listAutomationRuns()
      .find((r) => r.id === run.id)!
      .childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId
  expect(mapped()).toBe(dispatchId)
  expect(native.spawn).not.toHaveBeenCalled()

  // A replacement coordinator generation cannot prove the launch never began, so it holds.
  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('outcome_uncertain')
  expect(outcome.reason).toContain(dispatchId)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(mapped()).toBe(dispatchId)
  expect(native.spawn).not.toHaveBeenCalled()
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toBeFalsy()
  expect(outcome.run.completionReceipt ?? null).toBeNull()
})

it('retains exact custody when the terminal-create acknowledgement is lost after physical spawn', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const create = f.runtime.createTerminal.bind(f.runtime)
  vi.mocked(f.runtime.createTerminal).mockImplementationOnce(async (selector, options) => {
    await create(selector, options)
    throw new Error('Simulated lost create acknowledgement')
  })

  const first = await f.adapter.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(native.spawn).toHaveBeenCalledTimes(1)
  // The physical observer recorded custody before the acknowledgement could be lost.
  const custody = f.db.getWorkerTerminalResourceByOwner(dispatchId)
  expect(custody).toMatchObject({ ownership_state: 'owned' })
  expect(custody?.terminal_handle).toBe(f.createdTerminals.at(-1)!.handle)
  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(['ready', 'succeeded']).not.toContain(worker.state)

  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
})

it('fences every later write when the host is revoked across the launch await, keeping custody', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const create = f.runtime.createTerminal.bind(f.runtime)
  vi.mocked(f.runtime.createTerminal).mockImplementationOnce(async (selector, options) => {
    const created = await create(selector, options)
    f.host.revoke()
    return created
  })

  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/host stopped/i)
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })
  // Nothing was typed into the stub and no readiness was claimed after revocation.
  expect(native.spawn.mock.results[0].value.write).not.toHaveBeenCalled()
  expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')

  const sequence = f.adapter.inspectProgress(run.id)!.sequence
  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/host stopped/i)
  await expect(f.adapter.stopRun(operatorScope(run))).rejects.toThrow(/host stopped/i)
  expect(f.adapter.inspectProgress(run.id)!.sequence).toBe(sequence)
  expect(f.adapter.inspectProgress(run.id)!.operatorStop ?? null).toBeNull()
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('keeps the parent undeletable and unarchivable while its native attempt is unsettled', async () => {
  const f = await setup()
  const { run, automation, writerTaskId } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)
  const terminal = f.createdTerminals.at(-1)!

  // The owner scope a live attempt depends on cannot be pulled out from under it.
  expect(() => f.store.deleteAutomation(automation.id)).toThrow(/keep their run history/)
  expect(() =>
    f.store.archiveCoordinatedAutomation({
      automationId: automation.id,
      expectedOwner: { selector: { kind: 'self' } }
    })
  ).toThrow(/have not settled/)
  expect(f.store.listAutomations().some((a) => a.id === automation.id)).toBe(true)

  const sent = await sendWorkerDone(f, {
    handle: terminal.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(run, {
      childDefinitionId: 'writer',
      taskId: writerTaskId,
      dispatchId
    }),
    evidence: evidenceFor(terminal)
  })
  expect(sent.ok).toBe(true)
  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('completed')
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each(['consumer-generation', 'runtime-epoch'])(
  'refuses a fully authenticated report when the durable %s no longer matches the binding',
  async (tamper) => {
    const f = await setup()
    const { run, writerTaskId } = await createNativeRun(f)
    const dispatchId = await dispatchWriter(f, run.id)
    const terminal = f.createdTerminals.at(-1)!
    if (tamper === 'consumer-generation') {
      f.db.db
        .prepare('UPDATE dispatch_contexts SET consumer_generation = 2 WHERE id = ?')
        .run(dispatchId)
    } else {
      f.db.db
        .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
        .run('another-runtime-generation', dispatchId)
    }
    const sent = await sendWorkerDone(f, {
      handle: terminal.handle,
      dispatchId,
      taskId: writerTaskId,
      outcome: 'succeeded',
      structuredResult: structuredReport(run, {
        childDefinitionId: 'writer',
        taskId: writerTaskId,
        dispatchId
      }),
      evidence: evidenceFor(terminal)
    })
    expect(sent.ok).toBe(false)
    expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('succeeded')
    const outcome = await f.adapter.reconcileRun(run.id)
    expect(outcome.state).toBe('outcome_uncertain')
    expect(outcome.run.completionReceipt ?? null).toBeNull()
    expect(native.spawn).toHaveBeenCalledTimes(1)
  }
)
