import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { createStore, closeTestStores, testState } from '../persistence/persistence-test-harness'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { OrcaRuntimeService } from './orca-runtime'
import {
  createNativeStubSessionTestComposition,
  type PreparedNativeStubLaunch
} from './native-stub-session-test-host'
import {
  LocalPtyProvider,
  _resetLocalPtyProviderStateForTest
} from '../providers/local-pty/local-pty-provider'
import {
  createLocalPtyMockProcess,
  type LocalPtyExitCallback
} from '../providers/local-pty/local-pty-provider-test-harness'
import { getLocalPtyProvider, setLocalPtyProvider } from '../ipc/pty/provider/registry'
import { makeRuntimePtySpawnTestDeps } from '../ipc/pty/runtime/spawn-preflight-test-deps-fixture'
import { spawnPtyFromRuntimeController } from '../ipc/pty/runtime/spawn'
import type { RuntimePtySpawnArgs } from '../ipc/pty/runtime/spawn-state'
import * as launchHooks from '../ipc/pty/spawn-agent-launch-plugin-hook'
import * as trust from '../agent-workspace-trust-spawn'
import * as directories from '../providers/working-directory-validation'
import { getAppEnvironment } from '../../shared/app-environment'
import * as invalidators from '../ipc/worktree-change-invalidators'
import { _resetTerminalModelQueryAuthorityForTest } from './terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from './terminal-view-attribute-store'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const originalProvider = getLocalPtyProvider()
let root = ''
const disposers: (() => void)[] = []
let exitCallback: LocalPtyExitCallback | undefined
beforeEach(() => {
  native.spawn.mockReset()
  native.spawn.mockImplementation(() =>
    createLocalPtyMockProcess({
      get: () => exitCallback,
      set: (cb) => {
        exitCallback = cb
      }
    })
  )
})
afterEach(async () => {
  _resetLocalPtyProviderStateForTest()
  setLocalPtyProvider(originalProvider)
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  await closeTestStores()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  _resetTerminalModelQueryAuthorityForTest()
  _resetTerminalViewAttributesForTest()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = ''
})

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'orca-native-stub-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  testState.dir = join(root, 'profiles', 'local')
  for (const path of [home, workspace, testState.dir]) {
    mkdirSync(path, { recursive: true })
  }
  const store = createStore()
  installFakeAppEnvironment({ getPath: (name) => (name === 'home' ? home : root) })
  const buildSpawnEnv = vi.fn(() => {
    throw new Error('account environment must not run')
  })
  const provider = new LocalPtyProvider({ buildSpawnEnv })
  setLocalPtyProvider(provider)
  const host = createNativeStubSessionTestComposition({
    userDataDirectory: root,
    homeDirectory: home
  })
  disposers.push(host.revoke)
  const registration = vi.spyOn(invalidators, 'registerWorktreeChangeInvalidator')
  const runtime = new OrcaRuntimeService(store, undefined, { nativeStubSessionTest: host })
  for (const result of registration.mock.results) {
    if (result.type === 'return') {
      disposers.push(result.value)
    }
  }
  const group = store.createProjectGroup({
    name: 'Stub',
    parentPath: workspace,
    createdFrom: 'folder-scan'
  })
  const folder = store.createFolderWorkspace({ projectGroupId: group.id })
  const selector = `id:${folderWorkspaceKey(folder.id)}`
  const deps = makeRuntimePtySpawnTestDeps()
  deps.store = store
  deps.runtime = runtime
  deps.getSettings = () => store.getSettings()
  deps.prepareClaudeAuth = vi.fn()
  deps.prepareCodexResumeHome = vi.fn()
  deps.options = { onCodexHomePtySpawned: vi.fn() }
  const spawn = vi.fn((args: RuntimePtySpawnArgs) => spawnPtyFromRuntimeController(deps, args))
  Object.defineProperty(runtime, 'ptyController', { value: { spawn } })
  Object.defineProperty(runtime, 'getAvailableAuthoritativeWindow', { value: () => null })
  const account = vi.spyOn(runtime['accounts'], 'prepareHostAgentLaunch')
  const hook = vi.spyOn(launchHooks, 'applyAgentLaunchPluginHook')
  const trustWrite = vi.spyOn(trust, 'applyAgentWorkspaceTrustToSpawn')
  const permit = await host.prepare(runtime, selector)
  const options = {
    preparedNativeStub: permit,
    startupAgent: 'codex' as const,
    surfaceOwner: false as const
  }
  return {
    store,
    host,
    runtime,
    selector,
    options,
    provider,
    deps,
    spawn,
    account,
    hook,
    trustWrite,
    buildSpawnEnv,
    home,
    workspace
  }
}

it('runs the fixed fixture through actual native create/controller/provider with token and pane identity', async () => {
  const f = await setup()
  f.store.updateSettings({
    agentCmdOverrides: { codex: 'arbitrary-command' },
    agentDefaultEnv: { codex: { SECRET: 'injected' } }
  })
  vi.stubEnv('CODEX_HOME', '/must-not-inherit')
  vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-inherit')
  const created = await f.runtime.createTerminal(f.selector, f.options)
  expect(native.spawn).toHaveBeenCalledTimes(1)
  const [file, argv, options] = native.spawn.mock.calls[0]
  expect(file).toBe(realpathSync(process.execPath))
  expect(argv).toEqual([
    realpathSync(join(process.cwd(), 'tests/e2e/fixtures/golden-stub-agent/golden-stub-agent.js'))
  ])
  expect(options.cwd).toBe(f.workspace)
  expect(options.env).toEqual({
    HOME: f.home,
    USERPROFILE: f.home,
    TMPDIR: f.home,
    TEMP: f.home,
    TMP: f.home,
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    ELECTRON_RUN_AS_NODE: '1',
    ORCA_AGENT_LAUNCH_TOKEN: created.launchToken,
    ORCA_TERMINAL_HANDLE: created.handle,
    ORCA_WORKSPACE_ID: created.worktreeId,
    ORCA_WORKTREE_ID: created.worktreeId,
    ORCA_TAB_ID: created.tabId,
    ORCA_PANE_KEY: created.paneKey
  })
  expect(created.launchToken).toBeTruthy()
  const authority = f.runtime.getOrchestrationDispatchAuthority(created.handle)
  expect(authority).toMatchObject({ paneKey: created.paneKey })
  expect(authority?.processIncarnation).toBeTruthy()
  expect(f.provider.hasPty(created.ptyId!)).toBe(true)
  for (const operation of [
    f.account,
    f.hook,
    f.trustWrite,
    f.buildSpawnEnv,
    f.deps.prepareClaudeAuth,
    f.deps.prepareCodexResumeHome,
    f.deps.options?.onCodexHomePtySpawned
  ]) {
    expect(operation).not.toHaveBeenCalled()
  }
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
    /already_dispatched/
  )
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each([
  'command',
  'env',
  'accountEnv',
  'shellOverride',
  'launchPreferences',
  'sessionId',
  'launchToken'
])('refuses caller %s before accounts, pane admission or spawn', async (key) => {
  const f = await setup()
  const admit = vi.spyOn(f.store, 'admitTerminalPane')
  await expect(
    f.runtime.createTerminal(f.selector, { ...f.options, [key]: 'override' })
  ).rejects.toThrow(/create_override/)
  expect(admit).not.toHaveBeenCalled()
  expect(f.account).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('refuses cloned permits, another runtime and a host revoked during awaited pane admission', async () => {
  const f = await setup()
  const forged: PreparedNativeStubLaunch = { capability: 'native_stub_session_test' }
  await expect(
    f.runtime.createTerminal(f.selector, { ...f.options, preparedNativeStub: forged })
  ).rejects.toThrow(/permit_invalid/)
  const foreign = new OrcaRuntimeService(f.store)
  await expect(foreign.createTerminal(f.selector, f.options)).rejects.toThrow(
    /runtime_or_profile_changed/
  )
  const original = f.store.admitTerminalPane.bind(f.store)
  vi.spyOn(f.store, 'admitTerminalPane').mockImplementation(async (...args) => {
    const result = await original(...args)
    f.host.revoke()
    return result
  })
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(/host_unavailable/)
  expect(f.spawn).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
  expect(f.account).not.toHaveBeenCalled()
})

it.each([
  'profile',
  'generation',
  'headless',
  'provider',
  'unproven-provider',
  'packaged',
  'remote'
])('refuses a changed %s before preparatory effects', async (changed) => {
  const f = await setup()
  if (changed === 'profile') {
    vi.spyOn(f.store, 'getProfileStorageDirectory').mockReturnValue(f.home)
  }
  if (changed === 'generation') {
    Object.defineProperty(f.runtime, 'runtimeId', { value: 'new-generation' })
  }
  if (changed === 'headless') {
    Object.defineProperty(f.runtime, 'servesHeadlessGraph', { value: true })
  }
  if (changed === 'provider') {
    setLocalPtyProvider(new LocalPtyProvider())
  }
  if (changed === 'packaged') {
    vi.spyOn(getAppEnvironment(), 'isPackaged').mockReturnValue(true)
  }
  if (changed === 'unproven-provider') {
    class UnsupportedProvider extends LocalPtyProvider {}
    setLocalPtyProvider(new UnsupportedProvider())
  }
  if (changed === 'remote') {
    vi.spyOn(f.runtime, 'resolveTerminalCreateLaunchScope').mockResolvedValue({
      id: f.selector.slice(3),
      path: f.workspace,
      connectionId: 'ssh:foreign',
      repo: null,
      folderWorkspace: null
    })
  }
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(/native_stub/)
  expect(f.account).not.toHaveBeenCalled()
  expect(f.hook).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('revalidates after controller workspace admission before hooks or account preparation', async () => {
  const f = await setup()
  f.deps.assertWorkspaceAcceptsNewPty = async () => {
    f.host.revoke()
  }
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(/host_unavailable/)
  expect(f.hook).not.toHaveBeenCalled()
  expect(f.buildSpawnEnv).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('retains native process identity when the physical commit acknowledgement is lost', async () => {
  const f = await setup()
  const error = await f.runtime
    .createTerminal(f.selector, {
      ...f.options,
      onPtySpawnCommitted: () => {
        throw new Error('lost acknowledgement')
      }
    })
    .catch((error) => error)
  expect(error).toMatchObject({ code: 'operation_unknown' })
  expect(f.provider.hasPty(error.ptyId)).toBe(true)
  expect(await f.provider.listProcesses()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: error.ptyId, incarnationId: error.incarnationId })
    ])
  )
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
    /already_dispatched/
  )
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('consumes a single create admission while another caller is waiting', async () => {
  const f = await setup()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = f.store.admitTerminalPane.bind(f.store)
  vi.spyOn(f.store, 'admitTerminalPane').mockImplementation(async (...args) => {
    entered.resolve()
    await release.promise
    return original(...args)
  })
  const pending = f.runtime.createTerminal(f.selector, f.options)
  await entered.promise
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(/create_reused/)
  release.resolve()
  await pending
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('revalidates after local cwd preparation immediately before physical dispatch', async () => {
  const f = await setup()
  const original = directories.validateWorkingDirectory
  vi.spyOn(directories, 'validateWorkingDirectory').mockImplementation(async (...args) => {
    await original(...args)
    f.host.revoke()
  })
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(/host_unavailable/)
  expect(native.spawn).not.toHaveBeenCalled()
  expect(f.buildSpawnEnv).not.toHaveBeenCalled()
})

it('refuses a moved or remote folder and Git worktree selectors before resolving them', async () => {
  const f = await setup()
  const resolve = vi.spyOn(f.runtime, 'resolveTerminalWorkspaceLaunchScope')
  await expect(f.host.prepare(f.runtime, 'id:repo::/unapproved')).rejects.toThrow(
    /existing_folder_required/
  )
  expect(resolve).not.toHaveBeenCalled()
  const folder = f.store.getFolderWorkspaces()[0]
  f.store.updateFolderWorkspace(folder.id, { folderPath: f.home })
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
    /local_workspace_required/
  )
  expect(resolve).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('refuses a serialized composition and never retries a failed physical spawn', async () => {
  const f = await setup()
  const fake = { prepare: f.host.prepare, revoke: f.host.revoke }
  expect(() => new OrcaRuntimeService(f.store, undefined, { nativeStubSessionTest: fake })).toThrow(
    /composition_invalid/
  )
  native.spawn.mockImplementationOnce(() => {
    throw new Error('native spawn refused')
  })
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
    /native spawn refused/
  )
  await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
    /already_dispatched/
  )
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it.each(['env', 'command', 'shellOverride'])(
  'refuses a late provider %s override at final dispatch',
  async (field) => {
    const f = await setup()
    const original = f.provider.spawn.bind(f.provider)
    vi.spyOn(f.provider, 'spawn').mockImplementation((args) =>
      original({
        ...args,
        [field]: field === 'env' ? { ...args.env, SECRET: 'not-admitted' } : 'not-admitted'
      })
    )
    await expect(f.runtime.createTerminal(f.selector, f.options)).rejects.toThrow(
      /provider_override/
    )
    expect(native.spawn).not.toHaveBeenCalled()
    expect(f.buildSpawnEnv).not.toHaveBeenCalled()
  }
)

it('rejects revocation by the dispatch observer before writing a pane', async () => {
  const f = await setup()
  const admission = vi.spyOn(f.store, 'admitTerminalPane')
  await expect(
    f.runtime.createTerminal(f.selector, {
      ...f.options,
      onPtySpawnDispatched: () => f.host.revoke()
    })
  ).rejects.toThrow(/host_unavailable/)
  expect(admission).not.toHaveBeenCalled()
  expect(native.spawn).not.toHaveBeenCalled()
})
