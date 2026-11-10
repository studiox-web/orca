import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { CoordinatedHostStoppedError } from '../../../src/main/automations/coordinated-automation-recovery-context'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  CoordinatedRunHostRefusedError,
  type CoordinatedManualRunRequest,
  type CoordinatedRunHostInjection
} from '../../../src/main/automations/coordinated-automation-run-host-types'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import type { ScriptedWorkerAction } from './isolated-adapters'
import {
  InjectedCoordinatorCrash,
  LOCAL_STAGE_EFFECT,
  RecoveryEnv
} from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let env: RecoveryEnv
const services: AutomationService[] = []

function hostEnvironment(overrides: { isPackaged?: boolean; userData?: string } = {}) {
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

function runtimeFixture(): OrcaRuntimeService {
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

function injection(
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

function startService(
  options: { injection?: CoordinatedRunHostInjection; headless?: boolean } = {}
): AutomationService {
  const service = createRuntimeAutomationService({
    store: env.store,
    runtime: runtimeFixture(),
    headless: options.headless ?? false,
    coordinatedRuns: options.injection
  })
  services.push(service)
  service.start()
  return service
}

function request(automationId: string, key = 'manual-1'): CoordinatedManualRunRequest {
  return {
    automationId,
    expectedOwner: { selector: { kind: 'self' } },
    expectedDefinitionRevision: 1,
    idempotencyKey: key
  }
}

function effectDefinition(): CoordinatedAutomationCreateInput {
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

async function seedEffect(automationId: string, states: ('verified' | 'uncertain')[]) {
  // The effect id derives from the run id, which manual start creates; seed lazily from the stage worker.
  env.scripts.set('stage', async (identity) => {
    const effectId = env.effectId(identity.automationRunId, 'stage', LOCAL_STAGE_EFFECT)
    await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
    await env.harness.effects.script(effectId, states)
    return [{ type: 'report', result: env.report(identity) }]
  })
  return automationId
}

function storeWriteCounts(automationId: string) {
  return {
    runs: env.store.listAutomationRuns(automationId).length,
    nativeRuns: env.db.listRuns().runs.length,
    progress: existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))
  }
}

beforeEach(async () => {
  env = await RecoveryEnv.create()
  hostEnvironment()
  for (const id of ['draft', 'review', 'stage', 'research', 'writer']) {
    env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
  }
})

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop()
  }
  await env.dispose()
})

describe('coordinated run host through the runtime automation service', () => {
  it('collapses duplicate manual starts into one run and one mapping set', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const [first, second] = await Promise.all([
      service.coordinatedRuns.startManualRun(request(automationId)),
      service.coordinatedRuns.startManualRun(request(automationId))
    ])
    expect([first.created, second.created]).toEqual([true, false])
    expect(second.automationRunId).toBe(first.automationRunId)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
    expect(first.state).toBe('completed')
    expect(second.inspection.stages.map((s) => s.mappedDispatchId)).toEqual(
      first.inspection.stages.map((s) => s.mappedDispatchId)
    )
    expect(env.dispatchIds(first.automationRunId, 'research')).toHaveLength(1)
    expect(second.inspection.receipt.kind).toBe('available')
    expect(second.inspection.stages[0].sessionTarget.kind).toBe('unavailable')
    expect(second.inspection.humanResolution.available).toBe(false)
  })

  it('restart on the same Store, SQLite, and progress keeps IDs and receipt without new effects', async () => {
    const automationId = await seedEffect(
      env.createDefinitionOnly(effectDefinition()).automationId,
      ['verified']
    )
    const first = await startService({ injection: injection() }).coordinatedRuns.startManualRun(
      request(automationId)
    )
    expect(first.state).toBe('completed')
    const effectId = env.effectId(first.automationRunId, 'stage', LOCAL_STAGE_EFFECT)

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    const restarted = startService({ injection: injection() })
    const replay = await restarted.coordinatedRuns.startManualRun(request(automationId))
    expect(replay.created).toBe(false)
    expect(replay.automationRunId).toBe(first.automationRunId)
    expect(replay.inspection.receipt).toEqual(first.inspection.receipt)
    expect(replay.inspection.stages.map((s) => [s.taskId, s.mappedDispatchId])).toEqual(
      first.inspection.stages.map((s) => [s.taskId, s.mappedDispatchId])
    )
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
  })

  it('startup recovery finishes an interrupted run before admitting manual work', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    env.crashAt('report.after-native-settle')
    await expect(
      startService({ injection: injection() }).coordinatedRuns.startManualRun(request(automationId))
    ).rejects.toThrow(InjectedCoordinatorCrash)
    const [run] = env.store.listAutomationRuns(automationId)
    expect(run.status).not.toBe('completed')

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    const restarted = startService({ injection: injection() })
    const inspected = await restarted.coordinatedRuns.startManualRun(request(automationId))
    expect(inspected).toMatchObject({ created: false, state: 'completed' })
    expect(inspected.automationRunId).toBe(run.id)
    expect(env.dispatchIds(run.id, 'research')).toHaveLength(1)
  })

  it('keeps uncertain holds non-final and unchanged across restart', async () => {
    const automationId = await seedEffect(
      env.createDefinitionOnly(effectDefinition()).automationId,
      ['uncertain']
    )
    const first = await startService({ injection: injection() }).coordinatedRuns.startManualRun(
      request(automationId)
    )
    expect(first.state).toBe('outcome_uncertain')
    expect(first.inspection.runStatus).toBe('dispatched')
    const effectId = env.effectId(first.automationRunId, 'stage', LOCAL_STAGE_EFFECT)

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    const again = await startService({ injection: injection() }).coordinatedRuns.reconcileRun(
      first.automationRunId
    )
    expect(again.state).toBe('outcome_uncertain')
    expect(again.inspection.runStatus).toBe('dispatched')
    expect(again.inspection.runError).toBe(first.inspection.runError)
    expect(again.inspection.receipt.kind).toBe('absent')
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
  })

  it('stop fences an in-flight attempt and refuses further dispatch', async () => {
    let release: (actions: ScriptedWorkerAction[]) => void = () => {}
    env.scripts.set('research', () => new Promise((resolve) => (release = resolve)))
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const service = startService({ injection: injection() })
    const pending = service.coordinatedRuns.startManualRun(request(automationId))
    await vi.waitFor(() => expect(env.store.listAutomationRuns(automationId)).toHaveLength(1))
    const [run] = env.store.listAutomationRuns(automationId)
    await vi.waitFor(() => expect(env.dispatchIds(run.id, 'research')).toHaveLength(1))

    service.stop()
    release([
      {
        type: 'report',
        result: env.report({
          automationRunId: run.id,
          orchestrationRunId: env.run(run.id).orchestrationRunId!,
          childDefinitionId: 'research',
          taskId: env.taskId(run.id, 'research'),
          dispatchId: env.dispatchIds(run.id, 'research')[0]
        })
      }
    ])
    await expect(pending).rejects.toThrow(CoordinatedHostStoppedError)
    expect(env.dispatchIds(run.id, 'writer')).toHaveLength(0)
    await expect(
      service.coordinatedRuns.startManualRun(request(automationId, 'manual-2'))
    ).rejects.toThrow(CoordinatedRunHostRefusedError)
  })
})

describe('coordinated run host refusals happen before any write', () => {
  async function expectRefused(service: AutomationService, automationId: string) {
    const before = storeWriteCounts(automationId)
    expect(service.coordinatedRuns.availability.available).toBe(false)
    await expect(service.coordinatedRuns.startManualRun(request(automationId))).rejects.toThrow(
      CoordinatedRunHostRefusedError
    )
    expect(storeWriteCounts(automationId)).toEqual(before)
    expect(before.progress).toBe(false)
  }

  it('is unavailable by default', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService(), automationId)
  })

  it('refuses packaged builds', async () => {
    hostEnvironment({ isPackaged: true })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService({ injection: injection() }), automationId)
  })

  it('refuses a foreign profile root', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const foreign = mkdtempSync(join(tmpdir(), 'orca-foreign-profile-'))
    await expectRefused(
      startService({ injection: injection({ profile: { kind: 'isolated_test', root: foreign } }) }),
      automationId
    )
  })

  it('refuses headless and remote hosts', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService({ injection: injection(), headless: true }), automationId)
  })

  it('refuses real providers', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const provider = { ...env.workerProvider(), capability: 'claude' }
    await expectRefused(
      startService({ injection: injection({ workerProvider: provider }) }),
      automationId
    )
  })

  // Enabled coordinated definitions are already refused by the Store at creation.
  it('refuses remote-target and non-self-owner requests before any write', async () => {
    const service = startService({ injection: injection() })
    const remote = env.createDefinitionOnly(coordinatedCreateInput({ projectId: 'repo-ssh' }))
    const local = env.createDefinitionOnly(coordinatedCreateInput())
    for (const [automationId, req] of [
      [remote.automationId, request(remote.automationId)],
      [
        local.automationId,
        {
          ...request(local.automationId),
          expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
        }
      ]
    ] as const) {
      const before = env.store.listAutomationRuns(automationId).length
      await expect(service.coordinatedRuns.startManualRun(req)).rejects.toThrow(
        CoordinatedRunHostRefusedError
      )
      expect(env.store.listAutomationRuns(automationId)).toHaveLength(before)
    }
  })

  it('leaves retained coordinated runs untouched and the legacy runNow route refused by default', async () => {
    const { automationId, runId } = env.createRun(coordinatedCreateInput())
    const service = startService()
    expect(env.run(runId).status).toBe('pending')
    expect(existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))).toBe(false)
    await expect(service.runNow(automationId)).rejects.toThrow()
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
  })
})
