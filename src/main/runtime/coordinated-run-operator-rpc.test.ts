import './rpc/unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { createCoordinatedRunRpcFixture } from './coordinated-run-rpc.test-support'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined

afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

const STOP = 'automation.stopCoordinatedRun'
const RETRY = 'automation.retryCoordinatedStage'
const GATE = 'automation.resolveCoordinatedGate'

/** A run held open by a foreign lane lock, so operator actions have something live to act on. */
async function waitingRun() {
  fixture = await createCoordinatedRunRpcFixture({
    injection: { laneLocks: { tryAcquire: () => ({ acquired: false, holder: 'fixture-owner' }) } }
  })
  const started = await fixture.runtime.startCoordinatedFakeRun(fixture.startRequest)
  expect(started.state).toBe('waiting')
  const inspection = started.view.inspection
  const scope = {
    ...fixture.selection(inspection.automationRunId),
    orchestrationRunId: inspection.orchestrationRunId,
    definitionRevision: inspection.definitionRevision,
    targetExecutionAuthority: inspection.targetExecutionAuthority!
  }
  return { ...fixture, started, scope, runId: inspection.automationRunId }
}

it('returns the frozen authority the operator scope must name and refuses any forged or stale scope', async () => {
  const { rpc, scope, started, env, runId, runtime } = await waitingRun()
  expect(started.view.inspection.targetExecutionAuthority).toMatch(/^local:/)
  expect(started.view.actions.stop).toMatchObject({ available: true })
  const before = env.boundaries.length

  for (const forged of [
    { ...scope, runtimeId: 'another-runtime' },
    { ...scope, orchestrationRunId: 'run_forged' },
    { ...scope, definitionRevision: scope.definitionRevision + 1 },
    { ...scope, targetExecutionAuthority: 'ssh:elsewhere' },
    { ...scope, automationRunId: 'run-of-another-parent' },
    { ...scope, unexpected: true }
  ]) {
    expect(await rpc(STOP, forged)).toMatchObject({ ok: false })
  }
  const view = runtime.inspectCoordinatedRun(fixture!.selection(runId)).view
  expect(view.inspection.operatorStop).toBeNull()
  expect(view.inspection.runStatus).toBe('dispatched')
  expect(env.boundaries).toHaveLength(before)
})

it('stops once through RPC, acknowledges the replay, and fences retry and gates afterwards', async () => {
  const { rpc, scope, runId, runtime, env } = await waitingRun()
  const taskId = env.taskId(runId, 'writer')

  const stopped = await rpc(STOP, scope)
  expect(stopped).toMatchObject({
    ok: true,
    result: {
      disposition: 'recorded',
      state: 'failed',
      view: {
        inspection: { runStatus: 'dispatch_failed', operatorStop: { reason: null } },
        actions: { stop: { available: false }, retry: { available: false } }
      }
    }
  })
  // The lane-held writer was fenced before any Dispatch existed for it.
  expect(env.dispatchIds(runId, 'writer')).toEqual([])

  const replay = await rpc(STOP, scope)
  expect(replay).toMatchObject({ ok: true, result: { disposition: 'already_recorded' } })
  const inspection = runtime.inspectCoordinatedRun(fixture!.selection(runId)).view.inspection
  expect(inspection.runStatus).toBe('dispatch_failed')
  expect(inspection.receipt.kind).toBe('absent')

  expect(
    await rpc(RETRY, {
      ...scope,
      childDefinitionId: 'writer',
      taskId,
      retryOfDispatchId: 'ctx_never_existed'
    })
  ).toMatchObject({ ok: false })
  expect(await rpc(GATE, { ...scope, gateId: 'no-such-gate', decision: 'approve' })).toMatchObject({
    ok: false
  })
  expect(env.dispatchIds(runId, 'writer')).toEqual([])
})

it('refuses operator actions once the host is stopped, before any write', async () => {
  const { rpc, scope, service, env } = await waitingRun()
  service.stop()
  const before = env.boundaries.length
  expect(await rpc(STOP, scope)).toMatchObject({ ok: false })
  expect(env.boundaries).toHaveLength(before)
})
