import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { getAppEnvironment } from '../../shared/app-environment'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../shared/automation-runtime-capabilities'
import { testState } from '../persistence/persistence-test-harness'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { COORDINATED_FAKE_RUNS_CAPABILITY } from '../automations/coordinated-automation-run-host-types'
import { OrcaRuntimeService } from './orca-runtime'
import { createCoordinatedRunRpcFixture } from './coordinated-run-rpc.test-support'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined
async function setup(options: Parameters<typeof createCoordinatedRunRpcFixture>[0] = {}) {
  fixture = await createCoordinatedRunRpcFixture({ nestedProfile: true, ...options })
  return fixture
}
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

it('admits the independently selected nested profile rather than the outer Electron userData', async () => {
  const { env, runtime, startRequest } = await setup()
  expect(testState.dir).toBe(join(env.harness.root, 'profiles', 'local'))
  expect(env.store.getProfileStorageDirectory()).toBe(testState.dir)
  expect(getAppEnvironment().getPath('userData')).toBe(env.harness.root)
  const result = await runtime.startCoordinatedFakeRun(startRequest)
  expect(result.state).toBe('completed')
  expect(result.view.inspection.receipt.kind).toBe('available')
})

it.each(['missing', 'sibling', 'outer-root'])(
  'refuses %s selected profile authority even when injection exactly matches the Store',
  async (authority) => {
    const { env, runtime, rpc, service, startRequest, selectActiveProfile } = await setup(
      authority === 'missing' ? { activeProfileDirectory: null } : {}
    )
    if (authority === 'sibling') {
      const sibling = join(env.harness.root, 'profiles', 'sibling')
      mkdirSync(sibling)
      selectActiveProfile(sibling)
    } else if (authority === 'outer-root') {
      selectActiveProfile(env.harness.root)
    }
    const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
    expect(runtime.getStatus().capabilities).not.toContain(FAKE)
    expect(await rpc('automation.startCoordinatedFakeRun', startRequest)).toMatchObject({
      ok: false
    })
    expect(start).not.toHaveBeenCalled()
    expect(env.store.listAutomationRuns()).toEqual([])
    expect(env.boundaries).toEqual([])
  }
)

it.each(['sibling', 'revoked'])(
  'rechecks a %s selection after waiting for the parent lane',
  async (change) => {
    const { env, runtime, service, startRequest, selectActiveProfile, automationId } = await setup()
    const acquired = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const held = service.runInAutomationLane(automationId, async () => {
      acquired.resolve()
      await release.promise
    })
    await acquired.promise
    const start = vi.spyOn(service.coordinatedRuns, 'startManualRun')
    const pending = runtime.startCoordinatedFakeRun(startRequest)
    const refused = expect(pending).rejects.toThrow(/profile/i)
    try {
      await vi.waitFor(() => expect(start).toHaveBeenCalled())
      const sibling = join(env.harness.root, 'profiles', 'next')
      mkdirSync(sibling)
      selectActiveProfile(change === 'sibling' ? sibling : null)
    } finally {
      release.resolve()
    }
    await held
    await refused
    expect(env.store.listAutomationRuns()).toEqual([])
    expect(env.boundaries).toEqual([])
  }
)

it('recovers the same nested profile through a replacement runtime and service', async () => {
  const { env, runtime, service, startRequest, automationId } = await setup()
  const initial = await runtime.startCoordinatedFakeRun(startRequest)
  service.stop()
  await env.reopen()
  installFakeAppEnvironment({ getPath: () => env.harness.root })
  const replacement = new OrcaRuntimeService(env.store, undefined, {
    coordinatedDefinitionWrites: { profileDirectory: testState.dir }
  })
  const next = createRuntimeAutomationService({
    store: env.store,
    runtime: replacement,
    headless: false,
    activeProfileDirectory: () => testState.dir,
    coordinatedRuns: {
      capability: COORDINATED_FAKE_RUNS_CAPABILITY,
      profile: { kind: 'isolated_test', root: testState.dir },
      orchestrationDb: env.db,
      workerProvider: env.workerProvider(),
      clock: env.clock(),
      laneLocks: { tryAcquire: () => ({ acquired: false, holder: 'read-only fixture' }) },
      effects: { policy: 'deny' }
    }
  })
  try {
    next.start()
    await vi.waitFor(() => expect(next.coordinatedRuns.availability.state).toBe('running'))
    const replay = await replacement.startCoordinatedFakeRun({
      ...startRequest,
      runtimeId: replacement.getRuntimeId()
    })
    expect(replay.created).toBe(false)
    expect(replay.view.inspection).toEqual(initial.view.inspection)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
  } finally {
    next.stop()
  }
})
