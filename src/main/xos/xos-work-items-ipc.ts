// XOS fork: IPC for Tasks → Goals (§3h stage 0 + stage C CRUD & transition timeline).
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type {
  XosItemActionResult,
  XosItemDetail,
  XosItemMutation,
  XosItemsSnapshot,
  XosProjectItems,
  XosWorkItem
} from '../../shared/xos-items-types'
import { listGoalProjects, type XosRepoSource } from './xos-goal-board'
import { isDirectory, safeReaddir } from './xos-goal-files'
import { resolveProjectGoalsDir } from './xos-project-home'
import { readItemSummary, scanProjectQueues, toItemStage } from './xos-work-items'
import {
  createWorkItem,
  editWorkItem,
  moveWorkItem,
  readWorkItemDetailForRoots
} from './xos-work-items-crud'

const PER_STAGE_LIMIT = 60

function knownGoals(root: string): Set<string> {
  const dir = resolveProjectGoalsDir(root)
  return new Set(safeReaddir(dir).filter((name) => isDirectory(join(dir, name))))
}

export async function buildItemsSnapshot(
  repos: XosRepoSource,
  projectKey: string | null
): Promise<XosItemsSnapshot> {
  const projects: XosProjectItems[] = []
  for (const project of await listGoalProjects(repos)) {
    if (projectKey && project.root !== projectKey) {
      continue
    }
    const goals = knownGoals(project.root)
    const scan = scanProjectQueues(project.root, { activeOnly: false })
    const items: XosWorkItem[] = []
    for (const { type, stages } of scan) {
      for (const scanned of stages) {
        for (const file of scanned.files.slice(0, PER_STAGE_LIMIT)) {
          items.push(readItemSummary(file, type.id, scanned.stage))
        }
      }
    }
    projects.push({
      projectKey: project.root,
      projectName: project.name,
      types: scan.map(({ type, stages }) => ({
        id: type.id,
        label: type.label,
        stages: stages.map((scanned) => toItemStage(scanned, goals))
      })),
      items,
      perStageLimit: PER_STAGE_LIMIT
    })
  }
  return { generatedAt: new Date().toISOString(), projects }
}

/** Reads one item and its transition timeline from a known stage folder of a goal project. */
export async function readItemDetail(
  repos: XosRepoSource,
  requested: string
): Promise<XosItemDetail | null> {
  const roots = (await listGoalProjects(repos)).map((project) => project.root)
  return readWorkItemDetailForRoots(roots, requested)
}

export async function applyItemMutation(
  repos: XosRepoSource,
  mutation: XosItemMutation
): Promise<XosItemActionResult> {
  const projects = await listGoalProjects(repos)
  const roots = projects.map((project) => project.root)
  switch (mutation.kind) {
    case 'create': {
      const project =
        projects.find((p) => p.root === mutation.projectKey || p.name === mutation.projectKey) ??
        projects[0]
      if (!project) {
        return { ok: false, error: 'Project not found for work item creation.' }
      }
      return createWorkItem({
        repoRoot: project.root,
        typeId: mutation.typeId,
        stageId: mutation.stageId,
        title: mutation.title,
        body: mutation.body,
        priority: mutation.priority,
        size: mutation.size,
        risk: mutation.risk,
        ready: mutation.ready
      })
    }
    case 'move':
      return moveWorkItem({
        roots,
        pathOrQuery: mutation.path,
        toStageId: mutation.toStageId,
        bucket: mutation.bucket,
        goal: mutation.goal
      })
    case 'edit':
      return editWorkItem({
        roots,
        pathOrQuery: mutation.path,
        title: mutation.title,
        ready: mutation.ready,
        updates: mutation.updates,
        body: mutation.body
      })
  }
}

export function registerXosWorkItemHandlers(repos: XosRepoSource): void {
  ipcMain.handle('xos:items:list', (_event, args: { projectKey: string | null }) =>
    buildItemsSnapshot(repos, args?.projectKey ?? null)
  )
  ipcMain.handle('xos:items:get', (_event, args: { path: string }) =>
    typeof args?.path === 'string' ? readItemDetail(repos, args.path) : null
  )
  ipcMain.handle('xos:items:mutate', (_event, mutation: XosItemMutation) =>
    applyItemMutation(repos, mutation)
  )
}
