import { isDeepStrictEqual } from 'node:util'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'
import type { TerminalWorkspaceLaunchScope } from './runtime-legacy-worker-terminal-recovery-types'
import type { RuntimePtySpawnArgs } from '../ipc/pty/runtime/spawn-state'
import type { PtySpawnOptions } from '../providers/pty-provider-contract'
import {
  requireNativeStubLaunch,
  type PreparedNativeStubLaunch
} from './native-stub-session-test-host'

const createKeys = new Set([
  'preparedNativeStub',
  'startupAgent',
  'title',
  'launchSource',
  'suppressStartupUpdatePrompt',
  'surfaceOwner',
  'signal',
  'onPtySpawnCommitted',
  'onPtySpawnDispatched'
])

export function assertNativeStubCreateOptions(runtime: object, opts: TerminalCreateOptions): void {
  requireNativeStubLaunch(opts.preparedNativeStub!, runtime)
  if (
    Object.keys(opts).some((key) => !createKeys.has(key)) ||
    opts.startupAgent !== 'codex' ||
    opts.surfaceOwner !== false ||
    opts.signal?.aborted
  ) {
    throw new Error('native_stub_create_override')
  }
}

export function beginNativeStubTerminal(
  runtime: object,
  selector: string | undefined,
  opts: TerminalCreateOptions
): void {
  assertNativeStubCreateOptions(runtime, opts)
  const record = requireNativeStubLaunch(opts.preparedNativeStub!, runtime)
  if (record.phase !== 'prepared') {
    throw new Error('native_stub_create_reused')
  }
  if (selector !== `id:${record.workspace.id}`) {
    throw new Error('native_stub_workspace_mismatch')
  }
  record.phase = 'creating'
}

export function resolveNativeStubTerminalOptions(
  runtime: object,
  workspace: TerminalWorkspaceLaunchScope,
  opts: TerminalCreateOptions
): TerminalCreateOptions {
  const record = requireNativeStubLaunch(opts.preparedNativeStub!, runtime)
  assertNativeStubCreateOptions(runtime, opts)
  if (
    workspace.id !== record.workspace.id ||
    workspace.path !== record.workspace.path ||
    workspace.connectionId
  ) {
    throw new Error('native_stub_workspace_mismatch')
  }
  return { ...opts, launchAgent: 'codex', launchConfig: record.launchConfig, env: record.env }
}

export function bindNativeStubSurface(
  permit: PreparedNativeStubLaunch,
  surface: {
    handle: string
    tabId: string
    leafId: string
    token: string
  }
): void {
  const record = requireNativeStubLaunch(permit)
  if (record.surface || !surface.token || record.phase !== 'creating') {
    throw new Error('native_stub_surface_reused')
  }
  record.surface = Object.freeze({ ...surface })
}

export function nativeStubSpawnEnvironment(
  permit: PreparedNativeStubLaunch
): Record<string, string> {
  const record = requireNativeStubLaunch(permit)
  const surface = record.surface
  if (!surface) {
    throw new Error('native_stub_surface_missing')
  }
  return Object.freeze({
    ...record.env,
    ORCA_AGENT_LAUNCH_TOKEN: surface.token,
    ORCA_TERMINAL_HANDLE: surface.handle,
    ORCA_WORKSPACE_ID: record.workspace.id,
    ORCA_WORKTREE_ID: record.workspace.id,
    ORCA_TAB_ID: surface.tabId,
    ORCA_PANE_KEY: `${surface.tabId}:${surface.leafId}`
  })
}

export function assertNativeStubRuntimeSpawn(args: RuntimePtySpawnArgs, runtime?: object): void {
  const record = requireNativeStubLaunch(args.preparedNativeStub!, runtime)
  const surface = record.surface
  if (
    !surface ||
    args.worktreeId !== record.workspace.id ||
    args.cwd !== record.workspace.path ||
    args.preAllocatedHandle !== surface.handle ||
    args.tabId !== surface.tabId ||
    args.leafId !== surface.leafId ||
    args.launchToken !== surface.token ||
    args.launchAgent !== 'codex' ||
    args.launchConfig !== record.launchConfig ||
    args.command !== undefined ||
    args.connectionId ||
    args.sessionId ||
    args.resumeProviderSession ||
    args.launchRuntime ||
    args.shellOverride ||
    args.envToDelete ||
    args.startupCommandDelivery ||
    args.agentSessionEnsure ||
    args.agentSessionCreateOperationId ||
    args.adoptedStablePane ||
    args.expectedSourceBinding ||
    args.paneSpawnOperation?.mustExist ||
    args.signal?.aborted ||
    !isDeepStrictEqual(args.env, nativeStubSpawnEnvironment(args.preparedNativeStub!))
  ) {
    throw new Error('native_stub_spawn_override')
  }
}

const providerKeys = new Set([
  'preparedNativeStub',
  'cols',
  'rows',
  'cwd',
  'env',
  'launchAgent',
  'worktreeId',
  'signal',
  'onPtySpawnCommitted'
])

export function assertNativeStubProviderSpawn(args: PtySpawnOptions): void {
  const record = requireNativeStubLaunch(args.preparedNativeStub!)
  if (
    Object.keys(args).some((key) => !providerKeys.has(key)) ||
    args.cwd !== record.workspace.path ||
    args.worktreeId !== record.workspace.id ||
    args.launchAgent !== 'codex' ||
    args.signal?.aborted ||
    !isDeepStrictEqual(args.env, nativeStubSpawnEnvironment(args.preparedNativeStub!))
  ) {
    throw new Error('native_stub_provider_override')
  }
}
