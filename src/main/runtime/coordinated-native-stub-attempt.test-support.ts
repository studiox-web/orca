// A coordinated native stub attempt runs through the real Store, orchestration DB, pinned golden
// stub composition, launch, readiness and prompt-write path; only the physical PTY is mocked, and
// that mock plays the pinned stub's own READY/SUBMITTED byte protocol. Nothing here starts a
// process, proves a real Codex/provider journey, or enables a production/default-root capability.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi, type Mock } from 'vitest'
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
import { coordinatedTestState } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'

const originalProvider = getLocalPtyProvider()
let root = ''
const disposers: (() => void)[] = []

let exitCallback: LocalPtyExitCallback | undefined
let nativeSpawn: Mock = vi.fn()
let stubBehavior: StubPtyBehavior = 'responsive'

/** Registers per-test PTY mock and cleanup; the caller owns the hoisted `node-pty` mock. */
export function installNativeStubAttemptHooks(spawn: Mock): void {
  nativeSpawn = spawn
  beforeEach(resetNativeSpawn)
  afterEach(cleanupNativeStubAttempt)
}

function resetNativeSpawn(): void {
  exitCallback = undefined
  nativeSpawn.mockReset()
  stubBehavior = 'responsive'
  nativeSpawn.mockImplementation(() => {
    const process = createLocalPtyMockProcess({
      get: () => exitCallback,
      set: (callback) => {
        exitCallback = callback
      }
    })
    emulatePinnedStubOnPty(process, () => stubBehavior)
    return process
  })
}

/** Selects how the next controlled PTY plays the pinned stub. */
export function setStubPtyBehavior(behavior: StubPtyBehavior): void {
  stubBehavior = behavior
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

export async function setupNativeStubAttempt(reuse?: {
  rootDir: string
  homeDir: string
  workspaceDir: string
}) {
  root = reuse?.rootDir ?? mkdtempSync(join(tmpdir(), 'orca-coordinated-native-'))
  const home = reuse?.homeDir ?? join(root, 'home')
  const workspace = reuse?.workspaceDir ?? join(root, 'workspace')
  testState.dir = join(root, 'profiles', 'local')
  for (const path of [home, workspace, testState.dir]) {
    mkdirSync(path, { recursive: true })
  }
  if (!reuse) {
    writeDataFile(coordinatedTestState())
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
  const createTerminal = runtime.createTerminal.bind(runtime)
  vi.spyOn(runtime, 'createTerminal').mockImplementation(async (selector, options) => {
    const created = await createTerminal(selector, options)
    createdTerminals.push(created)
    return created
  })
  // The app composes provider output into the runtime; the stub's markers arrive on that path.
  disposers.push(
    provider.onData((payload) => runtime.onPtyData(payload.id, payload.data, Date.now()))
  )
  const nativeStubWorker = createCoordinatedNativeStubWorker({
    runtime,
    store,
    db,
    composition: host
  })
  const adapter = new CoordinatedAutomationAdapter({ store, orchestrationDb: db, nativeStubWorker })
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_SEND_METHODS })
  return {
    store,
    host,
    runtime,
    db,
    adapter,
    dispatcher,
    createdTerminals,
    nativeStubWorker,
    workspaceId,
    home,
    workspace
  }
}

/** Root of the current fixture; a restart simulation passes it back to reuse the profile. */
export function nativeStubAttemptRoot(): string {
  return root
}
