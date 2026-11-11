import type { CoordinatedRunHostInjection } from '../automations/coordinated-automation-run-host-types'
import type { AutomationService } from '../automations/service'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { mainProcessState as state } from './main-process-state'
import { registerXosGoalHandlers } from '../xos/xos-goal-ipc'
import { xosOwnsHeadlessSchedules } from '../xos/xos-scheduler-owner'

export function initializeMainProcessAutomations(
  coordinatedRuns?: CoordinatedRunHostInjection
): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = createRuntimeAutomationService({
    store,
    runtime,
    coordinatedRuns,
    activeProfileDirectory: () => state.activeOrcaProfile?.profileDirectory ?? null,
    claudeUsage,
    codexUsage,
    // XOS local desktop explicitly succeeds the same profile owner; remote clients remain mirrors.
    headless: xosOwnsHeadlessSchedules(state.isServeMode)
  })
  state.automations = service
  // XOS fork: Automations → Org chart board over legacy goal folders and crontab.
  registerXosGoalHandlers(store, runtime)
  return service
}
