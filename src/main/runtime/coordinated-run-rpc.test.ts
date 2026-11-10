import './rpc/unused-default-rpc-methods.test-fixture'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { testState } from '../persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE,
  COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY as DEFINITIONS
} from '../../shared/automation-runtime-capabilities'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'
import {
  CoordinatedFakeRunStart,
  CoordinatedRunSelection
} from '../../shared/rpc-contract/coordinated-automation-run-params'
import { LOCAL_STAGE_EFFECT } from '../../../tests/e2e/coordinated-automation-harness/coordinated-automation-recovery-env'
import { createFileCoordinatedRunProgressStore } from '../automations/coordinated-automation-progress-store'
import { COORDINATED_PROGRESS_DIRECTORY } from '../automations/coordinated-automation-run-host'
import { createCoordinatedRunRpcFixture } from './coordinated-run-rpc.test-support'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined
async function setup(options?: Parameters<typeof createCoordinatedRunRpcFixture>[0]) {
  fixture = await createCoordinatedRunRpcFixture(options)
  return fixture
}

afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

const START = 'automation.startCoordinatedFakeRun'
const INSPECT = 'automation.inspectCoordinatedRun'
const RECONCILE = 'automation.reconcileCoordinatedFakeRun'

describe('coordinated fake run wire requests', () => {
  const request = {
    runtimeId: 'runtime-a',
    automationId: 'parent-a',
    expectedOwner: { selector: { kind: 'self' } },
    expectedDefinitionRevision: 1,
    idempotencyKey: ' exact key '
  }
  it('requires exact authority, owner, revision and idempotency fields without rewriting the key', () => {
    expect(CoordinatedFakeRunStart.parse(request).idempotencyKey).toBe(' exact key ')
    for (const key of Object.keys(request)) {
      expect(CoordinatedFakeRunStart.safeParse({ ...request, [key]: undefined }).success).toBe(
        false
      )
    }
    expect(
      CoordinatedFakeRunStart.safeParse({ ...request, expectedDefinitionRevision: 0 }).success
    ).toBe(false)
    expect(
      CoordinatedFakeRunStart.safeParse({ ...request, idempotencyKey: 'a'.repeat(129) }).success
    ).toBe(false)
    expect(CoordinatedFakeRunStart.safeParse({ ...request, capability: FAKE }).success).toBe(false)
  })
  it('requires the selected AutomationRun association', () => {
    const selected = {
      runtimeId: 'runtime-a',
      automationId: 'parent-a',
      automationRunId: 'run-a',
      expectedOwner: request.expectedOwner
    }
    expect(CoordinatedRunSelection.safeParse(selected).success).toBe(true)
    for (const key of Object.keys(selected)) {
      expect(CoordinatedRunSelection.safeParse({ ...selected, [key]: undefined }).success).toBe(
        false
      )
    }
  })
})

describe('coordinated fake run capability and authority refusal', () => {
  it.each([
    { label: 'absent service host', host: false },
    { label: 'definition gate closed', definitionGate: false },
    { label: 'service not started', start: false }
  ])('refuses $label before writing', async (options) => {
    const { runtime, env, rpc, startRequest, service, published } = await setup(options)
    const nativeRunsBefore = env.db.listRuns().runs
    const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
    expect(runtime.getStatus().capabilities).not.toContain(FAKE)
    expect(await rpc(START, startRequest, { clientCapabilities: [FAKE] })).toMatchObject({
      ok: false
    })
    expect(start).not.toHaveBeenCalled()
    expect(env.store.listAutomationRuns()).toEqual([])
    expect(env.db.listRuns().runs).toEqual(nativeRunsBefore)
    expect(published).toEqual([])
    if (options.host === false) {
      expect(runtime.getStatus().capabilities).toContain(DEFINITIONS)
    }
  })

  it.each(['packaged', 'remote runtime', 'setting revoked', 'disposed host'])(
    'refuses %s before writing',
    async (reason) => {
      const { runtime, service, env, startRequest, rpc } = await setup()
      if (reason === 'packaged') {
        installFakeAppEnvironment({ getPath: () => testState.dir, isPackaged: () => true })
      }
      if (reason === 'remote runtime') {
        runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID, { tabs: [], leaves: [] })
      }
      if (reason === 'setting revoked') {
        env.store.updateSettings({ experimentalCoordinatedAutomations: false })
      }
      if (reason === 'disposed host') {
        service.stop()
      }
      const nativeRunsBefore = env.db.listRuns().runs
      const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
      expect(runtime.getStatus().capabilities).not.toContain(FAKE)
      expect(await rpc(START, startRequest)).toMatchObject({ ok: false })
      expect(start).not.toHaveBeenCalled()
      expect(env.store.listAutomationRuns()).toEqual([])
      expect(env.db.listRuns().runs).toEqual(nativeRunsBefore)
    }
  )

  it.each([
    { clientKind: 'runtime' as const },
    { caller: { kind: 'paired-device' as const, deviceId: 'device' } }
  ])('refuses an unknown or paired caller regardless of claimed capability', async (transport) => {
    const { runtime, env, startRequest, rpc } = await setup()
    const invoke = vi.spyOn(runtime, 'startCoordinatedFakeRun')
    expect(
      await rpc(START, startRequest, { ...transport, clientCapabilities: [FAKE] })
    ).toMatchObject({ ok: false })
    expect(invoke).not.toHaveBeenCalled()
    expect(env.store.listAutomationRuns()).toEqual([])
  })

  it('refuses the wrong runtime or owner and missing revision before host mutation', async () => {
    const { service, env, startRequest, rpc } = await setup()
    const nativeRunsBefore = env.db.listRuns().runs
    const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
    for (const patch of [
      { runtimeId: 'another-runtime' },
      { expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } } },
      { expectedDefinitionRevision: undefined }
    ]) {
      expect(await rpc(START, { ...startRequest, ...patch })).toMatchObject({ ok: false })
    }
    expect(start).not.toHaveBeenCalled()
    expect(env.store.listAutomationRuns()).toEqual([])
    expect(env.db.listRuns().runs).toEqual(nativeRunsBefore)
  })
})

describe('selected coordinated runs through native RPC transport', () => {
  it('replays duplicate starts and exposes accepted historical native identities without inventing sessions', async () => {
    const { runtime, service, env, rpc, startRequest, automationId, selection, published } =
      await setup()
    await vi.waitFor(() => expect(service.coordinatedRuns.availability.available).toBe(true))
    expect(runtime.getStatus().capabilities).toContain(FAKE)
    const results = await Promise.all([rpc(START, startRequest), rpc(START, startRequest)])
    expect(results).toMatchObject([
      { ok: true, result: { created: true, state: 'completed' } },
      { ok: true, result: { created: false, state: 'completed' } }
    ])
    const [run] = env.store.listAutomationRuns(automationId)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
    const selected = selection(run.id)
    const publishedAfterStarts = published.length
    expect(await rpc(INSPECT, selected)).toMatchObject({
      ok: true,
      result: {
        view: {
          runtimeId: runtime.getRuntimeId(),
          inspection: { automationId, automationRunId: run.id, receipt: { kind: 'available' } }
        }
      }
    })
    const before = runtime.inspectCoordinatedRun(selected).view
    expect(before.inspection.stages[0]).toMatchObject({
      childDefinitionId: 'research',
      native: { kind: 'available', taskStatus: 'completed' },
      semantic: { kind: 'available', status: 'accepted', attempts: 1 },
      sessionTarget: { kind: 'unavailable' }
    })
    expect(before.inspection.stages[0].taskId).toBe(env.taskId(run.id, 'research'))
    expect(before.inspection.stages[0].mappedDispatchId).toBe(
      env.dispatchIds(run.id, 'research')[0]
    )
    expect(before.actions).toMatchObject({
      start: { available: true },
      reconcile: { available: true },
      stop: { available: false },
      retry: { available: false },
      humanResolution: { available: false }
    })
    expect(before.findings.kind).toBe('unavailable')
    expect(before.limits.kind).toBe('unavailable')
    env.store.updateCoordinatedAutomation(
      automationId,
      { expectedDefinitionRevision: 1, children: [child('new-child')] },
      { expectedOwner: startRequest.expectedOwner }
    )
    const after = runtime.inspectCoordinatedRun(selected).view
    expect(after.inspection).toEqual(before.inspection)
    before.inspection.stages[0].name = 'Caller mutation'
    expect(runtime.inspectCoordinatedRun(selected).view.inspection.stages[0].name).not.toBe(
      'Caller mutation'
    )
    expect(published.length).toBeGreaterThan(2)
    expect(published).toHaveLength(publishedAfterStarts)
    for (const event of published) {
      expect(event).toEqual({ reason: 'run', selector: { kind: 'self' } })
    }
  })

  it('keeps a held lock waiting with no completion receipt', async () => {
    const { runtime, startRequest, selection } = await setup({
      injection: {
        laneLocks: { tryAcquire: () => ({ acquired: false, holder: 'fixture-owner' }) }
      }
    })
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    expect(result.state).toBe('waiting')
    const inspected = runtime.inspectCoordinatedRun(
      selection(result.view.inspection.automationRunId)
    ).view.inspection
    expect(inspected.runStatus).toBe('dispatched')
    expect(inspected.progress).toMatchObject({
      kind: 'available',
      halt: null,
      escalations: [expect.objectContaining({ code: 'lock_unavailable' })]
    })
    expect(inspected.receipt.kind).toBe('absent')
    expect(inspected.humanResolution.available).toBe(false)
  })

  it('keeps a cost ceiling blocked with the actual limits escalation and no receipt', async () => {
    const { runtime, env, automationId, startRequest, selection } = await setup()
    env.costPerAttemptUsd = 1
    env.store.updateCoordinatedAutomation(
      automationId,
      { expectedDefinitionRevision: 1, globalCeilings: { maxEstimatedCostUsd: 1.5 } },
      { expectedOwner: startRequest.expectedOwner }
    )
    const result = await runtime.startCoordinatedFakeRun({
      ...startRequest,
      expectedDefinitionRevision: 2
    })
    expect(result.state).toBe('blocked')
    const inspection = runtime.inspectCoordinatedRun(
      selection(result.view.inspection.automationRunId)
    ).view.inspection
    expect(inspection.runStatus).toBe('dispatched')
    expect(inspection.progress).toMatchObject({
      kind: 'available',
      halt: { state: 'blocked' },
      escalations: [expect.objectContaining({ code: 'cost_ceiling' })]
    })
    expect(inspection.receipt.kind).toBe('absent')
  })

  it('keeps uncertain fake effects separate from native process success', async () => {
    const { runtime, env, automationId, startRequest, selection } = await setup({
      fakeEffects: true
    })
    env.store.updateCoordinatedAutomation(
      automationId,
      {
        expectedDefinitionRevision: 1,
        children: [
          child('research'),
          child('writer', {
            dependencies: [{ childId: 'research', condition: 'accepted' }],
            mutationClass: 'exclusive_writer',
            mutationLane: 'content',
            stageAcceptance: { requiredEffects: [LOCAL_STAGE_EFFECT] }
          })
        ],
        publicationPolicy: {
          allowExternalMutation: true,
          requireHumanDecisionForProduction: false,
          allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
        }
      },
      { expectedOwner: startRequest.expectedOwner }
    )
    env.scripts.set('writer', async (identity) => {
      const effectId = env.effectId(identity.automationRunId, 'writer', LOCAL_STAGE_EFFECT)
      await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
      await env.harness.effects.script(effectId, ['uncertain'])
      return [{ type: 'report', result: env.report(identity) }]
    })
    const result = await runtime.startCoordinatedFakeRun({
      ...startRequest,
      expectedDefinitionRevision: 2
    })
    expect(result.state).toBe('outcome_uncertain')
    const inspected = runtime.inspectCoordinatedRun(
      selection(result.view.inspection.automationRunId)
    ).view.inspection
    expect(inspected.runStatus).toBe('dispatched')
    expect(inspected.progress).toMatchObject({
      kind: 'available',
      halt: null,
      effects: [{ status: 'uncertain' }]
    })
    expect(inspected.receipt.kind).toBe('absent')
  })

  it('reports absent materialization evidence for a waiting run without synthesizing native identities', async () => {
    const { runtime, env, automationId, selection } = await setup()
    const creation = env.store.createCoordinatedAutomationRun({
      automationId,
      trigger: 'manual',
      scheduledFor: env.harness.clock.now(),
      idempotencyKey: 'waiting',
      expectedOwner: { selector: { kind: 'self' } },
      expectedDefinitionRevision: 1
    })
    if (!creation.run) {
      throw new Error('Missing fixture run')
    }
    const request = selection(creation.run.id)
    const inspection = runtime.inspectCoordinatedRun(request).view.inspection
    expect(inspection).toMatchObject({
      runStatus: 'pending',
      orchestrationRunId: null,
      progress: { kind: 'absent' },
      receipt: { kind: 'absent' }
    })
    expect(inspection.stages[0]).toMatchObject({
      taskId: null,
      mappedDispatchId: null,
      native: { kind: 'absent' },
      semantic: { kind: 'absent' },
      sessionTarget: { kind: 'unavailable' }
    })
  })

  it('refuses inspection and reconciliation after disposal without host calls or new writes', async () => {
    const { runtime, env, service, rpc, startRequest, selection } = await setup()
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    service.stop()
    const inspect = vi.spyOn(service.coordinatedRuns, 'inspectRun')
    const reconcile = vi.spyOn(service.coordinatedRuns, 'reconcileRun')
    const before = env.boundaries.length
    const request = selection(result.view.inspection.automationRunId)
    expect(runtime.getStatus().coordinatedFakeRuns).toMatchObject({
      available: false,
      state: 'stopped',
      reason: expect.any(String)
    })
    expect(await rpc(INSPECT, request)).toMatchObject({ ok: false })
    expect(await rpc(RECONCILE, request)).toMatchObject({ ok: false })
    expect(inspect).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(env.boundaries).toHaveLength(before)
  })

  it.each(['setting', 'owner'])(
    'rechecks %s inside a queued start before first mutation',
    async (revocation) => {
      const { service, env, rpc, startRequest, automationId, published } = await setup()
      const acquired = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const holding = service.runInAutomationLane(automationId, async () => {
        acquired.resolve()
        await release.promise
      })
      await acquired.promise
      const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
      const nativeBefore = env.db.listRuns().runs
      const pending = rpc(START, startRequest)
      await vi.waitFor(() => expect(start).toHaveBeenCalled())
      if (revocation === 'setting') {
        env.store.updateSettings({ experimentalCoordinatedAutomations: false })
      } else {
        env.store.updateCoordinatedAutomation(
          automationId,
          { expectedDefinitionRevision: 1, projectId: 'repo-ssh' },
          {
            expectedOwner: startRequest.expectedOwner,
            destination: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
          }
        )
      }
      release.resolve()
      await holding
      expect(await pending).toMatchObject({ ok: false })
      expect(env.store.listAutomationRuns()).toEqual([])
      expect(env.db.listRuns().runs).toEqual(nativeBefore)
      expect(published).toEqual([])
    }
  )

  it('rejects a selected run from another parent before read or reconcile', async () => {
    const { runtime, service, env, rpc, startRequest, selection } = await setup()
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    const { automationId } = env.createDefinitionOnly(
      coordinatedCreateInput({ name: 'Other parent' })
    )
    const wrong = { ...selection(result.view.inspection.automationRunId), automationId }
    const inspect = vi.spyOn(service.coordinatedRuns, 'inspectRun')
    const reconcile = vi.spyOn(service.coordinatedRuns, 'reconcileRun')
    const before = env.boundaries.length
    expect(await rpc(INSPECT, wrong)).toMatchObject({ ok: false })
    expect(await rpc(RECONCILE, wrong)).toMatchObject({ ok: false })
    expect(inspect).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(env.boundaries).toHaveLength(before)
  })

  it('keeps a frozen local run inspectable after a future-target edit but refuses a new local start', async () => {
    const { runtime, env, service, rpc, automationId, startRequest, selection } = await setup()
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    const request = selection(result.view.inspection.automationRunId)
    env.store.updateCoordinatedAutomation(
      automationId,
      { expectedDefinitionRevision: 1, projectId: 'repo-ssh' },
      {
        expectedOwner: startRequest.expectedOwner,
        destination: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
      }
    )
    const inspected = runtime.inspectCoordinatedRun(request).view
    expect(inspected.inspection).toEqual(result.view.inspection)
    expect(inspected.actions.start.available).toBe(false)
    expect(inspected.actions.reconcile.available).toBe(true)
    expect(await rpc(RECONCILE, request)).toMatchObject({
      ok: true,
      result: { state: 'completed', view: { inspection: result.view.inspection } }
    })
    const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
    expect(
      await rpc(START, {
        ...startRequest,
        expectedDefinitionRevision: 2,
        idempotencyKey: 'new-target'
      })
    ).toMatchObject({ ok: false })
    expect(start).not.toHaveBeenCalled()
    expect(
      await rpc(INSPECT, {
        ...request,
        expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
      })
    ).toMatchObject({ ok: false })
    expect(await rpc(INSPECT, { ...request, runtimeId: 'foreign-runtime' })).toMatchObject({
      ok: false
    })
    installFakeAppEnvironment({ getPath: () => join(testState.dir, 'foreign-profile') })
    expect(await rpc(INSPECT, request)).toMatchObject({ ok: false })
    expect(await rpc(RECONCILE, request)).toMatchObject({ ok: false })
  })

  it('refuses a remote-frozen run even if its parent now has a local future target', async () => {
    const { env, rpc, runtime, published } = await setup()
    const { automationId } = env.createDefinitionOnly(
      coordinatedCreateInput({ projectId: 'repo-ssh' })
    )
    const remoteOwner = {
      selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 }
    } as const
    const creation = env.store.createCoordinatedAutomationRun({
      automationId,
      trigger: 'manual',
      scheduledFor: env.harness.clock.now(),
      expectedOwner: remoteOwner,
      expectedDefinitionRevision: 1
    })
    if (!creation.run) {
      throw new Error('Missing remote fixture run')
    }
    env.store.updateCoordinatedAutomation(
      automationId,
      { expectedDefinitionRevision: 1, projectId: 'repo-local' },
      { expectedOwner: remoteOwner, destination: { selector: { kind: 'self' } } }
    )
    const request = {
      runtimeId: runtime.getRuntimeId(),
      automationId,
      automationRunId: creation.run.id,
      expectedOwner: { selector: { kind: 'self' } }
    }
    const before = env.boundaries.length
    expect(await rpc(INSPECT, request)).toMatchObject({ ok: false })
    expect(await rpc(RECONCILE, request)).toMatchObject({ ok: false })
    expect(env.boundaries).toHaveLength(before)
    expect(published).toEqual([])
  })

  it('requires the exact frozen revision for an idempotency replay after a definition edit', async () => {
    const { runtime, env, rpc, startRequest, automationId } = await setup()
    const started = await runtime.startCoordinatedFakeRun(startRequest)
    env.store.updateCoordinatedAutomation(
      automationId,
      { expectedDefinitionRevision: 1, children: [child('replacement')] },
      { expectedOwner: startRequest.expectedOwner }
    )
    const create = vi.spyOn(env.store, 'createCoordinatedAutomationRun')
    expect(await rpc(START, { ...startRequest, expectedDefinitionRevision: 2 })).toMatchObject({
      ok: false
    })
    expect(
      await rpc(START, {
        ...startRequest,
        expectedDefinitionRevision: 1,
        idempotencyKey: 'stale-new-run'
      })
    ).toMatchObject({ ok: false })
    expect(create).not.toHaveBeenCalled()
    expect(await rpc(START, startRequest)).toMatchObject({
      ok: true,
      result: { created: false, view: { inspection: started.view.inspection } }
    })
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
  })

  it('refuses an older host without a live lifecycle contract before invoking it', async () => {
    const { runtime, service, env, rpc, startRequest } = await setup()
    const host = service.coordinatedRuns
    Object.defineProperty(host, 'availability', { value: { available: true }, configurable: true })
    const start = vi.spyOn(host, 'startManualRun')
    expect(runtime.getStatus().capabilities).not.toContain(FAKE)
    expect(await rpc(START, startRequest)).toMatchObject({ ok: false })
    expect(start).not.toHaveBeenCalled()
    expect(env.store.listAutomationRuns()).toEqual([])
    Reflect.deleteProperty(host, 'availability')
  })

  it('passes unavailable foreign progress through without repairing or inventing semantic evidence', async () => {
    const { runtime, env, startRequest, selection, published } = await setup()
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    const runId = result.view.inspection.automationRunId
    const progressStore = createFileCoordinatedRunProgressStore(
      join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)
    )
    const progress = progressStore.read(runId)
    if (!progress) {
      throw new Error('Missing fixture progress')
    }
    progressStore.write(
      { ...progress, sequence: progress.sequence + 1, automationId: 'foreign-parent' },
      progress.sequence
    )
    const before = progressStore.read(runId)
    const boundaries = env.boundaries.length
    published.length = 0
    const inspection = runtime.inspectCoordinatedRun(selection(runId)).view.inspection
    expect(inspection.progress.kind).toBe('unavailable')
    expect(inspection.stages[0].semantic.kind).toBe('unavailable')
    expect(inspection.stages[0].native.kind).toBe('available')
    expect(progressStore.read(runId)).toEqual(before)
    expect(env.boundaries).toHaveLength(boundaries)
    expect(published).toEqual([])
  })

  it('rechecks archive revocation inside a queued reconciliation before mutating', async () => {
    const { runtime, service, env, rpc, startRequest, automationId, selection, published } =
      await setup()
    const result = await runtime.startCoordinatedFakeRun(startRequest)
    const acquired = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const holding = service.runInAutomationLane(automationId, async () => {
      acquired.resolve()
      await release.promise
    })
    await acquired.promise
    const reconcile = vi.spyOn(service.coordinatedRuns, 'reconcileRun')
    const before = env.boundaries.length
    published.length = 0
    const pending = rpc(RECONCILE, selection(result.view.inspection.automationRunId))
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalled())
    env.store.archiveCoordinatedAutomation({
      automationId,
      expectedOwner: startRequest.expectedOwner
    })
    release.resolve()
    await holding
    expect(await pending).toMatchObject({ ok: false })
    expect(env.boundaries).toHaveLength(before)
    expect(published).toEqual([])
  })

  it('publishes no progress before durable completion or after a failed flush', async () => {
    const { runtime, env, rpc, startRequest, selection, published } = await setup()
    const started = await runtime.startCoordinatedFakeRun(startRequest)
    published.length = 0
    const pendingFlush = Promise.withResolvers<void>()
    const flush = vi
      .spyOn(env.store, 'flushPendingOrThrowAsync')
      .mockReturnValue(pendingFlush.promise)
    let replied = false
    const pending = rpc(RECONCILE, selection(started.view.inspection.automationRunId)).then(
      (result) => {
        replied = true
        return result
      }
    )
    await vi.waitFor(() => expect(flush).toHaveBeenCalled())
    expect(replied).toBe(false)
    expect(published).toEqual([])
    pendingFlush.resolve()
    expect(await pending).toMatchObject({ ok: true })
    expect(published).toEqual([{ reason: 'run', selector: { kind: 'self' } }])
    published.length = 0
    flush.mockRejectedValue(new Error('disk full'))
    expect(await rpc(RECONCILE, selection(started.view.inspection.automationRunId))).toMatchObject({
      ok: false
    })
    expect(published).toEqual([])
  })

  it('rejects unsupported actions without falling back to generic runNow', async () => {
    const { runtime, service, env, rpc, startRequest, selection } = await setup()
    const started = await runtime.startCoordinatedFakeRun(startRequest)
    const generic = vi.spyOn(service, 'runNow')
    const before = env.boundaries.length
    for (const method of [
      'automation.stopCoordinatedRun',
      'automation.retryCoordinatedRun',
      'automation.resolveCoordinatedRun'
    ]) {
      expect(await rpc(method, selection(started.view.inspection.automationRunId))).toMatchObject({
        ok: false
      })
    }
    expect(generic).not.toHaveBeenCalled()
    expect(env.boundaries).toHaveLength(before)
  })
})
