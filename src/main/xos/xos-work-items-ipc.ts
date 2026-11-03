// XOS fork: IPC for Tasks → Goals (§3h stage 0): a read-only board of work items over the legacy
// repo folders. Writes (move, approve, edit) come in stage C through the guarded, audited path.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { ipcMain } from 'electron'
import type {
  XosItemDetail,
  XosItemsSnapshot,
  XosProjectItems,
  XosWorkItem
} from '../../shared/xos-items-types'
import { listGoalProjects, type XosRepoSource } from './xos-goal-board'
import { isDirectory, parseFrontmatter, safeReaddir } from './xos-goal-files'
import { readItemSummary, scanProjectQueues, toItemStage } from './xos-work-items'

const PER_STAGE_LIMIT = 60
const DETAIL_MAX_BYTES = 256 * 1024

function knownGoals(root: string): Set<string> {
  const dir = join(root, 'automations', 'goals')
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

function within(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

/** Reads one item, but only from a folder that is a known stage of a goal project. */
export async function readItemDetail(
  repos: XosRepoSource,
  requested: string
): Promise<XosItemDetail | null> {
  const path = resolve(requested)
  if (!path.endsWith('.md')) {
    return null
  }
  const stageDirs = (await listGoalProjects(repos)).flatMap((project) =>
    scanProjectQueues(project.root, { activeOnly: false }).flatMap(({ stages }) =>
      stages.flatMap((scanned) => scanned.dirs)
    )
  )
  if (!stageDirs.some((dir) => within(path, dir) && !path.slice(dir.length + 1).includes(sep))) {
    return null
  }
  let fd: number | null = null
  try {
    const size = statSync(path).size
    const length = Math.min(size, DETAIL_MAX_BYTES)
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, 0)
    const text = buffer.toString('utf8')
    const frontmatter = parseFrontmatter(text)
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
    const body = end === -1 ? text : text.slice(text.indexOf('\n', end + 4) + 1)
    return { path, frontmatter, body, truncated: size > DETAIL_MAX_BYTES }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

export function registerXosWorkItemHandlers(repos: XosRepoSource): void {
  ipcMain.handle('xos:items:list', (_event, args: { projectKey: string | null }) =>
    buildItemsSnapshot(repos, args?.projectKey ?? null)
  )
  ipcMain.handle('xos:items:get', (_event, args: { path: string }) =>
    typeof args?.path === 'string' ? readItemDetail(repos, args.path) : null
  )
}
