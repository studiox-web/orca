import './rpc/unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import {
  closeTestStores,
  createSqliteTestStore,
  readPersistedState
} from '../persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { Store } from '../persistence/loading-store/store'
import { initDataPath } from '../persistence/loading-store/user-data-path'
import { OrcaRuntimeService } from './orca-runtime'
import { RpcDispatcher } from './rpc/dispatcher'
import type { RpcDispatchStreamingOptions } from './rpc/dispatcher-stream-options'
import { AUTOMATION_METHODS } from './rpc/methods/automations'
import { COORDINATED_AUTOMATION_METHODS } from './rpc/methods/coordinated-automations'
import { COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY as CAPABILITY } from '../../shared/automation-runtime-capabilities'
import {
  CoordinatedAutomationCreateRequest,
  type RuntimeCoordinatedAutomationCreateInput
} from '../../shared/rpc-contract/coordinated-automation-params'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'
import type { AutomationsChangedPayload } from '../../shared/runtime-client-events'
import type { Repo } from '../../shared/repo-types'
import * as worktreeChangeInvalidators from '../ipc/worktree-change-invalidators'
import { _resetTerminalModelQueryAuthorityForTest } from './terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from './terminal-view-attribute-store'

const testState = { dir: '' }
let registrationSpy: MockInstance<
  typeof worktreeChangeInvalidators.registerWorktreeChangeInvalidator
>
const SELF = { selector: { kind: 'self' } } as const

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

function input(overrides: Partial<RuntimeCoordinatedAutomationCreateInput> = {}) {
  const { projectId, workspaceId: _workspaceId, ...definition } = coordinatedCreateInput()
  return CoordinatedAutomationCreateRequest.parse({
    ...definition,
    repo: `id:${projectId}`,
    destination: SELF,
    inheritedDefaults: { agentId: 'claude', model: 'parent-model', timeoutSeconds: 180 },
    globalCeilings: { maxConcurrency: 2, maxWallClockSeconds: 600 },
    publicationPolicy: {
      allowExternalMutation: false,
      allowedFinalStates: ['completed', 'failed'],
      requireHumanDecisionForProduction: true
    },
    retentionPolicy: {
      preserveCompletionReceipt: true,
      preserveSnapshot: true,
      preserveMappings: true
    },
    ...overrides
  })
}

function fixture(
  options: {
    optIn?: boolean
    flag?: boolean
    profileDirectory?: string
    authority?: 'desktop' | 'runtime'
  } = {}
) {
  const state = coordinatedTestState()
  state.settings.experimentalCoordinatedAutomations = options.flag ?? true
  const dataFile = join(testState.dir, 'orca-data.json')
  writeFileSync(dataFile, JSON.stringify(state))
  initDataPath()
  const store = createSqliteTestStore(Store, { dataFile, storageAuthority: options.authority })
  const runtime = new OrcaRuntimeService(
    store,
    undefined,
    options.optIn === false
      ? undefined
      : {
          coordinatedDefinitionWrites: {
            profileDirectory: options.profileDirectory ?? store.getProfileStorageDirectory()
          }
        }
  )
  const published: AutomationsChangedPayload[] = []
  vi.spyOn(runtime, 'notifyAutomationsChanged').mockImplementation((payload = {}) => {
    published.push(payload)
  })
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...AUTOMATION_METHODS, ...COORDINATED_AUTOMATION_METHODS]
  })
  const rpc = (method: string, params: unknown, transport?: RpcDispatchStreamingOptions) =>
    dispatcher.dispatch({ id: 'request', authToken: 'fixture', method, params }, transport)
  return { store, runtime, published, rpc, dataFile }
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'coordinated-definition-rpc-'))
  installFakeAppEnvironment({ getPath: (name) => (name === 'userData' ? testState.dir : tmpdir()) })
  registrationSpy = vi.spyOn(worktreeChangeInvalidators, 'registerWorktreeChangeInvalidator')
})

afterEach(async () => {
  const disposers = registrationSpy.mock.results.flatMap((result) =>
    result.type === 'return' ? [result.value] : []
  )
  vi.restoreAllMocks()
  try {
    await closeTestStores()
  } finally {
    for (const dispose of disposers) {
      dispose()
    }
    _resetTerminalModelQueryAuthorityForTest()
    _resetTerminalViewAttributesForTest()
    rmSync(testState.dir, { recursive: true, force: true })
  }
})

describe('coordinated definition RPC capability', () => {
  it.each([
    { label: 'no host opt-in', optIn: false },
    { label: 'setting off', flag: false },
    { label: 'another profile', profileDirectory: join(tmpdir(), 'not-this-profile') },
    { label: 'remote storage authority', authority: 'runtime' as const }
  ])('refuses $label before a write, irrespective of client capability', async (options) => {
    const { store, runtime, rpc, published } = fixture(options)
    const write = vi.spyOn(store, 'createCoordinatedAutomation')
    expect(runtime.getStatus().capabilities).not.toContain(CAPABILITY)
    expect(
      await rpc('automation.createCoordinated', input(), { clientCapabilities: [CAPABILITY] })
    ).toMatchObject({ ok: false })
    expect(write).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([])
    expect(published).toEqual([])
  })

  it.each([
    'coordinatedAutomationDefinitionAuthority',
    'createCoordinatedAutomation',
    'updateCoordinatedAutomation',
    'flushPendingOrThrowAsync'
  ] as const)('refuses an older Store missing %s before any write', async (missing) => {
    const { store, runtime, rpc } = fixture()
    const original = store[missing]
    Object.defineProperty(store, missing, { value: undefined, configurable: true })
    try {
      expect(runtime.getStatus().capabilities).not.toContain(CAPABILITY)
      expect(await rpc('automation.createCoordinated', input())).toMatchObject({ ok: false })
      expect(store.listAutomations()).toEqual([])
    } finally {
      Object.defineProperty(store, missing, { value: original, configurable: true })
    }
  })

  it('advertises only when opted in and refuses packaged hosts', async () => {
    const { store, runtime, rpc } = fixture()
    expect(runtime.getStatus().capabilities).toContain(CAPABILITY)
    installFakeAppEnvironment({ getPath: () => testState.dir, isPackaged: () => true })
    expect(runtime.getStatus().capabilities).not.toContain(CAPABILITY)
    expect(await rpc('automation.createCoordinated', input())).toMatchObject({ ok: false })
    expect(store.listAutomations()).toEqual([])
  })

  it.each([
    { clientKind: 'runtime' as const },
    { caller: { kind: 'paired-device' as const, deviceId: 'remote-device' } }
  ])('rejects unknown or paired callers before the runtime write', async (transport) => {
    const { runtime, rpc, store } = fixture()
    const write = vi.spyOn(runtime, 'createCoordinatedAutomation')
    expect(await rpc('automation.createCoordinated', input(), transport)).toMatchObject({
      ok: false
    })
    expect(write).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([])
  })

  it('refuses headless authority even with desktop storage and constructor opt-in', async () => {
    const { runtime, rpc, store } = fixture()
    runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID, { tabs: [], leaves: [] })
    expect(runtime.getStatus().capabilities).not.toContain(CAPABILITY)
    expect(await rpc('automation.createCoordinated', input())).toMatchObject({ ok: false })
    expect(store.listAutomations()).toEqual([])
  })

  it.each(['runtime authority', 'experimental setting'])(
    'rechecks revoked %s after asynchronous target resolution',
    async (gate) => {
      const { runtime, rpc, store, published } = fixture()
      const target = Promise.withResolvers<Repo>()
      vi.spyOn(runtime, 'showRepo').mockReturnValue(target.promise)
      const pending = rpc('automation.createCoordinated', input())
      await vi.waitFor(() => expect(runtime.showRepo).toHaveBeenCalled())
      if (gate === 'runtime authority') {
        runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID, { tabs: [], leaves: [] })
      } else {
        store.updateSettings({ experimentalCoordinatedAutomations: false })
      }
      target.resolve(coordinatedTestState().repos[0])
      expect(await pending).toMatchObject({ ok: false })
      expect(store.listAutomations()).toEqual([])
      expect(published).toEqual([])
    }
  )
})

describe('coordinated definition persistence through runtime transport', () => {
  it('saves, updates and reloads full definitions with stable child ids and inherited settings', async () => {
    const { rpc, runtime, store, published, dataFile } = fixture()
    const request = input({ creationKey: 'one-parent' })
    expect(await rpc('automation.createCoordinated', request)).toMatchObject({
      ok: true,
      result: { automation: { definitionRevision: 1, enabled: false } }
    })
    const created = store.listAutomations()[0]
    expect(await rpc('automation.createCoordinated', request)).toMatchObject({
      ok: true,
      result: { automation: { id: created.id } }
    })
    expect(store.listAutomations()).toHaveLength(1)
    const children = [
      child('research', {
        role: 'editor',
        promptSource: { kind: 'inline', text: 'Review the draft.' },
        launchConfig: { model: 'child-model', provenance: { model: 'overridden' } }
      }),
      request.children[1]
    ]
    expect(
      await rpc('automation.updateCoordinated', {
        id: created.id,
        expectedOwner: SELF,
        updates: { expectedDefinitionRevision: 1, children }
      })
    ).toMatchObject({
      ok: true,
      result: { automation: { id: created.id, definitionRevision: 2, enabled: false } }
    })
    const updated = runtime.showAutomation(created.id)
    expect(updated).toMatchObject({
      children,
      inheritedDefaults: request.inheritedDefaults,
      outcomeContract: request.outcomeContract,
      globalCeilings: request.globalCeilings,
      publicationPolicy: request.publicationPolicy,
      retentionPolicy: request.retentionPolicy
    })
    expect(published).toEqual(
      Array.from({ length: 3 }, () => ({ reason: 'definition', selector: { kind: 'self' } }))
    )
    const { launchSetup: _launchSetup, ...persisted } = updated
    expect(readPersistedState(dataFile).automations).toEqual([persisted])
    await closeTestStores()
    const reopened = createSqliteTestStore(Store, { dataFile })
    expect(reopened.listAutomations()).toEqual([updated])
    expect(reopened.listAutomationRuns()).toEqual([])
  })

  it('rejects stale revisions and owners before changing the saved definition', async () => {
    const { rpc, store, published } = fixture()
    await rpc('automation.createCoordinated', input())
    const created = store.listAutomations()[0]
    const update = {
      id: created.id,
      expectedOwner: SELF,
      updates: { expectedDefinitionRevision: 1, inheritedDefaults: { model: 'changed-model' } }
    }
    const results = await Promise.all([
      rpc('automation.updateCoordinated', update),
      rpc('automation.updateCoordinated', update)
    ])
    expect(results.map((result) => result.ok).sort()).toEqual([false, true])
    const saved = store.listAutomations()[0]
    expect(saved.definitionRevision).toBe(2)
    const writer = vi.spyOn(store, 'updateCoordinatedAutomation')
    expect(
      await rpc('automation.updateCoordinated', {
        ...update,
        expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } },
        updates: { expectedDefinitionRevision: 2, name: 'Wrong owner' }
      })
    ).toMatchObject({ ok: false })
    expect(writer).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([saved])
    expect(published).toHaveLength(2)
  })

  it.each(['automation.createCoordinated', 'automation.updateCoordinated'])(
    'holds the response and notification until %s is durable',
    async (method) => {
      const { rpc, store, published } = fixture()
      const created = store.createCoordinatedAutomation(coordinatedCreateInput(), {
        destination: SELF
      })
      await store.flushPendingOrThrowAsync()
      const gate = Promise.withResolvers<void>()
      const flush = vi.spyOn(store, 'flushPendingOrThrowAsync').mockReturnValue(gate.promise)
      const request =
        method === 'automation.createCoordinated'
          ? input()
          : {
              id: created.id,
              expectedOwner: SELF,
              updates: { name: 'Renamed', expectedDefinitionRevision: 1 }
            }
      let replied = false
      const pending = rpc(method, request).then((result) => {
        replied = true
        return result
      })
      await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
      expect(published).toEqual([])
      expect(replied).toBe(false)
      gate.resolve()
      expect(await pending).toMatchObject({ ok: true })
      expect(published).toEqual([{ reason: 'definition', selector: { kind: 'self' } }])
    }
  )

  it('publishes no success on a failed durable flush', async () => {
    const { rpc, store, published } = fixture()
    vi.spyOn(store, 'flushPendingOrThrowAsync').mockRejectedValue(new Error('disk full'))
    expect(await rpc('automation.createCoordinated', input())).toMatchObject({
      ok: false,
      error: { message: 'disk full' }
    })
    expect(published).toEqual([])
  })
})

describe('dedicated definition fences preserve single automation behavior', () => {
  it.each([
    { enabled: true },
    { definitionRevision: 99 },
    { destination: undefined },
    { coordinatedDefinitionWrites: { profileDirectory: '/spoofed' } },
    { destination: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } } },
    { repo: 'id:repo-ssh' }
  ])('refuses unsafe create fields %j before writing', async (patch) => {
    const { rpc, store } = fixture()
    const write = vi.spyOn(store, 'createCoordinatedAutomation')
    expect(await rpc('automation.createCoordinated', { ...input(), ...patch })).toMatchObject({
      ok: false
    })
    expect(write).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([])
  })

  it('refuses replay or update of a remotely owned definition without touching it', async () => {
    const { rpc, store, published } = fixture()
    const remote = { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } } as const
    const saved = store.createCoordinatedAutomation(
      coordinatedCreateInput({ projectId: 'repo-ssh', creationKey: 'remote-parent' }),
      { destination: remote }
    )
    await store.flushPendingOrThrowAsync()
    const create = vi.spyOn(store, 'createCoordinatedAutomation')
    const update = vi.spyOn(store, 'updateCoordinatedAutomation')
    expect(
      await rpc('automation.createCoordinated', input({ creationKey: 'remote-parent' }))
    ).toMatchObject({ ok: false })
    expect(
      await rpc('automation.updateCoordinated', {
        id: saved.id,
        expectedOwner: remote,
        updates: { expectedDefinitionRevision: 1, name: 'No local write' }
      })
    ).toMatchObject({ ok: false })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([saved])
    expect(published).toEqual([])
  })

  it('refuses updates after host capability is revoked before touching the definition', async () => {
    const { rpc, store, published } = fixture()
    await rpc('automation.createCoordinated', input())
    const saved = store.listAutomations()[0]
    store.updateSettings({ experimentalCoordinatedAutomations: false })
    const update = vi.spyOn(store, 'updateCoordinatedAutomation')
    expect(
      await rpc('automation.updateCoordinated', {
        id: saved.id,
        expectedOwner: SELF,
        updates: { expectedDefinitionRevision: 1, children: [child('replacement')] }
      })
    ).toMatchObject({ ok: false })
    expect(update).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([saved])
    expect(published).toHaveLength(1)
  })

  it('requires an owner and revision on updates and rejects enabling before writes', async () => {
    const { rpc, store } = fixture()
    await rpc('automation.createCoordinated', input())
    const created = store.listAutomations()[0]
    const write = vi.spyOn(store, 'updateCoordinatedAutomation')
    for (const patch of [
      { updates: { name: 'Missing revision' } },
      { expectedOwner: undefined },
      { updates: { expectedDefinitionRevision: 1, enabled: true } },
      { destination: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } } }
    ]) {
      expect(
        await rpc('automation.updateCoordinated', {
          id: created.id,
          expectedOwner: SELF,
          updates: { expectedDefinitionRevision: 1, name: 'Changed' },
          ...patch
        })
      ).toMatchObject({ ok: false })
    }
    expect(write).not.toHaveBeenCalled()
    expect(store.listAutomations()).toEqual([created])
  })

  it('retains generic single create/update while refusing coordinated payloads on generic methods', async () => {
    const { rpc, store } = fixture({ optIn: false, flag: false })
    const {
      kind: _kind,
      children: _children,
      outcomeContract: _contract,
      inheritedDefaults: _defaults,
      globalCeilings: _ceilings,
      publicationPolicy: _publication,
      retentionPolicy: _retention,
      ...single
    } = input()
    expect(await rpc('automation.create', single)).toMatchObject({ ok: true })
    const created = store.listAutomations()[0]
    expect(
      await rpc('automation.update', { id: created.id, updates: { name: 'Renamed' } })
    ).toMatchObject({ ok: true, result: { automation: { name: 'Renamed' } } })
    expect(await rpc('automation.create', input())).toMatchObject({ ok: false })
    expect(
      await rpc('automation.update', {
        id: created.id,
        updates: { kind: 'coordinated', children: input().children }
      })
    ).toMatchObject({ ok: false })
    expect(store.listAutomations()).toHaveLength(1)
    expect(store.listAutomations()[0].kind).not.toBe('coordinated')
  })
})
