import type { OrcaRuntimeWithStateFields } from './construction/runtime-construction'
import { isDeepStrictEqual } from 'node:util'
import type { RuntimeStore } from './runtime-store-contract'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'
import type { TerminalWorkspaceLaunchScope } from './runtime-legacy-worker-terminal-recovery-types'
import type { RuntimePtySpawnArgs } from '../ipc/pty/runtime/spawn-state'
import type { PtySpawnOptions } from '../providers/pty-provider-contract'
import {
  requireNativeProviderLaunch,
  type PreparedNativeProviderLaunch
} from './native-provider-execution-admission'
import { requireCoordinatedNativeSandbox } from './coordinated-native-sandbox/coordinated-native-sandbox-launch'

const createKeys = new Set([
  'preparedNativeProvider',
  'startupAgent',
  'launchPreferences',
  'title',
  'launchSource',
  'suppressStartupUpdatePrompt',
  'surfaceOwner',
  'preAllocatedHandle',
  'onPtySpawnCommitted'
])

export function beginNativeProviderTerminal(
  runtime: OrcaRuntimeWithStateFields,
  selector: string | undefined,
  opts: TerminalCreateOptions
): void {
  const permit = requireNativeProviderLaunch(opts.preparedNativeProvider!, runtime)
  const selection = permit.selection
  if (
    permit.phase !== 'prepared' ||
    selector !== `id:${selection.workspaceId}` ||
    Object.keys(opts).some((key) => !createKeys.has(key)) ||
    opts.startupAgent !== selection.agent ||
    opts.surfaceOwner !== false ||
    (opts.launchPreferences?.model ?? null) !== selection.model ||
    (opts.launchPreferences?.effort ?? null) !== selection.effort
  ) {
    throw new Error('native_provider_create_override')
  }
  permit.phase = 'creating'
}

export function assertNativeProviderWorkspace(
  candidate: PreparedNativeProviderLaunch,
  workspace: TerminalWorkspaceLaunchScope
): void {
  const { selection } = requireNativeProviderLaunch(candidate)
  if (
    workspace.id !== selection.workspaceId ||
    workspace.path !== selection.path ||
    workspace.connectionId
  ) {
    throw new Error('native_provider_workspace_changed')
  }
}

export function nativeProviderStartupSettings(
  candidate: PreparedNativeProviderLaunch,
  settings: ReturnType<RuntimeStore['getSettings']>
): ReturnType<RuntimeStore['getSettings']> {
  const { selection } = requireNativeProviderLaunch(candidate)
  if (settings.agentCmdOverrides?.[selection.agent]) {
    throw new Error('native_provider_command_override_unsupported')
  }
  if (requireCoordinatedNativeSandbox(candidate)) {
    return {
      ...settings,
      agentPermissionDefault: 'own',
      agentPermissionOverrides: { ...settings.agentPermissionOverrides, codex: 'own' },
      agentLaunchChoices: { ...settings.agentLaunchChoices, codex: undefined },
      agentDefaultArgs: {
        ...settings.agentDefaultArgs,
        codex: '-a never --strict-config --no-daemon'
      }
    }
  }
  // Frozen null choices mean provider defaults, never the current profile's saved choices.
  return {
    ...settings,
    agentLaunchChoices: { ...settings.agentLaunchChoices, [selection.agent]: undefined },
    agentDefaultArgs: { ...settings.agentDefaultArgs, [selection.agent]: null }
  }
}

export function bindNativeProviderCommand(
  candidate: PreparedNativeProviderLaunch,
  opts: TerminalCreateOptions
): void {
  const permit = requireNativeProviderLaunch(candidate)
  if (
    permit.command ||
    !opts.command ||
    !opts.launchConfig ||
    opts.launchAgent !== permit.selection.agent
  ) {
    throw new Error('native_provider_launch_changed')
  }
  permit.command = opts.command
  permit.launchConfig = structuredClone(opts.launchConfig)
}

export function assertNativeProviderRuntimeSpawn(
  args: RuntimePtySpawnArgs,
  runtime?: OrcaRuntimeWithStateFields
): void {
  const permit = requireNativeProviderLaunch(args.preparedNativeProvider!, runtime)
  if (
    permit.phase !== 'creating' ||
    args.worktreeId !== permit.selection.workspaceId ||
    args.cwd !== permit.selection.path ||
    args.launchAgent !== permit.selection.agent ||
    args.command !== permit.command ||
    !isDeepStrictEqual(args.launchConfig, permit.launchConfig) ||
    args.connectionId ||
    args.resumeProviderSession ||
    args.adoptedStablePane ||
    args.expectedSourceBinding ||
    args.paneSpawnOperation?.mustExist ||
    args.signal?.aborted
  ) {
    throw new Error('native_provider_spawn_override')
  }
}

export function assertNativeProviderPhysicalSpawn(args: PtySpawnOptions): void {
  const permit = requireNativeProviderLaunch(args.preparedNativeProvider!)
  if (
    permit.phase !== 'creating' ||
    args.worktreeId !== permit.selection.workspaceId ||
    args.cwd !== permit.selection.path ||
    args.launchAgent !== permit.selection.agent ||
    args.command !== permit.command ||
    args.attachOnly ||
    args.signal?.aborted
  ) {
    throw new Error('native_provider_physical_spawn_override')
  }
}
