import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { resolveLocalLaunchScopeRuntime } from '../local-project-runtime-resolution'
import { join } from 'node:path'
import {
  canonicalNativeStubPath as canonical,
  isWithinNativeStubPath as within,
  nativeStubFileDigest as digest
} from './native-stub-file-identity'
import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeStore } from './runtime-store-contract'
import type { NativeStubPhysicalIdentity } from './native-stub-physical-spawn'
import type { OrcaRuntimeService } from './orca-runtime'
import type { TerminalWorkspaceLaunchScope } from './runtime-legacy-worker-terminal-recovery-types'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session/lifecycle/agent-session-resume'

import { requireNativeStubReportBundle } from './native-stub-report-bundle'
import { getRuntimeSourceStamp } from './host-descriptor'
import { stampRuntimeSourceEnv, type RuntimeSourceStamp } from '../../shared/runtime-source-env'
const compositions = new WeakMap<NativeStubSessionTestComposition, Composition>()
const permits = new WeakMap<PreparedNativeStubLaunch, NativeStubLaunchRecord>()

export type PreparedNativeStubLaunch = Readonly<{ capability: 'native_stub_session_test' }>
export type NativeStubSessionTestComposition = Readonly<{
  prepare(runtime: OrcaRuntimeService, selector: string): Promise<PreparedNativeStubLaunch>
  revoke(): void
}>
type Binding = {
  runtime: { getRuntimeId?: () => string }
  store: RuntimeStore | null
  generation: () => string
  isLocalDesktop: () => boolean
  readInProcessProvider: () => object
}
type Composition = {
  assertCurrent(): void
  binding?: Binding
  profile?: string
  generation?: string
  provider?: object
  userData: string
  home: string
  file: string
  fileDigest: string
  fixture: string
}
export type NativeStubLaunchRecord = {
  composition: Composition
  runtime: object
  source: RuntimeSourceStamp
  workspace: Readonly<TerminalWorkspaceLaunchScope>
  env: Readonly<Record<string, string>>
  launchConfig: SleepingAgentLaunchConfig
  phase: 'prepared' | 'creating' | 'dispatched'
  surface?: Readonly<{ handle: string; tabId: string; leafId: string; token: string }>
  observePhysicalSpawn?: (identity: NativeStubPhysicalIdentity) => void
  assertDispatchCurrent?: () => void
}

/** Only an isolated host composition can mint permits; serialized options cannot install it. */
export function createNativeStubSessionTestComposition(input: {
  userDataDirectory: string
  homeDirectory: string
}): NativeStubSessionTestComposition {
  const environment = getAppEnvironment()
  const userData = canonical(input.userDataDirectory)
  const home = canonical(input.homeDirectory)
  if (home !== canonical(join(userData, 'home'))) {
    throw new Error('native_stub_isolation_required')
  }
  const file = canonical(process.execPath)
  const fixture = requireNativeStubReportBundle(environment.getAppPath())
  let revoked = false
  const composition: Composition = {
    userData,
    home,
    file,
    fileDigest: digest(file),
    fixture,
    assertCurrent() {
      if (
        revoked ||
        getAppEnvironment() !== environment ||
        environment.isPackaged() ||
        process.env.ORCA_BACKGROUND_LAUNCH !== '1' ||
        canonical(environment.getPath('userData')) !== userData ||
        canonical(environment.getPath('home')) !== home
      ) {
        throw new Error('native_stub_host_unavailable')
      }
    }
  }
  composition.assertCurrent()
  const result: NativeStubSessionTestComposition = Object.freeze({
    async prepare(runtime: OrcaRuntimeService, selector: string) {
      assertBinding(composition, runtime)
      const key = selector.startsWith('id:') ? parseWorkspaceKey(selector.slice(3)) : null
      // Folder scopes avoid Git remote materialization in this isolated prerequisite.
      if (key?.type !== 'folder') {
        throw new Error('native_stub_existing_folder_required')
      }
      assertFolder(composition, key.folderWorkspaceId)
      const workspace = await runtime.resolveTerminalWorkspaceLaunchScope(selector)
      assertBinding(composition, runtime)
      const path = canonical(workspace.path)
      assertFolder(composition, key.folderWorkspaceId)
      const target = resolveLocalLaunchScopeRuntime(composition.binding!.store!, workspace)
      if (target && (target.status !== 'resolved' || target.runtime.kind === 'wsl')) {
        throw new Error('native_stub_local_workspace_required')
      }
      if (
        !workspace.folderWorkspace ||
        workspace.folderWorkspace.id !== key.folderWorkspaceId ||
        workspace.connectionId ||
        !within(userData, path) ||
        path === home ||
        within(home, path) ||
        !workspace.id ||
        workspace.path.startsWith('\\\\')
      ) {
        throw new Error('native_stub_local_workspace_required')
      }
      const source = getRuntimeSourceStamp(runtime, userData)
      if (!source) {
        throw new Error('native_stub_runtime_source_unavailable')
      }
      const env: Record<string, string> = {
        HOME: home,
        USERPROFILE: home,
        TMPDIR: home,
        TEMP: home,
        TMP: home,
        LANG: 'C.UTF-8',
        TERM: 'xterm-256color',
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_USER_DATA_PATH: userData
      }
      stampRuntimeSourceEnv(env, source)
      Object.freeze(env)
      const permit = Object.freeze({
        capability: 'native_stub_session_test' as const,
        toJSON() {
          throw new Error('native_stub_permit_is_process_local')
        }
      })
      permits.set(permit, {
        composition,
        runtime,
        source,
        workspace: Object.freeze({
          ...workspace,
          path,
          folderWorkspace: Object.freeze({ ...workspace.folderWorkspace })
        }),
        env,
        launchConfig: Object.freeze({
          agentCommand: 'native_stub_session_test',
          agentArgs: '',
          agentEnv: env
        }),
        phase: 'prepared'
      })
      return permit
    },
    revoke() {
      revoked = true
    }
  })
  compositions.set(result, composition)
  return result
}

export function bindNativeStubSessionTestComposition(
  candidate: NativeStubSessionTestComposition | undefined,
  binding: Binding
): void {
  if (candidate === undefined) {
    return
  }
  const composition = compositions.get(candidate)
  if (!composition || composition.binding) {
    throw new Error('native_stub_composition_invalid')
  }
  composition.assertCurrent()
  const profile = binding.store?.getProfileStorageDirectory?.()
  if (!profile || !within(canonical(join(composition.userData, 'profiles')), canonical(profile))) {
    throw new Error('native_stub_profile_mismatch')
  }
  composition.provider = binding.readInProcessProvider()
  composition.binding = binding
  composition.profile = canonical(profile)
  composition.generation = binding.generation()
  assertBinding(composition, binding.runtime)
}

function assertBinding(composition: Composition, runtime: object): void {
  composition.assertCurrent()
  const binding = composition.binding
  if (
    !binding ||
    binding.runtime !== runtime ||
    !binding.isLocalDesktop() ||
    binding.generation() !== composition.generation ||
    binding.readInProcessProvider() !== composition.provider ||
    binding.store?.coordinatedAutomationDefinitionAuthority?.() !== 'desktop' ||
    canonical(binding.store.getProfileStorageDirectory?.() ?? '') !== composition.profile
  ) {
    throw new Error('native_stub_runtime_or_profile_changed')
  }
}

function assertFolder(composition: Composition, id: string) {
  const store = composition.binding?.store
  const folder = store?.getFolderWorkspace?.(id)
  if (
    !folder ||
    folder.connectionId ||
    (folder.executionHostId && folder.executionHostId !== 'local') ||
    folder.isArchived ||
    canonical(folder.folderPath) === composition.home ||
    within(composition.home, canonical(folder.folderPath)) ||
    !within(composition.userData, canonical(folder.folderPath))
  ) {
    throw new Error('native_stub_local_workspace_required')
  }
  const group = store?.getProjectGroups?.().find((group) => group.id === folder.projectGroupId)
  if (!group || group.connectionId) {
    throw new Error('native_stub_local_workspace_required')
  }
  const target = resolveLocalLaunchScopeRuntime(store!, {
    id: `folder:${id}`,
    path: folder.folderPath,
    connectionId: null,
    repo: null,
    folderWorkspace: folder
  })
  if (target && (target.status !== 'resolved' || target.runtime.kind === 'wsl')) {
    throw new Error('native_stub_local_workspace_required')
  }
  return folder
}

export function requireNativeStubLaunch(
  permit: PreparedNativeStubLaunch,
  runtime?: object
): NativeStubLaunchRecord {
  const record = permits.get(permit)
  if (!record) {
    throw new Error('native_stub_permit_invalid')
  }
  assertBinding(record.composition, runtime ?? record.runtime)
  if (record.phase === 'dispatched') {
    throw new Error('native_stub_already_dispatched')
  }
  const folder = assertFolder(record.composition, record.workspace.folderWorkspace!.id)
  if (
    canonical(folder.folderPath) !== record.workspace.path ||
    canonical(record.workspace.path) !== record.workspace.path
  ) {
    throw new Error('native_stub_workspace_changed')
  }
  const source = getRuntimeSourceStamp(
    record.composition.binding!.runtime,
    record.composition.userData
  )
  if (JSON.stringify(source) !== JSON.stringify(record.source)) {
    throw new Error('native_stub_runtime_source_changed')
  }
  record.assertDispatchCurrent?.()
  return record
}

export function consumeNativeStubLaunch(permit: PreparedNativeStubLaunch): NativeStubLaunchRecord {
  const record = requireNativeStubLaunch(permit)
  const { composition } = record
  if (
    !record.surface ||
    requireNativeStubReportBundle(getAppEnvironment().getAppPath()) !== composition.fixture ||
    canonical(process.execPath) !== composition.file ||
    digest(composition.file) !== composition.fileDigest
  ) {
    throw new Error('native_stub_executable_changed')
  }
  // Never reopen this permit after dispatch, including a lost acknowledgement.
  record.phase = 'dispatched'
  return record
}

export function isDispatchedNativeStubLaunch(
  permit: PreparedNativeStubLaunch | undefined
): boolean {
  return permit !== undefined && permits.get(permit)?.phase === 'dispatched'
}

export type NativeStubCompositionIdentity = Readonly<{ profile: string; generation: string }>

export function assertNativeStubComposition(
  candidate: NativeStubSessionTestComposition,
  runtime: OrcaRuntimeService,
  store: RuntimeStore
): NativeStubCompositionIdentity {
  const composition = compositions.get(candidate)
  if (!composition || composition.binding?.store !== store) {
    throw new Error('native_stub_composition_invalid')
  }
  assertBinding(composition, runtime)
  return { profile: composition.profile!, generation: composition.generation! }
}

/** Permit-state seam for the physical-spawn observation module; never a serialized authority. */
export function readNativeStubLaunchRecord(
  permit: PreparedNativeStubLaunch
): NativeStubLaunchRecord | undefined {
  return permits.get(permit)
}
