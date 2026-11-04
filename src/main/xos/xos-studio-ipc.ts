// XOS fork: IPC for the Persona & Media Studio (stage F) and the Cross-Project Portfolio rollup
// (stage G). Registered from xos-goal-ipc.ts with one line; all writes are audited in the modules.
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { ipcMain } from 'electron'
import type { XosActionResult } from '../../shared/xos-goals-types'
import type { XosPersonaMutation } from '../../shared/xos-persona-types'
import type { XosPortfolioMutation } from '../../shared/xos-portfolio-types'
import { listGoalProjects, type XosRepoSource } from './xos-goal-board'
import { applyPersonaMutation, readPersonaStudio, resolvePersonaImage } from './xos-persona-studio'
import { buildPortfolioRollup } from './xos-portfolio-rollup'
import { computeRepoAnalytics } from './xos-analytics'
import { applyPortfolioMutation } from './xos-portfolio-config'

const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

async function projectRootFor(repos: XosRepoSource, projectKey: string): Promise<string | null> {
  const projects = await listGoalProjects(repos)
  return projects.find((project) => project.root === projectKey)?.root ?? null
}

export function registerXosStudioHandlers(repos: XosRepoSource): void {
  ipcMain.handle('xos:analytics:project', async (_event, args: { projectKey: string }) => {
    const root = await projectRootFor(repos, args?.projectKey)
    return root ? computeRepoAnalytics(root) : null
  })

  ipcMain.handle(
    'xos:persona:studio',
    async (_event, args: { projectKey: string; goal: string }) => {
      const root = await projectRootFor(repos, args?.projectKey)
      return root ? readPersonaStudio(root, args.goal) : null
    }
  )

  ipcMain.handle(
    'xos:persona:mutate',
    async (
      _event,
      args: { projectKey: string; goal: string; mutation: XosPersonaMutation }
    ): Promise<XosActionResult> => {
      const root = await projectRootFor(repos, args?.projectKey)
      if (!root) {
        return { ok: false, error: 'That project was not found. Refresh the board.' }
      }
      return applyPersonaMutation(root, args.goal, args.mutation)
    }
  )

  ipcMain.handle(
    'xos:persona:image',
    async (
      _event,
      args: { projectKey: string; goal: string; gallery: string; filename: string }
    ) => {
      const root = await projectRootFor(repos, args?.projectKey)
      if (!root) {
        return null
      }
      const path = resolvePersonaImage(root, args.goal, args.gallery, args.filename)
      const mime = path ? IMAGE_TYPES[extname(path).toLowerCase()] : undefined
      if (!path || !mime) {
        return null
      }
      try {
        if (statSync(path).size > IMAGE_MAX_BYTES) {
          return null
        }
        return `data:${mime};base64,${readFileSync(path).toString('base64')}`
      } catch {
        return null
      }
    }
  )

  ipcMain.handle('xos:portfolio:rollup', () => buildPortfolioRollup(repos))

  ipcMain.handle(
    'xos:portfolio:mutate',
    async (_event, mutation: XosPortfolioMutation): Promise<XosActionResult> =>
      applyPortfolioMutation(mutation)
  )
}
