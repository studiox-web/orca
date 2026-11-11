import '../../../src/main/runtime/rpc/unused-default-rpc-methods.test-fixture'
// The operator gate flow through the real host and RPC transport over a staged fake fixture:
// the worker delivers a valid report, the stage holds it for a person, and only an approval of
// the exact displayed Dispatch and report digest lets it through. No process is started.

import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import { child } from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { CoordinatedRunView } from '../../../src/shared/coordinated-automation-run-view'
import { createCoordinatedRunRpcFixture } from '../../../src/main/runtime/coordinated-run-rpc.test-support'
import {
  captureCoordinatedGateCandidate,
  coordinatedGateParams
} from '../../../src/renderer/src/components/automations/coordinated-run-gate-candidate'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

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
async function heldRun(
  options: {
    maxRetries?: number
    maxWallClockSeconds?: number
    finalStage?: boolean
    noAttempt?: boolean
  } = {}
) {
  fixture = await createCoordinatedRunRpcFixture({
    ...(options.noAttempt
      ? {
          injection: {
            laneLocks: { tryAcquire: () => ({ acquired: false as const, holder: 'fixture-owner' }) }
          }
        }
      : {}),
    definition: {
      children: [
        child('writer', {
          ...(options.noAttempt ? { mutationClass: 'exclusive_writer' as const } : {}),
          launchConfig: { maxRetries: options.maxRetries ?? 0 },
          stageAcceptance: { requiredApprovals: [{ id: 'gate-signoff', role: 'editor' }] }
        }),
        ...(options.finalStage
          ? []
          : [child('reviewer', { dependencies: [{ childId: 'writer', condition: 'accepted' }] })])
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
    taskId: writer().taskId!,
    dispatchId: held.dispatchId,
    expectedReportDigest: held.reportDigest
  })
  const progress = () =>
    createFileCoordinatedRunProgressStore(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)).read(
      runId
    )!
  return { ...f, started, runId, selection, view, writer, scope, approvalOf, progress }
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

it('replays the actual renderer rejection of A without rejecting B, which remains resolvable', async () => {
  const f = await heldRun({ maxRetries: 1 })
  const binding = {
    automation: f.env.store.listAutomations().find((a) => a.id === f.automationId)!,
    owner: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
  }
  const gate = f.view().inspection.humanResolution.pendingDecisions[0]
  const action = {
    ...gate,
    kind: 'gate' as const,
    decision: 'reject' as const,
    candidate: captureCoordinatedGateCandidate(binding, f.view(), gate)
  }
  const original = coordinatedGateParams(binding, f.view(), action, false)
  expect(original).toMatchObject({
    dispatchId: action.candidate.heldReport!.dispatchId,
    expectedReportDigest: action.candidate.heldReport!.reportDigest
  })
  expect(await f.rpc(GATE, original)).toMatchObject({ ok: true })
  const second = f.writer().pendingApproval!
  // The response was lost; the original bytes, not the refreshed hold, identify the replay.
  const replay = coordinatedGateParams(binding, f.view(), action, true)
  expect(replay).toEqual(original)
  expect(await f.rpc(GATE, replay)).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded' }
  })
  expect(f.writer().pendingApproval).toEqual(second)
  expect(f.progress().operatorDecisions).toHaveLength(1)
  expect(f.progress().operatorDecisions![0]).toMatchObject({
    decision: 'reject',
    dispatchId: original.dispatchId,
    reportDigest: original.expectedReportDigest,
    childDefinitionId: 'writer',
    taskId: original.taskId
  })
  expect(f.view().inspection.humanResolution.pendingDecisions).toContainEqual(gate)
  expect(f.view().inspection.approvals.stage[0].status).toBe('pending')
  expect(() => coordinatedGateParams(binding, f.view(), action, false)).toThrow()
  const approval = {
    ...action,
    decision: 'approve' as const,
    candidate: captureCoordinatedGateCandidate(binding, f.view(), gate)
  }
  expect(
    await f.rpc(GATE, coordinatedGateParams(binding, f.view(), approval, false))
  ).toMatchObject({ ok: true, result: { state: 'completed' } })
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toHaveLength(1)
  expect(
    f.progress().operatorDecisions!.map((entry) => [entry.decision, entry.dispatchId])
  ).toEqual([
    ['reject', original.dispatchId],
    ['approve', second.dispatchId]
  ])
})

it('refuses delayed rejection of A after another gate decision already advanced the hold to B', async () => {
  const f = await heldRun({ maxRetries: 1 })
  const stale = { ...f.approvalOf(), decision: 'escalate' }
  expect(await f.rpc(GATE, { ...f.approvalOf(), decision: 'reject' })).toMatchObject({ ok: true })
  const second = f.writer().pendingApproval!
  expect(await f.rpc(GATE, stale)).toMatchObject({ ok: false })
  // A delayed rejection can acknowledge A's recorded rejection, but cannot mutate B.
  expect(await f.rpc(GATE, { ...stale, decision: 'reject' })).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded' }
  })
  expect(f.writer().pendingApproval).toEqual(second)
  expect(f.progress().operatorDecisions).toHaveLength(1)
})

it('preserves an already-recorded approval receipt while fencing its post-deadline replay before admission', async () => {
  const f = await heldRun({ maxWallClockSeconds: 600, finalStage: true })
  const approval = f.approvalOf()
  f.env.crashOn = { boundary: 'operator.after-decision', occurrence: 1, seen: 0 }
  expect(await f.rpc(GATE, approval)).toMatchObject({ ok: false })
  expect(f.progress().approvals).toHaveLength(1)
  const held = f.writer().pendingApproval!
  await f.env.harness.clock.advanceBy(601_000)
  const sequence = f.progress().sequence
  expect(f.view().inspection.progress).toMatchObject({ halt: null })
  expect(f.progress().sequence).toBe(sequence)
  expect(await f.rpc(GATE, approval)).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded', state: 'blocked' }
  })
  expect(f.writer().pendingApproval).toEqual(held)
  expect(f.progress().reports).toEqual([])
  expect(f.progress().effects).toEqual({})
  expect(f.view().inspection.receipt.kind).toBe('absent')
})

it('accepts an exact final-stage approval immediately before the deadline and keeps its completion receipt afterwards', async () => {
  const f = await heldRun({ maxWallClockSeconds: 600, finalStage: true })
  const approval = f.approvalOf()
  await f.env.harness.clock.advanceBy(599_999)
  expect(await f.rpc(GATE, approval)).toMatchObject({ ok: true, result: { state: 'completed' } })
  const receipt = f.view().inspection.receipt
  await f.env.harness.clock.advanceBy(2)
  expect(await f.rpc(GATE, approval)).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded', state: 'completed' }
  })
  expect(f.view().inspection.receipt).toEqual(receipt)
})

it.each(['reject', 'escalate'] as const)(
  'does not let %s consume an expired hold or lift its halt',
  async (decision) => {
    const f = await heldRun({ maxWallClockSeconds: 600, maxRetries: 1 })
    const request = f.approvalOf()
    await f.env.harness.clock.advanceBy(601_000)
    expect(await f.rpc(GATE, { ...request, decision })).toMatchObject({ ok: false })
    expect(f.progress().operatorDecisions).toEqual([])
    const escalation = f.progress().escalations[0]
    expect(
      await f.rpc(GATE, {
        ...f.scope(),
        gateScope: 'escalation',
        gateId: escalation.key,
        childDefinitionId: escalation.childDefinitionId!,
        decision: 'approve'
      })
    ).toMatchObject({ ok: true, result: { state: 'blocked' } })
    expect(f.progress().approvals).toEqual([])
    expect(f.writer().pendingApproval).toMatchObject({ dispatchId: request.dispatchId })
    expect(await f.rpc(GATE, request)).toMatchObject({ ok: false })
    expect(f.env.dispatchIds(f.runId, 'writer')).toHaveLength(1)
    expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
  }
)

it.each([false, true])(
  'fences approval as the first operation at the deadline (final stage %s)',
  async (finalStage) => {
    const f = await heldRun({ maxWallClockSeconds: 600, finalStage })
    const approval = f.approvalOf()
    await f.env.harness.clock.advanceBy(600_000)
    expect(await f.rpc(GATE, approval)).toMatchObject({ ok: false })
    expect(f.view().inspection.progress).toMatchObject({
      kind: 'available',
      halt: { state: 'blocked' }
    })
    expect(f.writer().pendingApproval).toBeDefined()
    expect(f.writer().semantic).toMatchObject({ status: 'pending', attempts: 0 })
    expect(f.view().inspection.approvals.stage[0].status).toBe('pending')
    expect(f.view().inspection.receipt.kind).toBe('absent')
    if (!finalStage) {
      expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
    }
  }
)

it.each(['approve', 'reject'] as const)(
  'permits explicit %s after escalating the same stage requirement',
  async (decision) => {
    const f = await heldRun()
    const request = f.approvalOf()
    const escalation = { ...request, decision: 'escalate' }
    expect(await f.rpc(GATE, escalation)).toMatchObject({
      ok: true,
      result: { disposition: 'recorded' }
    })
    expect(await f.rpc(GATE, { ...request, decision })).toMatchObject({
      ok: true,
      result: { disposition: 'recorded' }
    })
    expect(await f.rpc(GATE, escalation)).toMatchObject({
      ok: true,
      result: { disposition: 'already_recorded' }
    })
    expect(
      await f.rpc(GATE, { ...request, decision: decision === 'approve' ? 'reject' : 'approve' })
    ).toMatchObject({ ok: false })
  }
)

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

it('refuses missing, conflicting and foreign scope for every stage decision before writing', async () => {
  const f = await heldRun()
  const before = f.progress()
  const request = f.approvalOf()
  for (const decision of ['approve', 'reject', 'escalate']) {
    for (const change of [
      { runtimeId: 'foreign-runtime' },
      { automationId: 'foreign-automation' },
      { automationRunId: 'foreign-run' },
      { orchestrationRunId: 'foreign-native-run' },
      { definitionRevision: request.definitionRevision + 1 },
      { targetExecutionAuthority: 'ssh:foreign' },
      {
        expectedOwner: {
          selector: { kind: 'ssh', targetId: 'foreign-target', targetGeneration: 1 }
        }
      },
      { taskId: 'foreign-task' },
      { taskId: undefined },
      { childDefinitionId: 'reviewer' },
      { dispatchId: 'foreign-attempt' },
      { expectedReportDigest: `sha256:${'0'.repeat(64)}` },
      { dispatchId: undefined, expectedReportDigest: undefined },
      { stageCandidate: { kind: 'no_attempt' } },
      { gateScope: 'parent' }
    ]) {
      expect(await f.rpc(GATE, { ...request, decision, ...change })).toMatchObject({ ok: false })
    }
  }
  expect(f.progress()).toEqual(before)
  expect(f.env.dispatchIds(f.runId, 'reviewer')).toEqual([])
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

it('submits an explicit no-attempt candidate from the renderer through RPC for escalation and rejection', async () => {
  const f = await heldRun({ noAttempt: true })
  const binding = {
    automation: f.env.store.listAutomations().find((a) => a.id === f.automationId)!,
    owner: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
  }
  const gate = f.view().inspection.humanResolution.pendingDecisions[0]
  const action = {
    ...gate,
    kind: 'gate' as const,
    decision: 'escalate' as const,
    candidate: captureCoordinatedGateCandidate(binding, f.view(), gate)
  }
  const request = coordinatedGateParams(binding, f.view(), action, false)
  expect(request).toMatchObject({
    stageCandidate: { kind: 'no_attempt' },
    taskId: f.writer().taskId
  })
  expect(request).not.toHaveProperty('dispatchId')
  expect(request).not.toHaveProperty('expectedReportDigest')
  expect(await f.rpc(GATE, { ...request, stageCandidate: undefined })).toMatchObject({ ok: false })
  expect(await f.rpc(GATE, { ...request, decision: 'approve' })).toMatchObject({ ok: false })
  expect(await f.rpc(GATE, request)).toMatchObject({ ok: true, result: { state: 'waiting' } })
  const rejection = coordinatedGateParams(
    binding,
    f.view(),
    { ...action, decision: 'reject' },
    false
  )
  expect(await f.rpc(GATE, rejection)).toMatchObject({ ok: true, result: { state: 'failed' } })
  expect(await f.rpc(GATE, rejection)).toMatchObject({
    ok: true,
    result: { disposition: 'already_recorded' }
  })
  expect(f.progress().operatorDecisions!.map((entry) => entry.stageCandidate)).toEqual([
    { kind: 'no_attempt' },
    { kind: 'no_attempt' }
  ])
  expect(f.progress().approvals).toEqual([])
  expect(f.env.dispatchIds(f.runId, 'writer')).toEqual([])
})
