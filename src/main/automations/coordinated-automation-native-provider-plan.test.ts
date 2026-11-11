import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { OrchestrationDb } from '../runtime/orchestration/db'
import type { ChildLaunchConfig } from '../../shared/coordinated-automation-types'
import { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import {
  COORDINATED_NATIVE_PROVIDER_CAPABILITY,
  planCoordinatedNativeProviderLaunch,
  type CoordinatedNativeProviderHostFacts,
  type CoordinatedNativeWorkspaceAuthority
} from './coordinated-automation-native-provider-plan'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => null }))

const WORKSPACE = 'folder:workspace-1'
const FROZEN: ChildLaunchConfig = {
  agentId: 'claude',
  model: 'frozen-model',
  reasoningEffort: 'high',
  surface: 'terminal',
  extraAgentArgs: '',
  reuseSession: false,
  workspaceMode: 'existing',
  workspaceId: WORKSPACE,
  baseBranch: null,
  setupDecision: 'skip',
  timeoutSeconds: 90,
  maxRetries: 1,
  maxReviewIterations: 0
}

function hostFacts(
  overrides: Partial<CoordinatedNativeProviderHostFacts> = {},
  authority: CoordinatedNativeWorkspaceAuthority = { kind: 'local_folder' }
): CoordinatedNativeProviderHostFacts {
  return {
    hostKind: 'local_desktop',
    workspaceAuthority: () => authority,
    launchSupport: () => ({ supported: true }),
    ...overrides
  }
}

describe('guarded normal-provider launch planning', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-provider-plan-'))
    writeDataFile(
      coordinatedTestState({
        repos: [
          {
            id: 'repo-local',
            path: testState.dir,
            displayName: 'L',
            badgeColor: '#000',
            addedAt: 1
          }
        ]
      })
    )
    db = new OrchestrationDb(':memory:')
  })

  afterEach(async () => {
    db.close()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  async function frozenRun(
    launchConfig: ChildLaunchConfig = FROZEN,
    host?: CoordinatedNativeProviderHostFacts
  ) {
    const store = createStore()
    const provider = vi.fn(async () => ({}))
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      nativeProviderHost: host,
      workerProvider: { capability: 'fake_no_effects', run: provider }
    })
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({ children: [child('writer', { launchConfig })] })
    )
    const created = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const run = await adapter.materializeRun(created.run!.id)
    const taskId = run.childMappings![0].taskId
    const snapshot = run.resolvedSnapshot!
    return { adapter, run, taskId, snapshot, child: snapshot.resolvedChildren[0], provider }
  }

  it('carries every frozen launch value into the existing worker-start inputs unchanged', async () => {
    const { snapshot, child: frozen, taskId } = await frozenRun()
    const planning = planCoordinatedNativeProviderLaunch({
      snapshot,
      child: frozen,
      taskId,
      host: hostFacts()
    })
    expect(planning).toEqual({
      kind: 'planned',
      plan: {
        capability: COORDINATED_NATIVE_PROVIDER_CAPABILITY,
        childDefinitionId: 'writer',
        workspaceKind: 'local_folder',
        workerStart: {
          task: taskId,
          worktree: `id:${WORKSPACE}`,
          agent: 'claude',
          model: 'frozen-model',
          effort: 'high',
          setup: 'skip',
          timeoutMs: 90_000
        }
      }
    })
  })

  it.each<
    [string, Partial<CoordinatedNativeProviderHostFacts>, CoordinatedNativeWorkspaceAuthority]
  >([
    ['host_not_local_desktop', { hostKind: 'headless_daemon' }, { kind: 'local_folder' }],
    ['host_not_local_desktop', { hostKind: 'remote_server' }, { kind: 'local_folder' }],
    ['host_not_local_desktop', { hostKind: 'mobile_client' }, { kind: 'local_folder' }],
    ['workspace_not_local', {}, { kind: 'ssh', connectionId: 'conn-1' }],
    ['workspace_not_local', {}, { kind: 'wsl' }],
    ['workspace_not_local', {}, { kind: 'remote_host', hostId: 'host-2' }],
    ['workspace_unresolved', {}, { kind: 'missing' }],
    ['workspace_unresolved', {}, { kind: 'archived' }],
    [
      'launch_unsupported',
      { launchSupport: () => ({ supported: false, reason: 'model frozen-model is unavailable' }) },
      { kind: 'local_folder' }
    ]
  ])(
    'refuses on host authority (%s) instead of guessing a local path or substitute',
    async (code, facts, authority) => {
      const { snapshot, child: frozen, taskId } = await frozenRun()
      expect(
        planCoordinatedNativeProviderLaunch({
          snapshot,
          child: frozen,
          taskId,
          host: hostFacts(facts, authority)
        })
      ).toMatchObject({ kind: 'refused', code })
    }
  )

  it.each<[string, Partial<ChildLaunchConfig>]>([
    ['surface_unsupported', { surface: 'chat' }],
    ['session_reuse_unsupported', { reuseSession: true }],
    ['extra_args_unsupported', { extraAgentArgs: '--dangerous' }],
    ['workspace_mode_unsupported', { workspaceMode: 'new_per_run', baseBranch: 'main' }]
  ])('refuses a frozen configuration it cannot honor exactly (%s)', async (code, override) => {
    const { snapshot, child: frozen, taskId } = await frozenRun({ ...FROZEN, ...override })
    expect(
      planCoordinatedNativeProviderLaunch({ snapshot, child: frozen, taskId, host: hostFacts() })
    ).toMatchObject({ kind: 'refused', code })
  })

  it('stops a fully plannable launch before any Dispatch, process or provider call', async () => {
    const { adapter, run, taskId, provider } = await frozenRun(FROZEN, hostFacts())
    await expect(adapter.dispatchTask(run.id, taskId)).rejects.toThrow(
      /coordinated_native_provider_execution_not_authorized/
    )
    expect(db.getDispatchContext(taskId)).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })

  it('surfaces the exact refusal for an unplannable launch, also before any Dispatch', async () => {
    const { adapter, run, taskId, provider } = await frozenRun(
      FROZEN,
      hostFacts({}, { kind: 'ssh', connectionId: 'conn-1' })
    )
    await expect(adapter.dispatchTask(run.id, taskId)).rejects.toThrow(/workspace_not_local/)
    expect(db.getDispatchContext(taskId)).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })

  it('leaves the fake no-process path untouched when no provider host is present', async () => {
    const { adapter, run, taskId, provider } = await frozenRun()
    await adapter.dispatchTask(run.id, taskId)
    expect(provider).toHaveBeenCalledTimes(1)
  })
})
