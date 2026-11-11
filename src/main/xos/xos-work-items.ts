// XOS fork: read-only scan of the legacy queue folders (§3g, §3h stage 0). One markdown file is
// one work item; the folder it sits in is its stage. Bounded: listing is readdir + stat, and only
// the first few KB of an item are read (for its title, chips and ready flag).
import { statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  XosGoalQueues,
  XosItemChip,
  XosItemStage,
  XosQueueRef,
  XosQueueTone,
  XosWorkItem
} from '../../shared/xos-items-types'
import { parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { resolveStageDirs } from './xos-project-home'
import { LEGACY_ITEM_TYPES, type LegacyItemType, type LegacyStage } from './xos-queue-map'

const ITEM_HEAD_BYTES = 8 * 1024

export type StageFile = { path: string; mtimeMs: number; bucket: string | null }

export type ScannedStage = {
  stage: LegacyStage
  dirs: string[]
  files: StageFile[]
  readyCount: number | null
}

export type ScannedType = { type: LegacyItemType; stages: ScannedStage[] }

function isItemFile(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('.') && name.toLowerCase() !== 'readme.md'
}

function listStage(root: string, typeId: string, stage: LegacyStage): ScannedStage | null {
  const dirs = resolveStageDirs(root, typeId, stage)
  if (dirs.length === 0) {
    return null
  }
  const files: StageFile[] = []
  for (const dir of dirs) {
    for (const name of safeReaddir(dir)) {
      if (!isItemFile(name)) {
        continue
      }
      const path = join(dir, name)
      try {
        const stat = statSync(path)
        if (stat.isFile()) {
          files.push({
            path,
            mtimeMs: stat.mtimeMs,
            bucket: dirs.length > 1 || stage.paths.length > 1 ? basename(dir) : null
          })
        }
      } catch {
        // Moved between readdir and stat: an agent is working the queue right now.
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const readyCount = stage.readyKey
    ? files.filter((file) => isReady(readFrontmatter(file.path), stage.readyKey!)).length
    : null
  return { stage, dirs, files, readyCount }
}

/** Every legacy item type with at least one stage folder in this repo. */
export function scanProjectQueues(root: string, options: { activeOnly: boolean }): ScannedType[] {
  const scanned: ScannedType[] = []
  for (const type of LEGACY_ITEM_TYPES) {
    const stages = type.stages
      .filter((stage) => !options.activeOnly || (stage.kind ?? 'active') === 'active')
      .map((stage) => listStage(root, type.id, stage))
      .filter((stage): stage is ScannedStage => stage !== null)
    if (stages.length > 0) {
      scanned.push({ type, stages })
    }
  }
  return scanned
}

function readFrontmatter(path: string): Record<string, unknown> {
  return parseFrontmatter(readHead(path, ITEM_HEAD_BYTES))
}

function dotted(fm: Record<string, unknown>, key: string): unknown {
  let value: unknown = fm
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

function isReady(fm: Record<string, unknown>, key: string): boolean {
  const value = dotted(fm, key)
  return value === true || value === 'true' || value === 'yes'
}

export function queueTone(
  count: number,
  floor?: number | null,
  ceiling?: number | null
): XosQueueTone {
  if (ceiling != null && count >= ceiling) {
    return 'backed-up'
  }
  if (floor != null && count < floor) {
    return 'starved'
  }
  return count === 0 ? 'idle' : 'ok'
}

function queueRef(type: LegacyItemType, scanned: ScannedStage): XosQueueRef {
  const { stage, files, readyCount } = scanned
  const oldest = files.at(-1)
  return {
    typeId: type.id,
    stageId: stage.id,
    label: stage.label,
    count: files.length,
    readyCount,
    floor: stage.floor ?? null,
    ceiling: stage.ceiling ?? null,
    oldestAt: oldest ? new Date(oldest.mtimeMs).toISOString() : null,
    tone: queueTone(readyCount ?? files.length, stage.floor, stage.ceiling)
  }
}

/** The active queues a goal reads from and writes to. */
export function goalQueues(scan: ScannedType[], goal: string): XosGoalQueues {
  const queues: XosGoalQueues = { in: [], out: [] }
  for (const { type, stages } of scan) {
    for (const scanned of stages) {
      if (scanned.stage.readers?.includes(goal)) {
        queues.in.push(queueRef(type, scanned))
      }
      if (scanned.stage.writers?.includes(goal)) {
        queues.out.push(queueRef(type, scanned))
      }
    }
  }
  return queues
}

export function toItemStage(scanned: ScannedStage, knownGoals: Set<string>): XosItemStage {
  const { stage, dirs, files, readyCount } = scanned
  return {
    id: stage.id,
    label: stage.label,
    paths: dirs,
    count: files.length,
    readyCount,
    floor: stage.floor ?? null,
    ceiling: stage.ceiling ?? null,
    kind: stage.kind ?? 'active',
    readers: (stage.readers ?? []).filter((goal) => knownGoals.has(goal)),
    writers: (stage.writers ?? []).filter((goal) => knownGoals.has(goal))
  }
}

const CHIP_KEYS = [
  'status',
  'priority',
  'rank',
  'size',
  'risk',
  'severity',
  'review_status',
  'media_status',
  'category',
  'byline',
  'source'
]

function chipValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 40)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function itemChips(fm: Record<string, unknown>): XosItemChip[] {
  const chips: XosItemChip[] = []
  const builder =
    fm.builder && typeof fm.builder === 'object' ? (fm.builder as Record<string, unknown>) : {}
  for (const key of CHIP_KEYS) {
    const value = chipValue(fm[key]) ?? chipValue(builder[key])
    if (value) {
      chips.push({ key, value })
    }
  }
  return chips
}

function titleFrom(fm: Record<string, unknown>, head: string, path: string): string {
  if (typeof fm.title === 'string' && fm.title.trim()) {
    return fm.title.trim()
  }
  const body = head.startsWith('---') ? head.slice(head.indexOf('\n---', 3) + 4) : head
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  if (heading) {
    return heading
  }
  return basename(path, '.md')
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '')
    .replace(/[-_]+/g, ' ')
}

function createdFrom(fm: Record<string, unknown>, path: string): string | null {
  for (const key of ['created', 'created_at', 'date']) {
    const value = fm[key]
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10)
    }
    const text = chipValue(value)
    if (text) {
      return text
    }
  }
  return /^(\d{4}-\d{2}-\d{2})/.exec(basename(path))?.[1] ?? null
}

export function readItemSummary(file: StageFile, typeId: string, stage: LegacyStage): XosWorkItem {
  const head = readHead(file.path, ITEM_HEAD_BYTES) ?? ''
  const fm = parseFrontmatter(head)
  return {
    path: file.path,
    typeId,
    stageId: stage.id,
    bucket: file.bucket,
    title: titleFrom(fm, head, file.path),
    updatedAt: new Date(file.mtimeMs).toISOString(),
    created: createdFrom(fm, file.path),
    ready: stage.readyKey ? isReady(fm, stage.readyKey) : null,
    chips: itemChips(fm)
  }
}
