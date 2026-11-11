import './rpc/unused-default-rpc-methods.test-fixture'
// Operator actions and restart/deadline recovery over the composed native stub attempt path;
// see coordinated-native-stub-attempt.test-support.ts for what the fixture controls.

import { expect, it, vi } from 'vitest'
import { CoordinatedAutomationAdapter } from '../automations/coordinated-automation-adapter'
import { child } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  nativeStubAttemptRoot,
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

it('operator stop drives the native attempt to proven exit and settles the run as a stop failure', async () => {
  const f = await setup()
  const { run } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)
  const terminal = f.createdTerminals.at(-1)!

  const stopped = await f.adapter.stopRun(operatorScope(run))
  expect(stopped.state).toBe('failed')
  expect(stopped.reason).toContain('Operator stop requested')
  const settled = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(settled.status).toBe('dispatch_failed')
  expect(f.db.getWorkerDispatch(dispatchId)?.state).toBe('stopped')
  const progress = f.adapter.inspectProgress(run.id)!
  expect(progress.operatorStop).not.toBeNull()
  expect(progress.operatorDecisions).toHaveLength(1)
  expect(progress.operatorDecisions![0]).toMatchObject({ kind: 'stop', actor: 'local_operator' })
  // The stopped attempt was abandoned, never admitted as a report.
  const stage = progress.stages['writer']
  expect(stage.status).not.toBe('accepted')
  expect(stage.lineage.every((record) => record.status !== 'active')).toBe(true)
  expect(terminal).toBeDefined()
})

it('binds one gate id per scope: the stage approval names the exact attempt, the parent names none', async () => {
  const f = await setup()
  const gated = child('writer', {
    stageAcceptance: {
      requiredApprovals: [{ id: 'gate-review', role: 'reviewer', required: true }]
    }
  })
  const { run, writerTaskId } = await createNativeRun(f, [gated], 30, {
    outcomeContract: {
      humanStatement: 'One reviewed article is ready.',
      acceptanceCriteria: [
        { id: 'draft-ready', description: 'Draft accepted', required: true, kind: 'custom' }
      ],
      // The same id is also a parent requirement; each scope needs its own decision.
      requiredApprovals: [{ id: 'gate-review', role: 'editor' }],
      allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
    }
  })
  const dispatchId = await dispatchWriter(f, run.id)
  const terminal = f.createdTerminals.at(-1)!

  // The host binds the stage approval to the stage's one launched attempt when none is named.
  const resolved = await f.adapter.resolveGate({
    ...operatorScope(run),
    gateId: 'gate-review',
    decision: 'approve',
    note: 'Reviewed out of band.',
    childDefinitionId: 'writer'
  })
  expect(resolved.state).toBe('outcome_uncertain')
  expect(resolved.disposition).toBe('recorded')
  const parent = await f.adapter.resolveGate({
    ...operatorScope(run),
    gateId: 'gate-review',
    gateScope: 'parent',
    decision: 'approve'
  })
  expect(parent.disposition).toBe('recorded')
  const progress = f.adapter.inspectProgress(run.id)!
  expect(progress.approvals).toHaveLength(2)
  expect(progress.approvals![0]).toMatchObject({
    scope: 'stage',
    approvalId: 'gate-review',
    approverIdentity: 'local_operator',
    childDefinitionId: 'writer',
    taskId: writerTaskId,
    dispatchId
  })
  expect(progress.approvals![1]).toMatchObject({ scope: 'parent', approvalId: 'gate-review' })
  expect(progress.approvals![1].dispatchId).toBeUndefined()

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
  const completed = await f.adapter.reconcileRun(run.id)
  expect(completed.state).toBe('completed')
  expect(completed.run.completionReceipt).toBeTruthy()
})

it('refuses gate replays and scope-mismatched decisions before any write', async () => {
  const f = await setup()
  const gated = child('writer', {
    stageAcceptance: {
      requiredApprovals: [{ id: 'gate-review', role: 'reviewer', required: true }]
    }
  })
  const { run, writerTaskId } = await createNativeRun(f, [gated])
  const dispatchId = await dispatchWriter(f, run.id)

  await expect(
    f.adapter.resolveGate({
      ...operatorScope(run),
      gateId: 'gate-unknown',
      decision: 'approve'
    })
  ).rejects.toThrow(/not a pending approval requirement/)
  await expect(
    f.adapter.resolveGate({
      ...operatorScope(run),
      gateId: 'gate-review',
      decision: 'approve',
      childDefinitionId: 'wrong-child',
      taskId: writerTaskId,
      dispatchId
    })
  ).rejects.toThrow(/belongs to stage/)
  const approve = {
    ...operatorScope(run),
    gateId: 'gate-review',
    decision: 'approve' as const,
    childDefinitionId: 'writer',
    taskId: writerTaskId,
    dispatchId
  }
  expect((await f.adapter.resolveGate(approve)).disposition).toBe('recorded')
  // A lost acknowledgement replays to the same answer; a different decision is refused.
  expect((await f.adapter.resolveGate(approve)).disposition).toBe('already_recorded')
  await expect(f.adapter.resolveGate({ ...approve, decision: 'reject' })).rejects.toThrow(
    /already been resolved as "approve"/
  )
  await expect(f.adapter.resolveGate({ ...approve, gateScope: 'parent' })).rejects.toThrow(
    /not a pending approval requirement/
  )
  const progress = f.adapter.inspectProgress(run.id)!
  expect(progress.approvals).toHaveLength(1)
  expect(progress.operatorDecisions!.filter((d) => d.kind === 'gate_resolution')).toHaveLength(1)
})

it('holds a native attempt past its persisted deadline as outcome_uncertain with the retained explanation', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  let now = 1_000_000
  const clocked = new CoordinatedAutomationAdapter({
    store: f.store,
    orchestrationDb: f.db,
    nativeStubWorker: f.nativeStubWorker,
    clock: { now: () => now, setTimer: () => () => {} }
  })
  const first = await clocked.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  const dispatchId = f.store
    .listAutomationRuns()
    .find((r) => r.id === run.id)!
    .childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId!
  now += 31_000
  const second = await clocked.reconcileRun(run.id)
  expect(second.state).toBe('outcome_uncertain')
  expect(second.reason).toContain(dispatchId)
  expect(second.reason).not.toContain('completed')
  const progress = clocked.inspectProgress(run.id)!
  expect(progress.stages['writer'].status).not.toBe('accepted')
  // No respawn and no rebind: exactly the one retained Dispatch.
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('reopens a retained uncertain run on a rebuilt runtime without respawning or rebinding', async () => {
  const f1 = await setup()
  const { run, writerTaskId } = await createNativeRun(f1)
  const dispatchId = await dispatchWriter(f1, run.id)
  const keptRoot = nativeStubAttemptRoot()

  // Simulate a process restart: same profile, workspace, and composition files, fresh runtime
  // identity. The new generation cannot prove the old worker dead, so the run must hold
  // truthfully instead of respawning or rebinding.
  const f2 = await setup({ rootDir: keptRoot, homeDir: f1.home, workspaceDir: f1.workspace })
  const reopened = f2.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(reopened.orchestrationRunId).toBe(run.orchestrationRunId)
  const outcome = await f2.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('outcome_uncertain')
  expect(outcome.reason).toContain(dispatchId)
  expect(f2.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(native.spawn).toHaveBeenCalledTimes(1)
  const settled = f2.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(settled.childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId).toBe(
    dispatchId
  )
  expect(settled.status).not.toBe('completed')
})
