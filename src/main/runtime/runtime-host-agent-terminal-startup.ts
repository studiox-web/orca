import type { OrcaRuntimeWithStateFields } from './construction/runtime-construction'
import { resolveNativeStubTerminalOptions } from './native-stub-launch-options'
import { requireNativeProviderLaunch } from './native-provider-execution-admission'
import { applyRemoteViewerLaunchEnv } from './remote-viewer-launch-env'
import {
  resolveAgentTerminalCreateOptions,
  withHostAccountLaunchEnv
} from './runtime-agent-terminal-startup'
import type { RuntimeAccountController } from './runtime-account-controller'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'
import type { TerminalWorkspaceLaunchScope } from './runtime-legacy-worker-terminal-recovery-types'

type Host = Parameters<typeof resolveAgentTerminalCreateOptions>[2] & {
  runtime: OrcaRuntimeWithStateFields
  accounts: Pick<RuntimeAccountController, 'prepareHostAgentLaunch' | 'hostLaunchEnvFor'>
}

export async function resolveHostAgentTerminalCreateOptions(
  workspace: TerminalWorkspaceLaunchScope,
  opts: TerminalCreateOptions,
  host: Host
): Promise<TerminalCreateOptions> {
  if (opts.preparedNativeStub !== undefined) {
    return resolveNativeStubTerminalOptions(host.runtime, workspace, opts)
  }
  const resolvedLaunch = await resolveAgentTerminalCreateOptions(workspace, opts, host)
  if (opts.preparedNativeProvider) {
    requireNativeProviderLaunch(opts.preparedNativeProvider, host.runtime)
  }
  const launch = applyRemoteViewerLaunchEnv(resolvedLaunch, opts.terminalImageViewerSupported)
  // SSH launches prepare accounts on their own execution host.
  if (workspace.connectionId) {
    return launch
  }
  if (launch.launchAgent) {
    await host.accounts.prepareHostAgentLaunch(launch.launchAgent)
    if (opts.preparedNativeProvider) {
      requireNativeProviderLaunch(opts.preparedNativeProvider, host.runtime)
    }
  }
  const hostLaunchEnv = host.accounts.hostLaunchEnvFor(launch.launchAgent)
  return withHostAccountLaunchEnv(opts, launch, hostLaunchEnv)
}
