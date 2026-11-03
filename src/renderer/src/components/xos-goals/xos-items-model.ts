// XOS fork: pure view model for Tasks → Goals. Merges projects (All projects), picks the item type,
// and builds board columns / list rows from the main-process snapshot.
import type {
  XosItemStage,
  XosItemType,
  XosItemsSnapshot,
  XosWorkItem
} from '../../../../shared/xos-items-types'

export const ALL_PROJECTS = 'all'

export type XosViewItem = XosWorkItem & { projectKey: string; projectName: string }

export type XosItemColumn = {
  stage: XosItemStage
  items: XosViewItem[]
  /** Items not returned because of the per-stage cap. */
  hidden: number
}

export type XosItemsSort = 'updated' | 'created' | 'priority' | 'title'

function mergeStage(left: XosItemStage, right: XosItemStage): XosItemStage {
  const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])]
  return {
    ...left,
    paths: [...left.paths, ...right.paths],
    count: left.count + right.count,
    readyCount:
      left.readyCount === null && right.readyCount === null
        ? null
        : (left.readyCount ?? 0) + (right.readyCount ?? 0),
    // A floor/ceiling is per project; a sum across projects has no meaningful band.
    floor: null,
    ceiling: null,
    readers: union(left.readers, right.readers),
    writers: union(left.writers, right.writers)
  }
}

/** Item types across the selected projects; stages with the same id are merged, order kept. */
export function selectedTypes(snapshot: XosItemsSnapshot, projectKey: string): XosItemType[] {
  const byId = new Map<string, XosItemType>()
  for (const project of snapshot.projects) {
    if (projectKey !== ALL_PROJECTS && project.projectKey !== projectKey) {
      continue
    }
    for (const type of project.types) {
      const existing = byId.get(type.id)
      if (!existing) {
        byId.set(type.id, { ...type, stages: [...type.stages] })
        continue
      }
      for (const stage of type.stages) {
        const index = existing.stages.findIndex((candidate) => candidate.id === stage.id)
        if (index === -1) {
          existing.stages.push(stage)
        } else {
          existing.stages[index] = mergeStage(existing.stages[index], stage)
        }
      }
    }
  }
  return [...byId.values()]
}

export function selectedItems(
  snapshot: XosItemsSnapshot,
  projectKey: string,
  typeId: string
): XosViewItem[] {
  return snapshot.projects
    .filter((project) => projectKey === ALL_PROJECTS || project.projectKey === projectKey)
    .flatMap((project) =>
      project.items
        .filter((item) => item.typeId === typeId)
        .map((item) => ({
          ...item,
          projectKey: project.projectKey,
          projectName: project.projectName
        }))
    )
}

export function buildColumns(type: XosItemType, items: XosViewItem[]): XosItemColumn[] {
  return type.stages.map((stage) => {
    const columnItems = items.filter((item) => item.stageId === stage.id).sort(byUpdatedDesc)
    return { stage, items: columnItems, hidden: Math.max(0, stage.count - columnItems.length) }
  })
}

function byUpdatedDesc(left: XosViewItem, right: XosViewItem): number {
  return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
}

const PRIORITY_ORDER: Record<string, number> = {
  p0: 0,
  critical: 0,
  urgent: 0,
  p1: 1,
  high: 1,
  p2: 2,
  medium: 2,
  normal: 2,
  p3: 3,
  low: 3
}

export function chipValue(item: XosWorkItem, key: string): string | null {
  return item.chips.find((chip) => chip.key === key)?.value ?? null
}

function priorityRank(item: XosWorkItem): number {
  const value = chipValue(item, 'priority')?.toLowerCase()
  const rank = Number(chipValue(item, 'rank'))
  return (value ? (PRIORITY_ORDER[value] ?? 4) : 5) * 1000 + (Number.isFinite(rank) ? rank : 999)
}

export function sortItems(items: XosViewItem[], sort: XosItemsSort): XosViewItem[] {
  const sorted = [...items]
  switch (sort) {
    case 'updated':
      return sorted.sort(byUpdatedDesc)
    case 'created':
      return sorted.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
    case 'priority':
      return sorted.sort((a, b) => priorityRank(a) - priorityRank(b) || byUpdatedDesc(a, b))
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title))
  }
}

export function stageTone(stage: XosItemStage): 'idle' | 'ok' | 'starved' | 'backed-up' {
  const count = stage.readyCount ?? stage.count
  if (stage.ceiling !== null && count >= stage.ceiling) {
    return 'backed-up'
  }
  if (stage.floor !== null && count < stage.floor) {
    return 'starved'
  }
  return count === 0 ? 'idle' : 'ok'
}

export const TONE_CLASS: Record<'idle' | 'ok' | 'starved' | 'backed-up', string> = {
  idle: 'xos-tone-neutral',
  ok: 'xos-tone-success',
  starved: 'xos-tone-warning',
  'backed-up': 'xos-tone-danger'
}

export function prettyGoal(goal: string): string {
  return goal.replace(/-/g, ' ')
}
