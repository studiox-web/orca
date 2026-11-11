import './rpc/unused-default-rpc-methods.test-fixture'
// Normal-provider attempts use the real worker-start and authenticated report paths. Only PTY
// bytes and OS foreground facts are controlled; no provider binary or physical process runs.

import { expect, it, vi } from 'vitest'
import { child } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  installNativeStubAttemptHooks,
  setProviderPtyBehavior,
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

const FROZEN_LAUNCH = {
  agentId: 'muse',
  model: 'frozen-model',
  reasoningEffort: 'high'
} as const

it('launches one frozen provider attempt and completes from its authenticated worker_done', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const dispatchId = await dispatchWriter(f, run.id)

  expect(native.spawn).toHaveBeenCalledTimes(1)
  const dispatch = f.db.getDispatchContextById(dispatchId)!
  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(dispatch).toMatchObject({
    id: dispatchId,
    task_id: writerTaskId,
    run_id: run.orchestrationRunId,
    creator_handle: null,
    status: 'dispatched',
    consumer_generation: 1
  })
  expect(worker).toMatchObject({ state: 'ready', runtime_epoch: f.runtime.getRuntimeId() })
  expect(JSON.parse(worker.start_options!)).toMatchObject({
    agent: 'muse',
    model: 'frozen-model',
    reasoningEffort: 'high',
    surface: 'terminal',
    workspaceId: f.workspaceId,
    mode: { mode: 'terminal' },
    launch: {
      requested: { agent: 'muse', model: 'frozen-model', effort: 'high' },
      effective: { agent: 'muse', model: 'frozen-model', effort: 'high' }
    }
  })
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned',
    terminal_handle: dispatch.assignee_handle
  })
  const terminal = f.createdTerminals.find((entry) => entry.handle === dispatch.assignee_handle)!
  const written = native.spawn.mock.results[0].value.write.mock.calls
    .map(([data]: [string]) => data)
    .join('')
  expect(written).toContain(writerTaskId)
  expect(written).toContain(dispatchId)
  expect(written).toContain(`run:${run.orchestrationRunId}`)
  expect(written).toContain(run.resolvedSnapshot!.canonicalDigest)

  const current = f.store.listAutomationRuns().find((entry) => entry.id === run.id)!
  const sent = await sendWorkerDone(f, {
    handle: terminal.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(current, {
      childDefinitionId: 'writer',
      taskId: writerTaskId,
      dispatchId
    }),
    evidence: evidenceFor(terminal)
  })
  expect(sent.ok).toBe(true)
  expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({ state: 'succeeded', stage: 'settled' })
  const completed = await f.adapter.reconcileRun(run.id)
  expect(completed.state).toBe('completed')
  expect(completed.run.completionReceipt).toBeTruthy()
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('serializes concurrent reconciliation to one exact starting Dispatch and one PTY', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
  const [first, second] = await Promise.all([
    f.adapter.dispatchTask(run.id, writerTaskId),
    f.adapter.dispatchTask(run.id, writerTaskId)
  ])

  expect(first.dispatchId).toBe(second.dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.listTasks({ runId: run.orchestrationRunId! })).toHaveLength(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(first.dispatchId)
  expect(f.db.getWorkerDispatch(first.dispatchId)!.state).toBe('ready')
})

it.each(['missing', 'forged-token', 'wrong-pane', 'wrong-attempt'])(
  'refuses a provider worker_done with %s proof without settling the attempt',
  async (tamper) => {
    const f = await setup({ kind: 'provider' })
    const { run, writerTaskId } = await createNativeRun(f, undefined, 30, {}, FROZEN_LAUNCH)
    const dispatchId = await dispatchWriter(f, run.id)
    const terminal = f.createdTerminals.at(-1)!
    const evidence = evidenceFor(terminal)
    const tampered =
      tamper === 'forged-token'
        ? { ...evidence, launchToken: 'forged-token' }
        : tamper === 'wrong-pane'
          ? { ...evidence, paneKey: 'tab_forged:00000000-0000-4000-8000-000000000000' }
          : evidence
    const response = await sendWorkerDone(f, {
      handle: tamper === 'wrong-attempt' ? 'term_forged_handle' : terminal.handle,
      dispatchId,
      taskId: writerTaskId,
      outcome: 'succeeded',
      structuredResult: structuredReport(run, {
        childDefinitionId: 'writer',
        taskId: writerTaskId,
        dispatchId
      }),
      ...(tamper === 'missing' ? {} : { evidence: tampered })
    })

    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('consumer_fenced')
    expect(f.db.getDispatchContextById(dispatchId)!.status).toBe('dispatched')
    expect(f.db.getWorkerDispatch(dispatchId)!.state).toBe('ready')
  }
)

it('bounds a provider that never becomes ready and retains its uncertain custody', async () => {
  setProviderPtyBehavior('never_ready')
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(f, undefined, 1, {}, FROZEN_LAUNCH)
  const first = await f.adapter.reconcileRun(run.id)

  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(native.spawn.mock.results[0].value.write).not.toHaveBeenCalled()
  expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('ready')
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })
  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each([true, false])(
  'keeps frozen choices despite later profile defaults (explicit choices: %s)',
  async (explicit) => {
    const f = await setup({ kind: 'provider' })
    const frozen = explicit
      ? FROZEN_LAUNCH
      : { agentId: 'muse' as const, model: null, reasoningEffort: null }
    const { run } = await createNativeRun(f, undefined, 30, {}, frozen)
    f.store.updateSettings({
      agentDefaultArgs: { muse: '--model changed-model --thinking low' },
      agentLaunchChoices: { muse: { model: 'changed-model', options: { thinking: 'low' } } }
    })
    const dispatchId = await dispatchWriter(f, run.id)
    const launchBytes = JSON.stringify([
      native.spawn.mock.calls[0],
      native.spawn.mock.results[0].value.write.mock.calls
    ])
    expect(launchBytes).not.toContain('changed-model')
    expect(launchBytes).not.toContain('--thinking low')
    if (explicit) {
      expect(launchBytes).toContain('frozen-model')
    }
    expect(JSON.parse(f.db.getWorkerDispatch(dispatchId)!.start_options!).launch.requested).toEqual(
      {
        agent: 'muse',
        model: frozen.model,
        effort: frozen.reasoningEffort
      }
    )
    expect(f.store.getSettings().agentLaunchChoices?.muse?.model).toBe('changed-model')
  }
)

it('keeps native technical settlement separate from approval and launches the dependent exactly once', async () => {
  const f = await setup({ kind: 'provider' })
  const { run, writerTaskId } = await createNativeRun(
    f,
    [
      child('writer', {
        stageAcceptance: { requiredApprovals: [{ id: 'editor', role: 'editor' }] }
      }),
      child('reviewer', { dependencies: [{ childId: 'writer', condition: 'accepted' }] })
    ],
    30,
    {},
    FROZEN_LAUNCH
  )
  const first = await f.adapter.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const terminal = f.createdTerminals.at(-1)!
  expect(
    await sendWorkerDone(f, {
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
  ).toMatchObject({ ok: true })
  expect((await f.adapter.reconcileRun(run.id)).state).toBe('waiting')
  expect(f.db.getWorkerDispatch(dispatchId)!.state).toBe('succeeded')
  const held = f.adapter.inspectProgress(run.id)!.stages.writer.pendingApproval!
  expect(held.dispatchId).toBe(dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
  const approval = {
    ...operatorScope(run),
    gateId: 'editor',
    childDefinitionId: 'writer',
    decision: 'approve' as const,
    dispatchId,
    expectedReportDigest: held.reportDigest
  }
  await expect(
    f.adapter.resolveGate({ ...approval, expectedReportDigest: `sha256:${'0'.repeat(64)}` })
  ).rejects.toThrow(/inspect it again/)
  await f.adapter.resolveGate(approval)
  expect(f.adapter.inspectProgress(run.id)!.stages.writer.status).toBe('accepted')
  expect(native.spawn).toHaveBeenCalledTimes(2)
  expect((await f.adapter.resolveGate(approval)).disposition).toBe('already_recorded')
  expect(native.spawn).toHaveBeenCalledTimes(2)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
})
