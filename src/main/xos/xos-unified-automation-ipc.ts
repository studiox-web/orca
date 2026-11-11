import { ipcMain } from 'electron'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import { parseExecutionHostId } from '../../shared/execution-host'
import { buildUnifiedAutomationSnapshot } from '../../shared/unified-automation-read-model'
import { LOCAL_UNIFIED_AUTHORITY } from '../../shared/unified-automation-source-adapters'
import { buildXosGoalBoard, type XosRepoSource } from './xos-goal-board'
import { rememberProjects } from './xos-project-registry'
import { listRunConfigs } from './xos-runtime-store'

export type XosUnifiedAutomationSource = XosRepoSource & {
  listAutomations(): Automation[]
  listAutomationRuns(automationId?: string): AutomationRun[]
}

export function registerXosUnifiedAutomationHandler(repos: XosUnifiedAutomationSource): void {
  ipcMain.handle('xos:goals:getUnifiedAutomations', async () => {
    const board = await buildXosGoalBoard(repos)
    const automations = repos
      .listAutomations()
      .filter(
        (automation) =>
          automation.schedulerOwner !== 'remote_host_service' &&
          parseExecutionHostId(automation.runContext?.hostId)?.kind !== 'runtime'
      )
    const automationIds = new Set(automations.map((automation) => automation.id))
    rememberProjects(board.projects.map(({ root, name }) => ({ root, name })))
    return buildUnifiedAutomationSnapshot({
      board,
      automations,
      runs: repos.listAutomationRuns().filter((run) => automationIds.has(run.automationId)),
      runConfigs: listRunConfigs(),
      runConfigAuthority: LOCAL_UNIFIED_AUTHORITY
    })
  })
}
