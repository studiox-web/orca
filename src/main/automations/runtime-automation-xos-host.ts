import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { AutomationService } from './service'
import { registerXosAutomationHost } from '../xos/xos-run-gate'
import { cancelAutomationChatRun } from './automation-chat-run-cancel'

export function bindRuntimeAutomationXosHost({
  store,
  runtime,
  service,
  launchedHandles
}: {
  store: Store
  runtime: OrcaRuntimeService
  service: AutomationService
  launchedHandles: ReadonlyMap<string, string>
}): void {
  // XOS fork: stage A lane locks, run timeouts and fallback retries need these.
  registerXosAutomationHost({
    findRun: (automationId, runId) =>
      store.listAutomationRuns(automationId).find((entry) => entry.id === runId) ?? null,
    findAutomation: (id) => store.listAutomations().find((entry) => entry.id === id) ?? null,
    runNow: (automationId, trigger) => service.runNow(automationId, trigger),
    markDispatchResult: (result) => service.markDispatchResult(result),
    closeRunTerminal: async (run) => {
      if (run.sessionKind === 'chat') {
        await cancelAutomationChatRun(runtime, run)
        return
      }
      const paneKey = run.terminalPaneKey
      const handle = paneKey
        ? (launchedHandles.get(paneKey) ?? runtime.getTerminalHandleForPaneKey(paneKey))
        : null
      if (handle) {
        await runtime.closeTerminal(handle)
      }
    }
  })
}
