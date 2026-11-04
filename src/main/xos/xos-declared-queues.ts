// XOS fork: Stage B declared queue parser (`queues:` frontmatter in GOAL.md + legacy queue map fallback, §3g.1).
import { basename, join } from 'node:path'
import { isDirectory } from './xos-goal-files'
import {
  projectHomeDir,
  projectItemsDir,
  resolveGoalDir,
  resolveStageDirs
} from './xos-project-home'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'

export type XosDeclaredQueueIn = {
  label: string
  paths: string[]
  typeId?: string
  stageId?: string
  readyKey?: string
  readyValue?: string
  matchKey?: string
  matchValue?: string
  /** `ready_when: count >= N`: below this the queue doesn't count as having work. */
  minCount?: number
}

export type XosDeclaredQueueOut = {
  label: string
  paths: string[]
  typeId?: string
  stageId?: string
  /** Only these items count toward the floor and ceiling (`match: builder.ready == true`). */
  matchKey?: string
  matchValue?: string
  floor?: number
  ceiling?: number
  hardCap?: number
}

export type XosDeclaredQueues = {
  in: XosDeclaredQueueIn[]
  out: XosDeclaredQueueOut[]
  rejects: string[]
  maxRunsPerDay: number | null
}

/** `a.b == true` (the plan), `a.b: true`, or a bare `a.b`. */
function parseKeyExpr(expr: unknown): { key?: string; value?: string } {
  if (typeof expr !== 'string' || !expr.trim()) {
    return {}
  }
  const match = /^([^:=\s]+)\s*(?:==|:)\s*(.+)$/.exec(expr.trim())
  return match
    ? { key: match[1], value: match[2].trim().replace(/^["']|["']$/g, '') }
    : { key: expr.trim(), value: 'true' }
}

/** `count >= 3`: a queue-level threshold, not a test on each item. */
function parseMinCount(expr: unknown): number | undefined {
  const match = typeof expr === 'string' ? /^count\s*>=\s*(\d+)$/.exec(expr.trim()) : null
  return match ? Number(match[1]) : undefined
}

/** `inbox/{a,b}/` is the plan's shorthand for two buckets. */
function expandRejects(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value]
  return entries.flatMap((entry) => {
    const path = typeof entry === 'string' ? entry : isRecord(entry) ? entry.path : null
    if (typeof path !== 'string' || !path) {
      return []
    }
    const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(path)
    return brace
      ? brace[2].split(',').map((name) => `${brace[1]}${name.trim()}${brace[3]}`)
      : [path]
  })
}

function resolveCustomQueueDirs(
  repoRoot: string,
  goal: string,
  entry: { path?: string; paths?: string[]; typeId?: string; stageId?: string }
): string[] {
  if (entry.typeId && entry.stageId) {
    const legacyType = LEGACY_ITEM_TYPES.find((t) => t.id === entry.typeId)
    const legacyStage = legacyType?.stages.find((s) => s.id === entry.stageId)
    if (legacyType && legacyStage) {
      return resolveStageDirs(repoRoot, legacyType.id, legacyStage)
    }
    const central = join(projectItemsDir(repoRoot), entry.typeId, entry.stageId)
    if (isDirectory(central)) {
      return [central]
    }
  }
  const rawPaths = entry.paths ?? (entry.path ? [entry.path] : [])
  return rawPaths
    .map((rel) => {
      // Goal-private folders first (§3g.1), then the project home, then the repo during migration.
      const bases = [resolveGoalDir(repoRoot, goal), projectHomeDir(repoRoot), repoRoot]
      return bases.map((base) => join(base, rel.replace(/\/+$/, ''))).find(isDirectory)
    })
    .filter((dir): dir is string => dir !== undefined)
}

function asObjList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolveGoalDeclaredQueues(
  repoRoot: string,
  goal: string,
  fm: Record<string, unknown>
): XosDeclaredQueues {
  const rawQueues = isRecord(fm.queues) ? fm.queues : null

  if (rawQueues) {
    const maxRuns = Number(rawQueues.max_runs_per_day ?? fm.max_runs_per_day ?? 0)
    const inQueues: XosDeclaredQueueIn[] = asObjList(rawQueues.in).map((item) => {
      const pathStr = typeof item.path === 'string' ? item.path : ''
      const typeId = typeof item.type === 'string' ? item.type : undefined
      const stageId = typeof item.stage === 'string' ? item.stage : undefined
      const readyExpr = item.ready_when ?? item.readyKey
      const minCount = parseMinCount(readyExpr)
      const ready = minCount === undefined ? parseKeyExpr(readyExpr) : {}
      const match = parseKeyExpr(item.match)
      return {
        label:
          (typeof item.label === 'string' && item.label) || stageId || basename(pathStr) || 'input',
        paths: resolveCustomQueueDirs(repoRoot, goal, { path: pathStr, typeId, stageId }),
        typeId,
        stageId,
        ...(minCount !== undefined ? { minCount } : {}),
        readyKey: ready.key,
        readyValue: ready.value,
        matchKey: match.key,
        matchValue: match.value
      }
    })
    const outQueues: XosDeclaredQueueOut[] = asObjList(rawQueues.out).map((item) => {
      const pathStr = typeof item.path === 'string' ? item.path : ''
      const typeId = typeof item.type === 'string' ? item.type : undefined
      const stageId = typeof item.stage === 'string' ? item.stage : undefined
      const ceiling = Number(item.ceiling)
      const hardCap = Number(item.hard_cap ?? item.hardCap)
      const floor = Number(item.floor)
      const match = parseKeyExpr(item.match)
      return {
        label:
          (typeof item.label === 'string' && item.label) ||
          stageId ||
          basename(pathStr) ||
          'output',
        paths: resolveCustomQueueDirs(repoRoot, goal, { path: pathStr, typeId, stageId }),
        typeId,
        stageId,
        matchKey: match.key,
        matchValue: match.value,
        ...(Number.isFinite(floor) && floor > 0 ? { floor } : {}),
        ...(Number.isFinite(ceiling) && ceiling > 0 ? { ceiling } : {}),
        ...(Number.isFinite(hardCap) && hardCap > 0 ? { hardCap } : {})
      }
    })
    const rejects = expandRejects(rawQueues.rejects)
    return {
      in: inQueues,
      out: outQueues,
      rejects,
      maxRunsPerDay: Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : null
    }
  }

  const inQueues: XosDeclaredQueueIn[] = []
  const outQueues: XosDeclaredQueueOut[] = []
  for (const type of LEGACY_ITEM_TYPES) {
    for (const stage of type.stages) {
      const dirs = resolveStageDirs(repoRoot, type.id, stage)
      if (dirs.length === 0) {
        continue
      }
      if (stage.readers?.includes(goal)) {
        inQueues.push({
          label: `${type.label} / ${stage.label}`,
          paths: dirs,
          typeId: type.id,
          stageId: stage.id,
          readyKey: stage.readyKey,
          readyValue: stage.readyKey ? 'true' : undefined
        })
      }
      if (stage.writers?.includes(goal) && (stage.kind ?? 'active') === 'active') {
        outQueues.push({
          label: `${type.label} / ${stage.label}`,
          paths: dirs,
          typeId: type.id,
          stageId: stage.id,
          floor: stage.floor,
          ceiling: stage.ceiling
        })
      }
    }
  }
  const topMaxRuns = Number(fm.max_runs_per_day ?? 0)
  return {
    in: inQueues,
    out: outQueues,
    rejects: [],
    maxRunsPerDay: Number.isFinite(topMaxRuns) && topMaxRuns > 0 ? topMaxRuns : null
  }
}
