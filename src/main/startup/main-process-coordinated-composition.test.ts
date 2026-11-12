import '../runtime/rpc/unused-default-rpc-methods.test-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { createIsolatedCoordinatedAppComposition } from '../../../tests/e2e/coordinated-automation-harness/coordinated-app-composition'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { _resetTerminalModelQueryAuthorityForTest } from '../runtime/terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from '../runtime/terminal-view-attribute-store'
import * as invalidators from '../ipc/worktree-change-invalidators'
import { initializeMainProcessAutomations } from './main-process-automations'
import type { AutomationService } from '../automations/service'
import { registerXosGoalHandlers } from '../xos/xos-goal-ipc'

const startup = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { state }
})
vi.mock('./main-process-state', () => ({ mainProcessState: startup.state }))
vi.mock('../xos/xos-goal-ipc', () => ({ registerXosGoalHandlers: vi.fn() }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let root = ''
const runtimes: OrcaRuntimeService[] = []
const services: AutomationService[] = []
const disposers: (() => void)[] = []

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop()
  }
  for (const runtime of runtimes.splice(0)) {
    runtime.getExistingOrchestrationDb()?.close()
  }
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  await closeTestStores()
  vi.restoreAllMocks()
  _resetTerminalModelQueryAuthorityForTest()
  _resetTerminalViewAttributesForTest()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = ''
})

function setup() {
  root = mkdtempSync(join(tmpdir(), 'orca-coordinated-composition-'))
  const home = join(root, 'home')
  testState.dir = join(root, 'profiles', 'local')
  mkdirSync(home)
  mkdirSync(testState.dir, { recursive: true })
  writeDataFile(coordinatedTestState())
  const store = createStore()
  installFakeAppEnvironment({ getPath: () => root })
  const environment = {
    isPackaged: () => false,
    userDataDirectory: () => root,
    homeDirectory: () => home,
    backgroundLaunch: () => true
  }
  const compose = createIsolatedCoordinatedAppComposition({
    userDataDirectory: root,
    homeDirectory: home,
    environment
  })
  return { store, compose, environment }
}

it('keeps ordinary startup unconfigured and uses only the selected singleton service when opted in', async () => {
  const { store, compose } = setup()
  store.updateSettings({ experimentalCoordinatedAutomations: true })
  const composition = compose({ store, headless: false })
  const registration = vi.spyOn(invalidators, 'registerWorktreeChangeInvalidator')
  const runtime = new OrcaRuntimeService(store, undefined, {
    coordinatedDefinitionWrites: composition.coordinatedDefinitionWrites
  })
  runtimes.push(runtime)
  for (const result of registration.mock.results) {
    if (result.type === 'return') {
      disposers.push(result.value)
    }
  }
  Object.assign(startup.state, {
    store,
    runtime,
    claudeUsage: {},
    codexUsage: {},
    isServeMode: false,
    activeOrcaProfile: { profileDirectory: testState.dir }
  })
  const register = vi.spyOn(runtime, 'setAutomationService')
  const ordinary = initializeMainProcessAutomations()
  services.push(ordinary)
  expect(registerXosGoalHandlers).toHaveBeenCalledWith(store, runtime)
  expect(ordinary.coordinatedRuns.availability).toMatchObject({
    available: false,
    state: 'unconfigured'
  })
  ordinary.stop()
  const injection = composition.coordinatedRuns!({ store, runtime })
  expect(injection.orchestrationDb).toBe(runtime.getOrchestrationDb())
  expect(injection.effects).toEqual({ policy: 'deny' })
  expect(injection.workerProvider?.capability).toBe('fake_no_effects')
  const service = initializeMainProcessAutomations(injection)
  services.push(service)
  expect(startup.state.automations).toBe(service)
  expect(register.mock.calls.map(([service]) => service)).toEqual([ordinary, service])
  expect(service.coordinatedRuns.availability.state).toBe('not_started')
  const automation = store.createCoordinatedAutomation(
    coordinatedCreateInput({ children: [child('read')] })
  )
  const pending = store.createCoordinatedAutomationRun({
    automationId: automation.id,
    trigger: 'manual',
    scheduledFor: 1,
    idempotencyKey: 'bootstrap',
    expectedOwner: { selector: { kind: 'self' } },
    expectedDefinitionRevision: 1
  })
  expect(pending.run?.status).toBe('pending')
  await store.flushPendingOrThrowAsync()
  service.start()
  expect(service.coordinatedRuns.availability.state).toBe('recovering')
  await vi.waitFor(() => expect(service.coordinatedRuns.availability.state).toBe('running'))
  const result = await runtime.startCoordinatedFakeRun({
    runtimeId: runtime.getRuntimeId(),
    automationId: automation.id,
    expectedOwner: { selector: { kind: 'self' } },
    expectedDefinitionRevision: 1,
    idempotencyKey: 'bootstrap'
  })
  expect(result.created).toBe(false)
  expect(result.view.inspection.automationRunId).toBe(pending.run?.id)
  expect(result.state).toBe('completed')
  expect(result.view.inspection.receipt.kind).toBe('available')
  expect(result.view.inspection.stages[0].sessionTarget.kind).toBe('unavailable')
  service.stop()
  expect(runtime.getStatus().coordinatedFakeRuns).toMatchObject({
    available: false,
    state: 'stopped'
  })
})

it.each(['packaged', 'headless', 'visible', 'foreign-home', 'foreign-userData'])(
  'refuses %s composition before opening a runtime or writing settings',
  (reason) => {
    const { store, compose, environment } = setup()
    if (reason === 'packaged') {
      environment.isPackaged = () => true
    }
    if (reason === 'visible') {
      environment.backgroundLaunch = () => false
    }
    if (reason === 'foreign-home') {
      environment.homeDirectory = () => root
    }
    if (reason === 'foreign-userData') {
      environment.userDataDirectory = () => testState.dir
    }
    const before = store.getSettings()
    expect(() => compose({ store, headless: reason === 'headless' })).toThrow(/isolated hidden/)
    expect(store.getSettings()).toEqual(before)
    expect(store.listAutomationRuns()).toEqual([])
  }
)
