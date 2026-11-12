import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../persistence/persistence-test-harness'
import { coordinatedTestState } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { NativeProviderPilotScope } from '../runtime/native-provider-execution-admission'
import { createIsolatedNativeCoordinatedAppComposition } from './main-process-native-pilot-composition'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
let root = ''
afterEach(async () => {
  await closeTestStores()
  vi.restoreAllMocks()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each(['packaged', 'headless', 'foreign-profile', 'foreign-workspace', 'forged-policy'])(
  'refuses %s native pilot composition before settings or run writes',
  (reason) => {
    root = mkdtempSync(join(tmpdir(), 'native-pilot-composition-'))
    const home = join(root, 'home')
    const workspacePath = join(root, 'workspace')
    const inputRoot = join(workspacePath, 'inputs')
    testState.dir = join(root, 'profiles', 'pilot')
    for (const path of [home, inputRoot, testState.dir]) {
      mkdirSync(path, { recursive: true })
    }
    writeDataFile(coordinatedTestState())
    const store = createStore()
    installFakeAppEnvironment({
      isPackaged: () => reason === 'packaged',
      getPath: (name) => (name === 'home' ? home : root)
    })
    if (reason === 'foreign-profile') {
      vi.spyOn(store, 'getProfileStorageDirectory').mockReturnValue(workspacePath)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: adversarial wire-shaped object must fail the process-local policy identity check.
    const sandboxPolicy = {
      kind: 'verified'
    } as unknown as NativeProviderPilotScope['sandboxPolicy']
    const compose = createIsolatedNativeCoordinatedAppComposition({
      userDataDirectory: root,
      pilotScope: {
        homeDirectory: home,
        workspaceId: 'folder:pilot',
        workspacePath: reason === 'foreign-workspace' ? tmpdir() : workspacePath,
        inputRoot,
        promptAuthority: 'pilot:local',
        idempotencyKey: 'one-article',
        sandboxPolicy
      },
      laneLocks: { tryAcquire: () => ({ acquired: false, holder: 'test' }) },
      estimateCostUsd: () => 1
    })
    const before = store.getSettings()
    expect(() => compose({ store, headless: reason === 'headless' })).toThrow()
    expect(store.getSettings()).toEqual(before)
    expect(store.listAutomationRuns()).toEqual([])
    expect(store.listAutomations()).toEqual([])
  }
)
