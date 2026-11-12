import './rpc/unused-default-rpc-methods.test-fixture'
import { expect, it, vi } from 'vitest'
import { child } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { defaultCoordinatedProgressStore } from '../automations/coordinated-automation-dispatcher'
import { inspectCoordinatedRun } from '../automations/coordinated-automation-run-inspection'
import {
  createUnavailableCoordinatedRunHost,
  type CoordinatedAutomationRunHost
} from '../automations/coordinated-automation-run-host-types'
import {
  installNativeStubAttemptHooks,
  setupNativeStubAttempt
} from './coordinated-native-stub-attempt.test-support'
import {
  createNativeRun,
  evidenceFor,
  sendWorkerDone,
  structuredReport
} from './coordinated-native-stub-run.test-support'
import { RuntimeCoordinatedRunController } from './runtime-coordinated-run-controller'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
installNativeStubAttemptHooks(native.spawn)

it('advances native children from committed mail and fences duplicate or revoked wakeups', async () => {
  const f = await setupNativeStubAttempt({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(
    f,
    [
      child('writer'),
      child('reviewer', { dependencies: [{ childId: 'writer', condition: 'accepted' }] })
    ],
    30,
    {},
    { agentId: 'muse', model: 'frozen-model', reasoningEffort: 'high' }
  )
  const progressStore = defaultCoordinatedProgressStore()
  const inspect = () =>
    inspectCoordinatedRun({
      run: f.store.listAutomationRuns().find((entry) => entry.id === run.id)!,
      orchestrationDb: f.db,
      progressStore
    })
  const host: CoordinatedAutomationRunHost = {
    ...createUnavailableCoordinatedRunHost('Only reconciliation is exposed in this fixture'),
    executionKind: 'native',
    availability: { available: true, state: 'running' },
    inspectRun: inspect,
    reconcileRun: async (request) => {
      const result = await f.adapter.reconcileRun(request.automationRunId)
      return {
        automationRunId: run.id,
        state: result.state,
        reason: result.reason,
        inspection: inspect()
      }
    }
  }
  let admitted = true
  const controller = new RuntimeCoordinatedRunController(
    f.store,
    () => admitted,
    () => host
  )
  vi.spyOn(f.runtime, 'notifyMessageArrived').mockImplementation((mailbox, type) => {
    controller.notifyWorkerCompletion(mailbox, type, f.runtime.getRuntimeId())
  })
  await f.adapter.reconcileRun(run.id)
  const firstDispatch = f.db.getDispatchContext(writerTaskId)!.id
  const reviewerTaskId = run.childMappings!.find(
    (mapping) => mapping.childDefinitionId === 'reviewer'
  )!.taskId
  const mailbox = `run:${run.orchestrationRunId}`
  controller.notifyWorkerCompletion('run:foreign', 'worker_done', f.runtime.getRuntimeId())
  controller.notifyWorkerCompletion(mailbox, 'heartbeat', f.runtime.getRuntimeId())
  expect(f.db.getDispatchContext(reviewerTaskId)).toBeUndefined()
  admitted = false
  const writer = f.createdTerminals[0]
  expect(
    await sendWorkerDone(f, {
      handle: writer.handle,
      taskId: writerTaskId,
      dispatchId: firstDispatch,
      outcome: 'succeeded',
      structuredResult: structuredReport(run, {
        childDefinitionId: 'writer',
        taskId: writerTaskId,
        dispatchId: firstDispatch
      }),
      evidence: evidenceFor(writer)
    })
  ).toMatchObject({ ok: true })
  expect(f.db.getWorkerDispatch(firstDispatch)?.state).toBe('succeeded')
  expect(f.db.getDispatchContext(reviewerTaskId)).toBeUndefined()
  admitted = true
  for (let nudge = 0; nudge < 3; nudge++) {
    controller.notifyWorkerCompletion(mailbox, 'worker_done', f.runtime.getRuntimeId())
  }
  await vi.waitFor(() => expect(f.createdTerminals).toHaveLength(2))
  const reviewer = f.createdTerminals[1]
  const reviewDispatch = f.db.getDispatchContext(reviewerTaskId)!.id
  await vi.waitFor(() => expect(f.db.getWorkerDispatch(reviewDispatch)?.state).toBe('ready'), {
    timeout: 10_000
  })
  expect(
    await sendWorkerDone(f, {
      handle: reviewer.handle,
      taskId: reviewerTaskId,
      dispatchId: reviewDispatch,
      outcome: 'succeeded',
      structuredResult: structuredReport(run, {
        childDefinitionId: 'reviewer',
        taskId: reviewerTaskId,
        dispatchId: reviewDispatch
      }),
      evidence: evidenceFor(reviewer)
    })
  ).toMatchObject({ ok: true })
  await vi.waitFor(() =>
    expect(
      f.store.listAutomationRuns().find((entry) => entry.id === run.id)?.completionReceipt
    ).toBeTruthy()
  )
  controller.notifyWorkerCompletion(mailbox, 'worker_done', f.runtime.getRuntimeId())
  expect(native.spawn).toHaveBeenCalledTimes(2)
  expect(f.db.getDispatchContext(writerTaskId)?.id).toBe(firstDispatch)
  expect(f.db.getDispatchContext(reviewerTaskId)?.id).toBe(reviewDispatch)
})
