// XOS fork: Stage C work-item reads — locating an item across project queues and reading its
// detail with the transition timeline (§3h.2). Electron-free so both IPC and CLI use it.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import type { XosItemDetail, XosWorkItem } from '../../shared/xos-items-types'
import { parseFrontmatter } from './xos-goal-files'
import { readTransitionEvents } from './xos-item-claims'
import type { LegacyItemType, LegacyStage } from './xos-queue-map'
import { readItemSummary, scanProjectQueues } from './xos-work-items'

const DETAIL_MAX_BYTES = 256 * 1024

export type LocatedWorkItem = {
  repoRoot: string
  type: LegacyItemType
  stage: LegacyStage
  item: XosWorkItem
}

function within(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

export function locateWorkItem(
  roots: string[],
  query: string,
  filters?: { typeId?: string; stageId?: string }
): LocatedWorkItem | null {
  const resolvedQuery = resolve(query)
  const baseNoExt = basename(query, '.md').toLowerCase()
  for (const repoRoot of roots) {
    for (const { type, stages } of scanProjectQueues(repoRoot, { activeOnly: false })) {
      if (filters?.typeId && type.id !== filters.typeId) {
        continue
      }
      for (const scanned of stages) {
        if (filters?.stageId && scanned.stage.id !== filters.stageId) {
          continue
        }
        for (const file of scanned.files) {
          const fileBase = basename(file.path, '.md').toLowerCase()
          const stripped = fileBase.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '')
          if (
            file.path === resolvedQuery ||
            file.path === query ||
            basename(file.path).toLowerCase() === query.toLowerCase() ||
            fileBase === baseNoExt ||
            stripped === baseNoExt
          ) {
            return {
              repoRoot,
              type,
              stage: scanned.stage,
              item: readItemSummary(file, type.id, scanned.stage)
            }
          }
        }
      }
    }
  }
  return null
}

export function readWorkItemDetailForRoots(
  roots: string[],
  requested: string
): XosItemDetail | null {
  const path = resolve(requested)
  if (!path.endsWith('.md')) {
    return null
  }
  const ownerRoot = roots.find((root) =>
    scanProjectQueues(root, { activeOnly: false })
      .flatMap(({ stages }) => stages.flatMap((scanned) => scanned.dirs))
      .some((dir) => within(path, dir) && !path.slice(dir.length + 1).includes(sep))
  )
  if (!ownerRoot) {
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
    const itemSlug = basename(path, '.md')
    const transitions = readTransitionEvents(ownerRoot, 200).filter(
      (ev) => ev.item === itemSlug || ev.toPath === path || ev.fromPath === path
    )
    return { path, frontmatter, body, truncated: size > DETAIL_MAX_BYTES, transitions }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}
