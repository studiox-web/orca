import type { OrcaRuntimeWithStateFields } from '../../construction/runtime-construction'
import { beginNativeStubTerminal, bindNativeStubSurface } from '../../native-stub-launch-options'
import { requireNativeStubLaunch } from '../../native-stub-session-test-host'
import { beginNativeProviderTerminal } from '../../native-provider-launch-options'
import { requireNativeProviderLaunch } from '../../native-provider-execution-admission'
import type { TerminalCreateOptions } from '../../runtime-terminal-contracts'

export function begin(
  runtime: OrcaRuntimeWithStateFields,
  selector: string | undefined,
  opts: TerminalCreateOptions
): TerminalCreateOptions {
  if (opts.preparedNativeProvider !== undefined) {
    beginNativeProviderTerminal(runtime, selector, opts)
    opts = Object.freeze({ ...opts })
  }
  if (opts.preparedNativeStub !== undefined) {
    beginNativeStubTerminal(runtime, selector, opts)
    opts = Object.freeze({ ...opts })
  }
  return opts
}

export function assertCurrent(
  runtime: OrcaRuntimeWithStateFields,
  opts: TerminalCreateOptions
): void {
  if (opts.preparedNativeStub) {
    requireNativeStubLaunch(opts.preparedNativeStub, runtime)
  }
  if (opts.preparedNativeProvider) {
    requireNativeProviderLaunch(opts.preparedNativeProvider, runtime)
  }
}

export function bindSurface(
  opts: TerminalCreateOptions,
  handle: string,
  tabId: string,
  leafId: string,
  token: string | undefined
): void {
  if (opts.preparedNativeStub) {
    bindNativeStubSurface(opts.preparedNativeStub, { handle, tabId, leafId, token: token! })
  }
}

export function spawnPermits(opts: TerminalCreateOptions) {
  return {
    ...(opts.preparedNativeStub ? { preparedNativeStub: opts.preparedNativeStub } : {}),
    ...(opts.preparedNativeProvider ? { preparedNativeProvider: opts.preparedNativeProvider } : {})
  }
}

export {
  assertNativeProviderWorkspace as assertWorkspace,
  bindNativeProviderCommand as bindCommand
} from '../../native-provider-launch-options'

export function isRequested(opts: TerminalCreateOptions): boolean {
  return !!(opts.preparedNativeStub || opts.preparedNativeProvider)
}
