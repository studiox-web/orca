import { buildCoordinatedNativeStub } from '../../../config/scripts/build-coordinated-native-stub.mjs'
import { STATUS_METHODS } from './rpc/methods/status'
import { publishHostDescriptor } from './host-descriptor'
// A coordinated native stub attempt runs through the real Store, orchestration DB, pinned golden
// stub composition, launch, readiness and prompt-write path; only the physical PTY is mocked, and
// that mock plays the pinned stub's own READY/SUBMITTED byte protocol. Nothing here starts a
// process, proves a real Codex/provider journey, or enables a production/default-root capability.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, vi, type Mock } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../persistence/persistence-test-harness'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import type { RuntimeTerminalCreate } from '../../shared/runtime-terminal-create-contract'
import { OrcaRuntimeService } from './orca-runtime'
import { createNativeStubSessionTestComposition } from './native-stub-session-test-host'
import {
  LocalPtyProvider,
  _resetLocalPtyProviderStateForTest
} from '../providers/local-pty/local-pty-provider'
import {
  createLocalPtyMockProcess,
  type LocalPtyMockProcess,
  type LocalPtyExitCallback
} from '../providers/local-pty/local-pty-provider-test-harness'
import { getLocalPtyProvider, setLocalPtyProvider } from '../ipc/pty/provider/registry'
import {
  emulatePinnedStubOnPty,
  type StubPtyBehavior
} from './native-stub-pty-emulator.test-support'
import { makeRuntimePtySpawnTestDeps } from '../ipc/pty/runtime/spawn-preflight-test-deps-fixture'
import { spawnPtyFromRuntimeController } from '../ipc/pty/runtime/spawn'
import * as invalidators from '../ipc/worktree-change-invalidators'
import { _resetTerminalModelQueryAuthorityForTest } from './terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from './terminal-view-attribute-store'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_SEND_METHODS } from './rpc/methods/orchestration/messaging/send-methods'
import { CoordinatedAutomationAdapter } from '../automations/coordinated-automation-adapter'
import { createCoordinatedNativeStubWorker } from '../automations/coordinated-automation-native-stub-worker'
import { createCoordinatedNativeProviderWorker } from '../automations/coordinated-automation-native-provider-worker'
import {
  createNativeProviderExecutionAdmission,
  type PreparedNativeProviderLaunch
} from './native-provider-execution-admission'
import { coordinatedTestState } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'

const originalProvider = getLocalPtyProvider()
let root = ''
const disposers: (() => void)[] = []

let exitCallback: LocalPtyExitCallback | undefined
let nativeSpawn: Mock = vi.fn()
let fixtureKind: 'stub' | 'provider' = 'stub'
let stubBehavior: StubPtyBehavior = 'responsive'
let providerBehavior: 'responsive' | 'never_ready' = 'responsive'
let stubEntry:
  | ((process: LocalPtyMockProcess, file: string, env: Record<string, string>) => void)
  | null = null

export function setStubEntry(entry: NonNullable<typeof stubEntry>): void {
  stubEntry = entry
}

/** Registers per-test PTY mock and cleanup; the caller owns the hoisted `node-pty` mock. */
export function installNativeStubAttemptHooks(spawn: Mock): void {
  nativeSpawn = spawn
  beforeAll(() => buildCoordinatedNativeStub())
  beforeEach(resetNativeSpawn)
  afterEach(cleanupNativeStubAttempt)
}

function emulateProviderOnPty(process: ReturnType<typeof createLocalPtyMockProcess>): void {
  const firstRender = (): void => {
    if (providerBehavior === 'never_ready') {
      return
    }
    if (process.onData.mock.calls.length === 0) {
      setTimeout(firstRender, 1)
      return
    }
    const ready = [
      '\x1b]0;workspace\x07',
      '  Muse Code 1.3.0',
      '  Skills: 77 loaded · 1 warning · 28 details hidden (ctrl+o to expand)',
      '── Voice input (⌥ + v to start) ──────────────────────────────────────────',
      '❯ ────────────────────────────────────────────────────────────────────',
      '  frozen-model · high · workspace · YOLO',
      ''
    ].join('\r\n')
    for (const [listener] of process.onData.mock.calls) {
      listener(ready)
    }
  }
  setTimeout(firstRender, 1)
}

function resetNativeSpawn(): void {
  exitCallback = undefined
  nativeSpawn.mockReset()
  fixtureKind = 'stub'
  stubBehavior = 'responsive'
  providerBehavior = 'responsive'
  stubEntry = null
  nativeSpawn.mockImplementation(
    (_file: string, args: string[], options?: { env?: Record<string, string> }) => {
      const process = createLocalPtyMockProcess({
        get: () => exitCallback,
        set: (callback) => {
          exitCallback = callback
        }
      })
      if (fixtureKind === 'provider') {
        emulateProviderOnPty(process)
        return process
      }
      if (stubEntry) {
        stubEntry(process, args[0], { ...options?.env })
      } else {
        emulatePinnedStubOnPty(process, () => stubBehavior)
      }
      return process
    }
  )
}

/** Selects how the next controlled PTY plays the pinned stub. */
export function setStubPtyBehavior(behavior: StubPtyBehavior): void {
  stubBehavior = behavior
}

export function setProviderPtyBehavior(behavior: 'responsive' | 'never_ready'): void {
  providerBehavior = behavior
}

async function cleanupNativeStubAttempt(): Promise<void> {
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
}

export type NativeStubAttemptFixture = Awaited<ReturnType<typeof setupNativeStubAttempt>>

export async function setupNativeStubAttempt(options?: {
  rootDir?: string
  homeDir?: string
  workspaceDir?: string
  kind?: 'stub' | 'provider'
  isActive?: () => boolean
}) {
  fixtureKind = options?.kind ?? 'stub'
  root = options?.rootDir ?? mkdtempSync(join(tmpdir(), 'orca-coordinated-native-'))
  const home = options?.homeDir ?? join(root, 'home')
  const workspace = options?.workspaceDir ?? join(root, 'workspace')
  testState.dir = join(root, 'profiles', 'local')
  for (const path of [home, workspace, testState.dir]) {
    mkdirSync(path, { recursive: true })
  }
  if (!options?.rootDir) {
    writeDataFile(coordinatedTestState())
  }
  const store = createStore()
  installFakeAppEnvironment({ getPath: (name) => (name === 'home' ? home : root) })
  const buildSpawnEnv = vi.fn(
    (
      _id: string,
      env: Record<string, string>
    ): Record<string, string> | Promise<Record<string, string>> => {
      if (fixtureKind !== 'provider') {
        throw new Error('account environment must not run')
      }
      return env
    }
  )
  const provider = new LocalPtyProvider({ buildSpawnEnv })
  setLocalPtyProvider(provider)
  const stubHost =
    fixtureKind === 'stub'
      ? createNativeStubSessionTestComposition({ userDataDirectory: root, homeDirectory: home })
      : undefined
  const providerAdmission =
    fixtureKind === 'provider'
      ? createNativeProviderExecutionAdmission({ userDataDirectory: root })
      : undefined
  const host = stubHost ?? providerAdmission!
  disposers.push(host.revoke)
  const registration = vi.spyOn(invalidators, 'registerWorktreeChangeInvalidator')
  const runtime = new OrcaRuntimeService(store, undefined, {
    nativeStubSessionTest: stubHost,
    coordinatedNativeProviderExecution: providerAdmission
  })
  if (fixtureKind === 'provider') {
    vi.spyOn(runtime, 'readLaunchedAgentForeground').mockResolvedValue('agent')
  }
  publishHostDescriptor(runtime.getRuntimeId(), {
    installationId: 'b7ac5d7e-9e4a-40d4-a310-88baecf1c2cd'
  })
  disposers.push(() => publishHostDescriptor(runtime.getRuntimeId(), null))
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
  const workspaceId = folderWorkspaceKey(folder.id)
  const deps = makeRuntimePtySpawnTestDeps()
  deps.store = store
  deps.runtime = runtime
  deps.getSettings = () => store.getSettings()
  deps.prepareClaudeAuth = vi.fn()
  deps.prepareCodexResumeHome = vi.fn()
  deps.options = { onCodexHomePtySpawned: vi.fn() }
  const spawn = vi.fn((args: Parameters<typeof spawnPtyFromRuntimeController>[1]) =>
    spawnPtyFromRuntimeController(deps, args)
  )
  Object.defineProperty(runtime, 'ptyController', {
    value: {
      spawn,
      write: (ptyId: string, data: string) => {
        provider.write(ptyId, data)
        return true
      },
      kill: (ptyId: string) => {
        void ptyId
        exitCallback?.({ exitCode: -1 })
        return true
      }
    }
  })
  Object.defineProperty(runtime, 'getAvailableAuthoritativeWindow', { value: () => null })
  const db = runtime.getOrchestrationDb()
  const createdTerminals: RuntimeTerminalCreate[] = []
  const providerPermits: PreparedNativeProviderLaunch[] = []
  const createTerminal = runtime.createTerminal.bind(runtime)
  vi.spyOn(runtime, 'createTerminal').mockImplementation(async (selector, options) => {
    const created = await createTerminal(selector, options)
    createdTerminals.push(created)
    if (options?.preparedNativeProvider) {
      providerPermits.push(options.preparedNativeProvider)
    }
    return created
  })
  disposers.push(
    provider.onData((payload) => runtime.onPtyData(payload.id, payload.data, Date.now()))
  )
  const nativeStubWorker = stubHost
    ? createCoordinatedNativeStubWorker({ runtime, store, db, composition: stubHost })
    : undefined
  const nativeProviderWorker = providerAdmission
    ? createCoordinatedNativeProviderWorker({
        runtime,
        store,
        db,
        admission: providerAdmission
      })
    : undefined
  const adapter = new CoordinatedAutomationAdapter({
    store,
    orchestrationDb: db,
    nativeStubWorker,
    nativeProviderWorker,
    isActive: options?.isActive
  })
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...ORCHESTRATION_SEND_METHODS, ...STATUS_METHODS]
  })
  return {
    buildSpawnEnv,
    store,
    host,
    runtime,
    db,
    adapter,
    dispatcher,
    createdTerminals,
    providerPermits,
    nativeStubWorker,
    nativeProviderWorker,
    workspaceId,
    home,
    workspace
  }
}

/** Root of the current fixture; a restart simulation passes it back to reuse the profile. */
export function nativeStubAttemptRoot(): string {
  return root
}
