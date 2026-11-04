// XOS fork: Stage C board-scoped `orca goals` handlers (project-wide import and listing).
import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { cliRepoSource } from '../../main/xos/xos-goal-cli'
import { buildXosGoalBoard } from '../../main/xos/xos-goal-board'
import { importProjectGoals } from '../../main/xos/xos-project-import'
import { listCliGoals } from '../../main/xos/xos-usage-models-cli'

function printOut(json: boolean, payload: unknown, text: string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text)
}

export const XOS_GOALS_BOARD_HANDLERS: Record<string, CommandHandler> = {
  'goals import': async ({ flags, cwd, json }) => {
    const repoPath = resolve(cwd, getOptionalStringFlag(flags, 'repo') ?? '.')
    const result = await importProjectGoals(repoPath)
    const { meta, homeDir } = result
    printOut(
      json,
      result,
      `Imported ${meta.name} into ${homeDir} (goals: ${meta.goalsImported}, items: ${meta.itemsImported}, shared: ${meta.sharedFilesImported})`
    )
  },

  'goals list': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const areaFilter = getOptionalStringFlag(flags, 'area')
    const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const goals = listCliGoals({ board, projectFilter, areaFilter, cwd })
    printOut(
      json,
      { projects: board.projects.map((p) => p.name), goals },
      goals.length === 0
        ? 'No matching goals.'
        : goals
            .map(
              (g) =>
                `${g.project}/${g.goal} [${g.area.title}] (${g.activeCount} active, ${g.pausedCount} paused) — ${g.title}`
            )
            .join('\n')
    )
  }
}
