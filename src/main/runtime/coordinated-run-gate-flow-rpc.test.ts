import './rpc/unused-default-rpc-methods.test-fixture'
// The operator gate flow through the real host and RPC transport over a staged fake fixture:
// the worker delivers a valid report, the stage holds it for a person, and only an approval of
// the exact displayed Dispatch and report digest lets it through. No process is started.

import { afterEach, expect, it, vi } from 'vitest'
import { child } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { CoordinatedRunView } from '../../shared/coordinated-automation-run-view'
import { createCoordinatedRunRpcFixture } from './coordinated-run-rpc.test-support'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined

afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

const GATE = 'automation.resolveCoordinatedGate'
const STOP = 'automation.stopCoordinatedRun'
const RECONCILE = 'automation.reconcileCoordinatedFakeRun'
const INSPECT = 'automation.inspectCoordinatedRun'

/** Writer needs a human sign-off on its draft; the reviewer may only start once it is accepted. */
async function heldRun(options: { maxRetries?: number; maxWallClockSeconds?: number } = {}) {
  fixture = await createCoordinatedRunRpcFixture({
    definition: {
      children: [
        child('writer', {
          launchConfig: { maxRetries: options.maxRetries ?? 0 },
          stageAcceptance: { requiredApprovals: [{ id: 'gate-signoff', role: 'editor' }] }
        }),
        child('reviewer', { dependencies: [{ childId: 'writer', condition: 'accepted' }] })
      ],
      ...(options.maxWallClockSeconds
        ? { globalCeilings: { maxWallClockSeconds: options.maxWallClockSeconds } }
        : {})
    }
  })
  const f = fixture
  f.env.scripts.set('writer', (identity, attempt, env) => [
    { type: 'report', result: env.report(identity, { summary: `draft v${attempt}` }) }
  ])
  f.env.scripts.set('reviewer', (identity, _attempt, env) => [
    { type: 'report', result: env.report(identity) }
  ])
  const started = await f.runtime.startCoordinatedFakeRun(f.startRequest)
  const runId = started.view.inspection.automationRunId
  const selection = f.selection(runId)
  const view = (): CoordinatedRunView => f.runtime.inspectCoordinatedRun(selection).view
  const writer = () => view().inspection.stages.find((s) => s.childDefinitionId === 'writer')!
  const scope = () => ({
    ...selection,
    orchestrationRunId: view().inspection.orchestrationRunId,
    definitionRevision: view().inspection.definitionRevision,
    targetExecutionAuthority: view().inspection.targetExecutionAuthority!
  })
  /** Exactly what the approval dialog would submit for the report it is showing. */
  const approvalOf = (held = writer().pendingApproval!) => ({
    ...scope(),
    gateId: 'gate-signoff',
    decision: 'approve' as const,
    childDefinitionId: 'writer',
    dispatchId: held.dispatchId,
    expectedReportDigest: held.reportDigest
  })
  return { ...f, started, runId, selection, view, writer, scope, approvalOf }
}

it('holds a delivered report truthfully, then accepts only the exact approved candidate and starts the dependent once', async () => {
  const f = await heldRun()
  expect(f.started.state).toBe('waiting')
  expect(f.started.reason).toContain('awaits approval gate-signoff')

  const held = f.writer()
  const [dispatchId] = f.env.dispatchIds(f.runId, 'writer')
  expect(held.pendingApproval).toMatchObject({
    dispatchId,
    gateIds: ['gate-signoff'],
    report: { kind: 'available', outcome: 'succeeded', summary: 'draft v1' }
  })
  // Technically delivered, semantically undecided: not accepted, not rejected, no attempt spent.
  expect(held.native).toMatchObject({
    kind: 'available',
    taskStatus: 'completed',
    latestDispatchStatus: 'completed'
  })
  expect(held.semantic).toMatchObject({ kind: 'available', status: 'pending', attempts: 0 })
  expect(held.evidence.kind).toBe('absent')
  expect(held.gateResolutionEligibility).toMatchObject({
    canResolve: true,
    approvableDispatchId: dispatchId
  })
  const inspection = f.view().inspection
  expect(inspection.activeStageIds).toEqual([])
  expect(inspection.receipt.kind).toBe('absent')
  expect(inspection.humanResolution.pendingDecisions).toEqual([
    { gateId: 'gate-signoff', scope: 'stage', childDefinitionId: 'writer' }
  ])
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])

  // Duplicate reconciles keep holding the same attempt.
  for (let i = 0; i < 2; i += 1) {
    expect(await f.rpc(RECONCILE, f.selection)).toMatchObject({
      ok: true,
      result: { state: 'waiting' }
    })
  }
  expect(f.env.dispatchIds(f.runId, 'writer')).toEqual([dispatchId])
  expect(f.env.attempts.get('writer')).toBe(1)

  const approval = f.approvalOf()
  // Fail closed without the displayed evidence, and for evidence the host does not hold.
  for (const forged of [
    { ...approval, dispatchId: undefined },
    { ...approval, expectedReportDigest: undefined },
    { ...approval, expectedReportDigest: `sha256:${'0'.repeat(64)}` },
    { ...approval, dispatchId: 'ctx_another_attempt' },
    { ...approval, gateScope: 'parent' },
    { ...approval, childDefinitionId: 'reviewer' }
  ]) {
    expect(await f.rpc(GATE, forged)).toMatchObject({ ok: false })
  }
  expect(f.writer().pendingApproval).toBeDefined()
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])

  expect(await f.rpc(GATE, approval)).toMatchObject({
    ok: true,
    result: { disposition: 'recorded', state: 'completed' }
  })
  const accepted = f.writer()
  expect(accepted.pendingApproval).toBeUndefined()
  expect(accepted.semantic).toMatchObject({
    kind: 'available',
    status: 'accepted',
    attempts: 1,
    acceptedDispatchId: dispatchId
  })
  expect(accepted.evidence).toMatchObject({
    kind: 'available',
    disposition: 'accepted',
    reportDigest: approval.expectedReportDigest
  })
  expect(f.env.dispatchIds(f.runId, 'writer')).toEqual([dispatchId])
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toHaveLength(1)
  expect(f.view().inspection.receipt.kind).toBe('available')

  // An exact replay is acknowledged; a different decision about that candidate is refused.
  expect(await f.rpc(GATE, approval)).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded' }
  })
  expect(await f.rpc(GATE, { ...approval, decision: 'reject' })).toMatchObject({ ok: false })
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toHaveLength(1)
})

it('binds a rejection and a later attempt separately: a stale dialog cannot approve the newer report', async () => {
  const f = await heldRun({ maxRetries: 1 })
  const first = f.writer().pendingApproval!
  const staleApproval = f.approvalOf(first)

  expect(
    await f.rpc(GATE, { ...staleApproval, decision: 'reject', note: 'Needs sources.' })
  ).toMatchObject({ ok: true, result: { disposition: 'recorded', state: 'waiting' } })
  // The rejection spent the first attempt; the retry delivered a different report, held again.
  const second = f.writer().pendingApproval!
  expect(second.dispatchId).not.toBe(first.dispatchId)
  expect(second.reportDigest).not.toBe(first.reportDigest)
  expect(f.writer().semantic).toMatchObject({ kind: 'available', attempts: 1 })
  expect(f.writer().evidence).toMatchObject({ kind: 'unavailable' })

  // A dialog still showing the first report cannot approve the second one.
  expect(await f.rpc(GATE, staleApproval)).toMatchObject({ ok: false })
  expect(
    await f.rpc(GATE, { ...staleApproval, expectedReportDigest: second.reportDigest })
  ).toMatchObject({ ok: false })
  expect(f.writer().pendingApproval).toMatchObject(second)
  // Replaying the original rejection stays a replay of that candidate.
  expect(await f.rpc(GATE, { ...staleApproval, decision: 'reject' })).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded' }
  })
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])

  expect(await f.rpc(GATE, f.approvalOf(second))).toMatchObject({
    ok: true,
    result: { disposition: 'recorded', state: 'completed' }
  })
  expect(f.env.dispatchIds(f.runId, 'writer')).toHaveLength(2)
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toHaveLength(1)
})

it('fails the run on an explicit rejection with no retry budget and never starts the dependent', async () => {
  const f = await heldRun()
  const approval = f.approvalOf()
  const rejected = await f.rpc(GATE, { ...approval, decision: 'reject' })
  expect(rejected).toMatchObject({ ok: true, result: { disposition: 'recorded', state: 'failed' } })
  const inspection = f.view().inspection
  expect(inspection.receipt.kind).toBe('absent')
  expect(inspection.approvals.stage[0]).toMatchObject({ status: 'rejected' })
  expect(f.writer().evidence).toMatchObject({ kind: 'available', disposition: 'rejected' })
  expect(f.env.dispatchIds(f.runId, 'writer')).toHaveLength(1)
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
  // Too late to approve what was rejected.
  expect(await f.rpc(GATE, approval)).toMatchObject({ ok: false })
})

it('lets an operator stop a held run: it settles as stopped, never as accepted', async () => {
  const f = await heldRun()
  const approval = f.approvalOf()
  expect(await f.rpc(STOP, f.scope())).toMatchObject({
    ok: true,
    result: { disposition: 'recorded', state: 'failed' }
  })
  expect(f.view().inspection.runStatus).toBe('dispatch_failed')
  expect(f.view().inspection.receipt.kind).toBe('absent')
  expect(await f.rpc(GATE, approval)).toMatchObject({ ok: false })
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
})

it('blocks, rather than accepting or retrying, when a hold outlives the run wall-clock budget', async () => {
  const f = await heldRun({ maxWallClockSeconds: 600 })
  const approval = f.approvalOf()
  await f.env.harness.clock.advanceBy(601_000)

  const expired = await f.rpc(RECONCILE, f.selection)
  expect(expired).toMatchObject({ ok: true, result: { state: 'blocked' } })
  const inspection = f.view().inspection
  expect(inspection.progress).toMatchObject({
    kind: 'available',
    halt: { state: 'blocked' },
    escalations: [
      expect.objectContaining({ code: 'wall_clock_ceiling', childDefinitionId: 'writer' })
    ]
  })
  expect(inspection.receipt.kind).toBe('absent')
  // The report is still the held one: not accepted by timeout, not rejected into a retry.
  expect(f.writer().pendingApproval).toMatchObject({ dispatchId: approval.dispatchId })
  expect(f.env.dispatchIds(f.runId, 'writer')).toHaveLength(1)
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
  // An approval cannot resume a halted run.
  expect(await f.rpc(GATE, approval)).toMatchObject({ ok: false })
  expect(await f.rpc(INSPECT, f.selection)).toMatchObject({
    ok: true,
    result: { view: { inspection: { runStatus: expect.not.stringMatching('completed') } } }
  })
})
