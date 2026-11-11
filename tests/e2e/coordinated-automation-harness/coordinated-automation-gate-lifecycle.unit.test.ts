import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { inspectCoordinatedRun } from '../../../src/main/automations/coordinated-automation-run-inspection'
import { LOCAL_STAGE_EFFECT, RecoveryEnv } from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
let env: RecoveryEnv
beforeEach(async () => {
  env = await RecoveryEnv.create()
  for (const id of ['a', 'b', 'dependent']) {
    env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
  }
})
afterEach(async () => {
  await env.dispose()
})
const requirement = { id: 'signoff', role: 'editor' }
function definition() {
  const base = coordinatedCreateInput()
  return coordinatedCreateInput({
    outcomeContract: { ...base.outcomeContract!, requiredApprovals: [requirement] },
    children: [
      ...['a', 'b'].map((id) =>
        child(id, { stageAcceptance: { requiredApprovals: [requirement] } })
      ),
      child('dependent', { dependencies: [{ childId: 'a' }, { childId: 'b' }] })
    ]
  })
}
function scope(runId: string) {
  const run = env.run(runId)
  return {
    automationRunId: runId,
    orchestrationRunId: run.orchestrationRunId!,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    targetExecutionAuthority: `${run.resolvedSnapshot!.executionTarget.type}:${run.resolvedSnapshot!.executionTarget.id}`
  }
}
function stageDecision(runId: string, id: string) {
  const held = env.adapter.inspectProgress(runId)!.stages[id].pendingApproval!
  return {
    ...scope(runId),
    gateScope: 'stage' as const,
    gateId: 'signoff',
    childDefinitionId: id,
    taskId: env.taskId(runId, id),
    stageCandidate: {
      kind: 'report' as const,
      dispatchId: held.dispatchId,
      reportDigest: held.reportDigest
    },
    decision: 'approve' as const
  }
}
function inspection(runId: string) {
  return inspectCoordinatedRun({
    run: env.run(runId),
    orchestrationDb: env.db,
    progressStore: createFileCoordinatedRunProgressStore(join(env.harness.root, 'progress'))
  })
}

it('resolves shared child gate IDs independently through restart and duplicate delivery, separate from the same parent ID', async () => {
  const { runId } = env.createRun(definition())
  expect((await env.adapter.reconcileRun(runId)).state).toBe('waiting')
  const a = stageDecision(runId, 'a')
  const b = stageDecision(runId, 'b')
  expect((await env.adapter.resolveGate(b)).disposition).toBe('recorded')
  expect(
    inspection(runId).approvals.stage.map((entry) => [entry.scope.childDefinitionId, entry.status])
  ).toEqual([
    ['a', 'pending'],
    ['b', 'approved']
  ])
  expect(inspection(runId).humanResolution.pendingDecisions).toEqual([
    { scope: 'parent', gateId: 'signoff', childDefinitionId: null },
    { scope: 'stage', gateId: 'signoff', childDefinitionId: 'a' }
  ])
  expect(env.attempts.get('dependent')).toBeUndefined()
  await env.reopen()
  expect((await env.adapter.resolveGate(b)).disposition).toBe('already_recorded')
  expect((await env.adapter.resolveGate(a)).disposition).toBe('recorded')
  expect(env.attempts.get('dependent')).toBe(1)
  expect(inspection(runId).approvals.stage.map((entry) => entry.status)).toEqual([
    'approved',
    'approved'
  ])
  expect(inspection(runId).approvals.parent[0].status).toBe('pending')
  const parent = {
    ...scope(runId),
    gateScope: 'parent' as const,
    gateId: 'signoff',
    decision: 'approve' as const
  }
  expect((await env.adapter.resolveGate(parent)).state).toBe('completed')
  await env.reopen()
  for (const request of [a, b, parent]) {
    expect((await env.adapter.resolveGate(request)).disposition).toBe('already_recorded')
  }
  expect(env.adapter.inspectProgress(runId)!.approvals).toHaveLength(3)
  expect(env.adapter.inspectProgress(runId)!.operatorDecisions).toHaveLength(3)
  expect(env.attempts.get('dependent')).toBe(1)
})

it.each(['approve', 'reject'] as const)(
  'allows parent escalation then %s and preserves escalation replay after final resolution',
  async (decision) => {
    const base = coordinatedCreateInput()
    const { runId } = env.createRun(
      coordinatedCreateInput({
        children: [child('a')],
        outcomeContract: { ...base.outcomeContract!, requiredApprovals: [requirement] }
      })
    )
    expect((await env.adapter.reconcileRun(runId)).state).toBe('blocked')
    const escalation = {
      ...scope(runId),
      gateScope: 'parent' as const,
      gateId: 'signoff',
      decision: 'escalate' as const
    }
    expect((await env.adapter.resolveGate(escalation)).disposition).toBe('recorded')
    expect(inspection(runId).approvals.parent[0].status).toBe('pending')
    expect((await env.adapter.resolveGate({ ...escalation, decision })).state).toBe(
      decision === 'approve' ? 'completed' : 'failed'
    )
    await env.reopen()
    expect((await env.adapter.resolveGate(escalation)).disposition).toBe('already_recorded')
    await expect(
      env.adapter.resolveGate({
        ...escalation,
        decision: decision === 'approve' ? 'reject' : 'approve'
      })
    ).rejects.toThrow(/already been resolved/)
    expect(env.adapter.inspectProgress(runId)!.operatorDecisions).toHaveLength(2)
  }
)

it('rejects duplicate gate IDs within a child or the parent before a run can exist', () => {
  const base = definition()
  expect(() =>
    env.createRun({
      ...base,
      children: [child('a', { stageAcceptance: { requiredApprovals: [requirement, requirement] } })]
    })
  ).toThrow(/Duplicate required approval ID/)
  expect(() =>
    env.createRun({
      ...base,
      outcomeContract: { ...base.outcomeContract!, requiredApprovals: [requirement, requirement] }
    })
  ).toThrow(/Duplicate required approval ID/)
  expect(env.store.listAutomationRuns()).toEqual([])
  expect(env.attempts.size).toBe(0)
})

it('keeps an ambiguous legacy decision inert and refuses to guess its scope or rewrite it', async () => {
  const { runId } = env.createRun(definition())
  await env.adapter.reconcileRun(runId)
  const request = stageDecision(runId, 'a')
  const store = createFileCoordinatedRunProgressStore(join(env.harness.root, 'progress'))
  const progress = store.read(runId)!
  const legacy = {
    kind: 'gate_resolution' as const,
    at: env.harness.clock.now(),
    actor: 'local_operator',
    childDefinitionId: 'a',
    dispatchId: null,
    gateId: 'signoff',
    decision: 'reject' as const,
    detail: 'Legacy unscoped rejection'
  }
  store.write(
    { ...progress, sequence: progress.sequence + 1, operatorDecisions: [legacy] },
    progress.sequence
  )
  const before = store.read(runId)
  expect(inspection(runId).approvals.stage[0].status).toBe('pending')
  await expect(env.adapter.resolveGate(request)).rejects.toThrow(/ambiguous legacy decision/)
  expect(store.read(runId)).toEqual(before)
  expect(env.attempts.get('dependent')).toBeUndefined()
})

it.each(['no_attempt', 'attempt'] as const)(
  'supports explicit %s escalation and rejection without inventing report evidence',
  async (kind) => {
    const { runId } = env.createRun(
      coordinatedCreateInput({
        children: [child('a', { stageAcceptance: { requiredApprovals: [requirement] } })]
      })
    )
    await env.adapter.materializeRun(runId)
    if (kind === 'attempt') {
      env.crashAt('dispatch.after-mapping')
      await expect(env.adapter.reconcileRun(runId)).rejects.toThrow(/Injected coordinator crash/)
    }
    const dispatchId = env.dispatchIds(runId, 'a')[0]
    const request = {
      ...scope(runId),
      gateScope: 'stage' as const,
      gateId: 'signoff',
      childDefinitionId: 'a',
      taskId: env.taskId(runId, 'a'),
      stageCandidate:
        kind === 'attempt'
          ? { kind: 'attempt' as const, dispatchId }
          : { kind: 'no_attempt' as const },
      decision: 'reject' as const
    }
    await expect(
      env.adapter.resolveGate({ ...request, stageCandidate: undefined })
    ).rejects.toThrow(/explicit candidate/)
    await expect(env.adapter.resolveGate({ ...request, decision: 'approve' })).rejects.toThrow(
      /held report/
    )
    env.crashAt('operator.after-decision')
    await expect(env.adapter.resolveGate({ ...request, decision: 'escalate' })).rejects.toThrow(
      /Injected coordinator crash/
    )
    const rejected = await env.adapter.resolveGate(request)
    expect(rejected.state).toBe('failed')
    expect(env.adapter.inspectProgress(runId)!.approvals).toEqual([])
    expect(env.adapter.inspectProgress(runId)!.reports).toEqual([])
    expect(env.attempts.size).toBe(0)
    expect((await env.adapter.resolveGate(request)).disposition).toBe('already_recorded')
    expect((await env.adapter.resolveGate({ ...request, decision: 'escalate' })).disposition).toBe(
      'already_recorded'
    )
  }
)

it('fences report admission and a ready fake effect at expiry, without accepting the final stage', async () => {
  const { runId } = env.createRun(
    coordinatedCreateInput({
      globalCeilings: { maxWallClockSeconds: 600 },
      publicationPolicy: {
        allowExternalMutation: true,
        requireHumanDecisionForProduction: false,
        allowedFinalStates: ['completed', 'blocked', 'failed']
      },
      children: [
        child('a', {
          mutationClass: 'exclusive_writer',
          stageAcceptance: {
            requiredEffects: [LOCAL_STAGE_EFFECT],
            requiredApprovals: [requirement]
          }
        })
      ]
    })
  )
  const effectId = env.effectId(runId, 'a', LOCAL_STAGE_EFFECT)
  await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
  await env.harness.effects.script(effectId, ['verified'])
  expect((await env.adapter.reconcileRun(runId)).state).toBe('waiting')
  const request = stageDecision(runId, 'a')
  await env.harness.clock.advanceBy(600_000)
  await expect(env.adapter.resolveGate(request)).rejects.toThrow(/halted/)
  expect((await env.adapter.reconcileRun(runId)).state).toBe('blocked')
  expect((await env.harness.effects.query(effectId)).applyCount).toBe(0)
  expect(env.adapter.inspectProgress(runId)!.effects).toEqual({})
  expect(env.adapter.inspectProgress(runId)!.reports).toEqual([])
  expect(env.run(runId).completionReceipt ?? null).toBeNull()
})
