import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { resolveLocalLaunchScopeRuntime } from '../local-project-runtime-resolution'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeStore } from './runtime-store-contract'
import type { OrcaRuntimeService } from './orca-runtime'
import type { TerminalWorkspaceLaunchScope } from './runtime-legacy-worker-terminal-recovery-types'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session/lifecycle/agent-session-resume'

const fixtureDigest = 'acf1eaac760b5cedcbfe1bf55009876f4842eceace0a29e57b1e370d2f51dd4d'
const compositions = new WeakMap<NativeStubSessionTestComposition, Composition>()
const permits = new WeakMap<PreparedNativeStubLaunch, NativeStubLaunchRecord>()

export type PreparedNativeStubLaunch = Readonly<{ capability: 'native_stub_session_test' }>
export type NativeStubSessionTestComposition = Readonly<{
  prepare(runtime: OrcaRuntimeService, selector: string): Promise<PreparedNativeStubLaunch>
  revoke(): void
}>
type Binding = {
  runtime: object
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
  workspace: Readonly<TerminalWorkspaceLaunchScope>
  env: Readonly<Record<string, string>>
  launchConfig: SleepingAgentLaunchConfig
  phase: 'prepared' | 'creating' | 'dispatched'
  surface?: Readonly<{ handle: string; tabId: string; leafId: string; token: string }>
}

function canonical(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('native_stub_absolute_path_required')
  }
  return realpathSync(path)
}
function within(root: string, path: string): boolean {
  const child = relative(root, path)
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}
function digest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
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
  const fixture = canonical(
    join(environment.getAppPath(), 'tests/e2e/fixtures/golden-stub-agent/golden-stub-agent.js')
  )
  if (digest(fixture) !== fixtureDigest) {
    throw new Error('native_stub_fixture_changed')
  }
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
      const env = Object.freeze({
        HOME: home,
        USERPROFILE: home,
        TMPDIR: home,
        TEMP: home,
        TMP: home,
        LANG: 'C.UTF-8',
        TERM: 'xterm-256color',
        ELECTRON_RUN_AS_NODE: '1'
      })
      const permit = Object.freeze({
        capability: 'native_stub_session_test' as const,
        toJSON() {
          throw new Error('native_stub_permit_is_process_local')
        }
      })
      permits.set(permit, {
        composition,
        runtime,
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
  return record
}

export function consumeNativeStubLaunch(permit: PreparedNativeStubLaunch): NativeStubLaunchRecord {
  const record = requireNativeStubLaunch(permit)
  const { composition } = record
  if (
    !record.surface ||
    digest(composition.fixture) !== fixtureDigest ||
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
