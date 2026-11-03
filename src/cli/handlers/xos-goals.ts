import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { importProjectGoals } from '../../main/xos/xos-project-home'

export const XOS_GOALS_HANDLERS: Record<string, CommandHandler> = {
  'goals import': async ({ flags, cwd, json }) => {
    const repoArg = getOptionalStringFlag(flags, 'repo') ?? '.'
    const repoPath = resolve(cwd, repoArg)
    const result = await importProjectGoals(repoPath)
    if (json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const { meta, homeDir } = result
    console.log(
      [
        `Imported ${meta.name} into ${homeDir}`,
        `  goals: ${meta.goalsImported}`,
        `  items: ${meta.itemsImported}`,
        `  shared files: ${meta.sharedFilesImported}`,
        ...(meta.commitSha ? [`  commit: ${meta.commitSha}`] : [])
      ].join('\n')
    )
  }
}
