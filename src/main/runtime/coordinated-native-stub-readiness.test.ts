import './rpc/unused-default-rpc-methods.test-fixture'
// The pinned stub's own readiness protocol over the real launch path: no runtime readiness,
// foreground or prompt-writer effect is mocked here; only the PTY bytes are emulated.

import { expect, it, vi } from 'vitest'
import {
  installNativeStubAttemptHooks,
  setStubPtyBehavior,
  setupNativeStubAttempt as setup
} from './coordinated-native-stub-attempt.test-support'
import { createNativeRun, dispatchWriter } from './coordinated-native-stub-run.test-support'
import { NATIVE_STUB_READY_MARKER } from './native-stub-fixture-protocol'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

installNativeStubAttemptHooks(native.spawn)

it('admits the stub on its own markers and delivers the brief through the real prompt writer', async () => {
  const f = await setup()
  const codexReadiness = vi.spyOn(f.runtime, 'waitForFreshWorkerComposer')
  const codexForeground = vi.spyOn(f.runtime, 'readLaunchedAgentForeground')
  const { run, writerTaskId } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)

  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(worker.state).toBe('ready')
  expect(worker.effects).toContain('"state":"accepted"')
  // The brief reached the stub's own PTY, naming this exact Task and Dispatch.
  const written = native.spawn.mock.results
    .at(-1)!
    .value.write.mock.calls.map(([data]: [string]) => data)
    .join('')
  expect(written).toContain(writerTaskId)
  expect(written).toContain(dispatchId)
  // Codex readiness and Codex foreground proof were never consulted for the stub.
  expect(codexReadiness).not.toHaveBeenCalled()
  expect(codexForeground).not.toHaveBeenCalled()
  expect(NATIVE_STUB_READY_MARKER).toBe('[GOLDEN_STUB_AGENT_READY]')
})

it('never claims ready for a stub that does not draw its marker; the attempt stays uncertain', async () => {
  const f = await setup()
  setStubPtyBehavior('never_ready')
  const { run, writerTaskId } = await createNativeRun(f, undefined, 2)
  const first = await f.adapter.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id

  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(worker.state).not.toBe('ready')
  expect(worker.state).not.toBe('succeeded')
  // Nothing was typed into a process that never proved itself ready.
  expect(native.spawn.mock.results.at(-1)!.value.write).not.toHaveBeenCalled()
  // The physical process was spawned once; custody is retained and nothing respawns.
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toBeTruthy()
  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(again.run.completionReceipt ?? null).toBeNull()
})
