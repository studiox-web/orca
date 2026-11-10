import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import { setAppEnvironment } from '../../../src/shared/app-environment'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import type { AutomationService } from '../../../src/main/automations/service'
import { createRuntimeAutomationService } from '../../../src/main/automations/runtime-automation-service'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  type CoordinatedManualRunRequest,
  type CoordinatedRunHostInjection
} from '../../../src/main/automations/coordinated-automation-run-host-types'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { LOCAL_STAGE_EFFECT, RecoveryEnv } from './coordinated-automation-recovery-env'
import type { FakeEffectState } from './isolated-adapters'

/**
 * Real createRuntimeAutomationService + AutomationService over a RecoveryEnv. Test files mock
 * electron/telemetry themselves, call setupRunHostFixture() in beforeEach and
 * disposeRunHostFixture() in afterEach.
 */
export let env: RecoveryEnv
export const services: AutomationService[] = []
let activeProfileDirectory: string | null = null
export function selectActiveProfileDirectory(directory: string | null): void {
  activeProfileDirectory = directory
}

export function hostEnvironment(overrides: { isPackaged?: boolean; userData?: string } = {}) {
  setAppEnvironment({
    getPath: (name) => (name === 'userData' ? (overrides.userData ?? testState.dir) : tmpdir()),
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
    isPackaged: () => overrides.isPackaged ?? false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
}

export function runtimeFixture(): OrcaRuntimeService {
  const runtime = {
    setAutomationService: vi.fn(),
    notifyAutomationsChanged: vi.fn(),
    getAgentStatusRowsForPane: () => [],
    openedAgentSessionRecordStore: () => null,
    openAgentSessionRecordStore: async () => ({}),
    getTerminalHandleForPaneKey: () => null
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake-run path and an idle watcher touch only these runtime boundaries.
  return runtime as unknown as OrcaRuntimeService
}

export function injection(
  overrides: Partial<CoordinatedRunHostInjection> = {}
): CoordinatedRunHostInjection {
  return {
    capability: COORDINATED_FAKE_RUNS_CAPABILITY,
    profile: { kind: 'isolated_test', root: testState.dir },
    orchestrationDb: env.db,
    workerProvider: env.workerProvider(),
    clock: env.clock(),
    laneLocks: { tryAcquire: () => ({ acquired: true, release: () => {} }) },
    effects: { policy: 'fake', adapter: env.harness.effects },
    durableBoundary: env.boundaryHook(),
    ...overrides
  }
}

export const SELF = { selector: { kind: 'self' } } as const

export function startService(
  options: { injection?: CoordinatedRunHostInjection; headless?: boolean; start?: boolean } = {}
): AutomationService {
  const service = createRuntimeAutomationService({
    store: env.store,
    runtime: runtimeFixture(),
    headless: options.headless ?? false,
    activeProfileDirectory: () => activeProfileDirectory,
    coordinatedRuns: options.injection
  })
  services.push(service)
  if (options.start !== false) {
    service.start()
  }
  return service
}

/** Holds the parent lane so a call queues behind it; release() lets the queue drain. */
export function holdLane(service: AutomationService, automationId: string) {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  void service.runInAutomationLane(automationId, () => held)
  return { release }
}

/** Reads the host's profile-scoped progress directly, without claiming a generation. */
export function hostProgress(automationRunId: string) {
  return createFileCoordinatedRunProgressStore(
    join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)
  ).read(automationRunId)
}

export async function running(service: AutomationService) {
  await vi.waitFor(() => expect(service.coordinatedRuns.availability.state).toBe('running'))
}

export function request(automationId: string, key = 'manual-1'): CoordinatedManualRunRequest {
  return {
    automationId,
    expectedOwner: { selector: { kind: 'self' } },
    expectedDefinitionRevision: 1,
    idempotencyKey: key
  }
}

export function effectDefinition(): CoordinatedAutomationCreateInput {
  return coordinatedCreateInput({
    publicationPolicy: {
      allowExternalMutation: true,
      requireHumanDecisionForProduction: false,
      allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
    },
    children: [
      child('draft', { launchConfig: { maxRetries: 0 } }),
      child('stage', {
        dependencies: [{ childId: 'draft', condition: 'accepted' }],
        mutationClass: 'exclusive_writer',
        mutationLane: 'content',
        launchConfig: { maxRetries: 0 },
        stageAcceptance: { requiredEffects: [LOCAL_STAGE_EFFECT] }
      })
    ]
  })
}

export async function seedEffect(automationId: string, states: FakeEffectState[]) {
  // The effect id derives from the run id, which manual start creates; seed lazily from the stage worker.
  env.scripts.set('stage', async (identity) => {
    const effectId = env.effectId(identity.automationRunId, 'stage', LOCAL_STAGE_EFFECT)
    await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
    await env.harness.effects.script(effectId, states)
    return [{ type: 'report', result: env.report(identity) }]
  })
  return automationId
}

export function storeWriteCounts(automationId: string) {
  return {
    runs: env.store.listAutomationRuns(automationId).length,
    nativeRuns: env.db.listRuns().runs.length,
    progress: existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))
  }
}

export function enableSetting(enabled = true) {
  env.store.updateSettings({ experimentalCoordinatedAutomations: enabled })
}

export async function setupRunHostFixture(): Promise<void> {
  env = await RecoveryEnv.create()
  hostEnvironment()
  selectActiveProfileDirectory(testState.dir)
  enableSetting()
  for (const id of ['draft', 'review', 'stage', 'research', 'writer']) {
    env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
  }
}

export async function disposeRunHostFixture(): Promise<void> {
  for (const service of services.splice(0)) {
    service.stop()
  }
  await env.dispose()
}
