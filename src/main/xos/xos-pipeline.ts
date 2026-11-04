// XOS fork: Stage E pipeline flow computation between goals based on declared queues (PL1–PL4, §3g.7).
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { XosGoal } from '../../shared/xos-goals-types'
import type { XosQueueRef, XosQueueTone } from '../../shared/xos-items-types'
import { resolveGoalDeclaredQueues } from './xos-declared-queues'
import { isDirectory, parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { resolveProjectGoalsDir } from './xos-project-home'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'

export const DEFAULT_STUCK_ITEM_HOURS = 72
const ITEM_HEAD_BYTES = 8 * 1024

export type XosPipeStatus = 'starved' | 'backed-up' | 'healthy'

export type XosPipelinePipe = {
  id: string
  typeId: string
  stageId: string
  label: string
  paths: string[]
  fromGoals: string[]
  toGoals: string[]
  count: number
  readyCount: number | null
  effectiveCount: number
  floor: number | null
  ceiling: number | null
  hardCap: number | null
  oldestAt: string | null
  oldestAgeHours: number | null
  stuck: boolean
  status: XosPipeStatus
  tone: XosQueueTone
}

export type XosPipelineFlow = {
  typeId: string
  label: string
  pipes: XosPipelinePipe[]
  goalOrder: string[]
}

export type XosPipelineSummary = {
  pipes: XosPipelinePipe[]
  flows: XosPipelineFlow[]
  starvedCount: number
  backedUpCount: number
  healthyCount: number
  stuckCount: number
  overallHealth: 'healthy' | 'watch' | 'action_needed' | 'blocked'
}

export function computePipeHealth(
  count: number,
  floor?: number | null,
  ceiling?: number | null,
  hardCap?: number | null
): { status: XosPipeStatus; tone: XosQueueTone } {
  if ((hardCap != null && count >= hardCap) || (ceiling != null && count >= ceiling)) {
    return { status: 'backed-up', tone: 'backed-up' }
  }
  if (floor != null && count < floor) {
    return { status: 'starved', tone: 'starved' }
  }
  return { status: 'healthy', tone: count === 0 ? 'idle' : 'ok' }
}

export function computeStuckItemAge(
  oldestAt: string | number | null | undefined,
  nowMs: number = Date.now(),
  stuckAfterHours: number = DEFAULT_STUCK_ITEM_HOURS
): { oldestAt: string | null; oldestAgeHours: number | null; stuck: boolean } {
  const oldestMs =
    typeof oldestAt === 'number'
      ? oldestAt
      : typeof oldestAt === 'string' && oldestAt
        ? Date.parse(oldestAt)
        : Number.NaN
  if (!Number.isFinite(oldestMs)) {
    return { oldestAt: null, oldestAgeHours: null, stuck: false }
  }
  const ageHours = Math.max(0, Math.round(((nowMs - oldestMs) / 3_600_000) * 10) / 10)
  return {
    oldestAt: new Date(oldestMs).toISOString(),
    oldestAgeHours: ageHours,
    stuck: ageHours >= stuckAfterHours
  }
}

type PipeSeed = Omit<
  XosPipelinePipe,
  'effectiveCount' | 'oldestAgeHours' | 'stuck' | 'status' | 'tone'
> & { readyKey?: string; readyValue?: string }

const addUnique = (list: string[], value: string): void => {
  if (!list.includes(value)) {
    list.push(value)
  }
}

function finalizeSummary(
  seeds: Iterable<PipeSeed>,
  nowMs: number,
  stuckAfterHours: number
): XosPipelineSummary {
  const pipes: XosPipelinePipe[] = [...seeds].map(({ readyKey: _rk, readyValue: _rv, ...seed }) => {
    const effectiveCount = seed.readyCount ?? seed.count
    const { status, tone } = computePipeHealth(
      effectiveCount,
      seed.floor,
      seed.ceiling,
      seed.hardCap
    )
    const age =
      seed.count > 0
        ? computeStuckItemAge(seed.oldestAt, nowMs, stuckAfterHours)
        : { oldestAt: null, oldestAgeHours: null, stuck: false }
    return { ...seed, effectiveCount, ...age, status, tone }
  })
  const byType = new Map<string, XosPipelinePipe[]>()
  for (const pipe of pipes) {
    byType.set(pipe.typeId, [...(byType.get(pipe.typeId) ?? []), pipe])
  }
  const typeLabelMap = new Map(LEGACY_ITEM_TYPES.map((t) => [t.id, t.label]))
  const flows: XosPipelineFlow[] = [...byType.entries()].map(([typeId, typePipes]) => {
    const stageOrder = LEGACY_ITEM_TYPES.find((t) => t.id === typeId)?.stages.map((s) => s.id) ?? []
    const sorted = [...typePipes].sort((a, b) => {
      const ia = stageOrder.indexOf(a.stageId)
      const ib = stageOrder.indexOf(b.stageId)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.label.localeCompare(b.label)
    })
    const goalOrder = [...new Set(sorted.flatMap((p) => [...p.fromGoals, ...p.toGoals]))]
    return { typeId, label: typeLabelMap.get(typeId) ?? typeId, pipes: sorted, goalOrder }
  })
  const starvedCount = pipes.filter((p) => p.status === 'starved').length
  const backedUpCount = pipes.filter((p) => p.status === 'backed-up').length
  const healthyCount = pipes.filter((p) => p.status === 'healthy').length
  const stuckCount = pipes.filter((p) => p.stuck).length
  const overallHealth =
    backedUpCount > 0 && stuckCount > 0
      ? 'blocked'
      : backedUpCount > 0 || stuckCount > 0
        ? 'action_needed'
        : starvedCount > 0
          ? 'watch'
          : 'healthy'
  return { pipes, flows, starvedCount, backedUpCount, healthyCount, stuckCount, overallHealth }
}

function upsertSeed(
  seeds: Map<string, PipeSeed>,
  id: string,
  typeId: string,
  stageId: string,
  label: string
): PipeSeed {
  let seed = seeds.get(id)
  if (!seed) {
    seed = {
      id,
      typeId,
      stageId,
      label,
      paths: [],
      fromGoals: [],
      toGoals: [],
      count: 0,
      readyCount: null,
      floor: null,
      ceiling: null,
      hardCap: null,
      oldestAt: null
    }
    seeds.set(id, seed)
  }
  return seed
}

export function computePipelineFromGoals(
  goals: readonly Pick<XosGoal, 'goal' | 'queues'>[],
  options?: { nowMs?: number; stuckAfterHours?: number }
): XosPipelineSummary {
  const seeds = new Map<string, PipeSeed>()
  const addRef = (ref: XosQueueRef, goal: string, dir: 'in' | 'out'): void => {
    const seed = upsertSeed(
      seeds,
      `${ref.typeId}:${ref.stageId}`,
      ref.typeId,
      ref.stageId,
      ref.label
    )
    seed.count = Math.max(seed.count, ref.count)
    seed.readyCount = ref.readyCount ?? seed.readyCount
    seed.floor = ref.floor ?? seed.floor
    seed.ceiling = ref.ceiling ?? seed.ceiling
    seed.oldestAt = seed.oldestAt ?? ref.oldestAt
    addUnique(dir === 'out' ? seed.fromGoals : seed.toGoals, goal)
  }
  for (const goal of goals) {
    goal.queues.out.forEach((ref) => addRef(ref, goal.goal, 'out'))
    goal.queues.in.forEach((ref) => addRef(ref, goal.goal, 'in'))
  }
  return finalizeSummary(
    seeds.values(),
    options?.nowMs ?? Date.now(),
    options?.stuckAfterHours ?? DEFAULT_STUCK_ITEM_HOURS
  )
}

function scanQueuePaths(paths: string[], readyKey?: string, readyValue?: string) {
  let count = 0
  let ready = 0
  let oldestMs: number | null = null
  for (const dir of paths) {
    for (const name of safeReaddir(dir)) {
      const lower = name.toLowerCase()
      if (
        !lower.endsWith('.md') ||
        lower.startsWith('.') ||
        lower === 'readme.md' ||
        lower === 'template.md'
      ) {
        continue
      }
      const full = join(dir, name)
      try {
        const stat = statSync(full)
        if (!stat.isFile()) {
          continue
        }
        count += 1
        if (oldestMs === null || stat.mtimeMs < oldestMs) {
          oldestMs = stat.mtimeMs
        }
        if (readyKey) {
          let cur: unknown = parseFrontmatter(readHead(full, ITEM_HEAD_BYTES))
          for (const part of readyKey.split('.')) {
            cur =
              typeof cur === 'object' && cur !== null
                ? (cur as Record<string, unknown>)[part]
                : undefined
          }
          const ok =
            !readyValue || readyValue.toLowerCase() === 'true'
              ? cur === true || cur === 'true' || cur === 'yes'
              : String(cur ?? '').toLowerCase() === readyValue.toLowerCase()
          if (ok) {
            ready += 1
          }
        }
      } catch {
        // Concurrent move.
      }
    }
  }
  return {
    count,
    readyCount: readyKey ? ready : null,
    oldestAt: oldestMs !== null ? new Date(oldestMs).toISOString() : null
  }
}

export function computeRepoPipeline(
  repoRoot: string,
  options?: { nowMs?: number; stuckAfterHours?: number }
): XosPipelineSummary {
  const goalsDir = resolveProjectGoalsDir(repoRoot)
  const goalNames = safeReaddir(goalsDir)
    .filter((n) => !n.startsWith('_') && !n.startsWith('.') && isDirectory(join(goalsDir, n)))
    .sort()
  const seeds = new Map<string, PipeSeed>()
  for (const goal of goalNames) {
    const fm = parseFrontmatter(readHead(join(goalsDir, goal, 'GOAL.md')))
    const declared = resolveGoalDeclaredQueues(repoRoot, goal, fm)
    const register = (
      q: (typeof declared.in)[number] & (typeof declared.out)[number],
      dir: 'in' | 'out'
    ): void => {
      const typeId = q.typeId ?? 'custom'
      const stageId = q.stageId ?? (q.paths[0] || q.label)
      const id =
        q.typeId && q.stageId ? `${typeId}:${stageId}` : (q.paths[0] ?? `${typeId}:${stageId}`)
      const seed = upsertSeed(seeds, id, typeId, stageId, q.label)
      q.paths.forEach((p) => addUnique(seed.paths, p))
      addUnique(dir === 'out' ? seed.fromGoals : seed.toGoals, goal)
      seed.floor = q.floor ?? seed.floor
      seed.ceiling = q.ceiling ?? seed.ceiling
      seed.hardCap = q.hardCap ?? seed.hardCap
      seed.readyKey = q.readyKey ?? seed.readyKey
      seed.readyValue = q.readyValue ?? seed.readyValue
    }
    declared.out.forEach((q) => register(q, 'out'))
    declared.in.forEach((q) => register(q, 'in'))
  }
  for (const seed of seeds.values()) {
    Object.assign(seed, scanQueuePaths(seed.paths, seed.readyKey, seed.readyValue))
  }
  return finalizeSummary(
    seeds.values(),
    options?.nowMs ?? Date.now(),
    options?.stuckAfterHours ?? DEFAULT_STUCK_ITEM_HOURS
  )
}
