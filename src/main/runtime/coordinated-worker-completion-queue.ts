import { isFinalAutomationRunStatus } from '../../shared/automations-types'
import type { CoordinatedAutomationRunHost } from '../automations/coordinated-automation-run-host-types'
import type { CoordinatedRunSelectionInput } from '../../shared/rpc-contract/coordinated-automation-run-params'
import type { RuntimeStore } from './runtime-store-contract'

export function enqueueCoordinatedWorkerCompletion(
  input: {
    queued: Set<string>
    store: RuntimeStore | null
    getHost: () => CoordinatedAutomationRunHost | null
    isAvailable: () => boolean
    reconcile: (selection: CoordinatedRunSelectionInput) => Promise<unknown>
  },
  mailbox: string,
  messageType: string | undefined,
  runtimeId: string
): void {
  if (messageType !== 'worker_done' || !mailbox.startsWith('run:')) {
    return
  }
  const host = input.getHost()
  if (host?.executionKind !== 'native' || input.queued.has(mailbox)) {
    return
  }
  input.queued.add(mailbox)
  // Native mail is committed before this nudge; the existing parent lane owns admission/dispatch.
  void Promise.resolve()
    .then(async () => {
      input.queued.delete(mailbox)
      if (input.getHost() !== host || !input.isAvailable()) {
        return
      }
      const matches = input.store!.listAutomationRuns!().filter(
        (run) =>
          run.orchestrationRunId === mailbox.slice(4) &&
          run.resolvedSnapshot &&
          !isFinalAutomationRunStatus(run.status)
      )
      if (matches.length !== 1) {
        return
      }
      const run = matches[0]
      await input.reconcile({
        runtimeId,
        automationId: run.automationId,
        automationRunId: run.id,
        expectedOwner: { selector: { kind: 'self' } }
      })
    })
    .catch((error: unknown) => {
      console.warn(`[automations] native completion reconciliation failed for ${mailbox}:`, error)
    })
}
