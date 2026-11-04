// XOS fork: Stage E pipeline health, pure so the Pipeline view and the main process share one tested
// implementation (M11). Folder scanning stays in main/xos/xos-pipeline.ts.
import type { XosGoal } from './xos-goals-types'
import type { XosQueueRef, XosQueueTone } from './xos-items-types'

/** Stage order and label of an item type, for sorting flows. */
export type XosPipelineType = { id: string; label: string; stages: readonly { id: string }[] }

export const DEFAULT_STUCK_ITEM_HOURS = 72

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

export type PipeSeed = Omit<
  XosPipelinePipe,
  'effectiveCount' | 'oldestAgeHours' | 'stuck' | 'status' | 'tone'
> & { readyKey?: string; readyValue?: string }

export const addUnique = (list: string[], value: string): void => {
  if (!list.includes(value)) {
    list.push(value)
  }
}

export function finalizeSummary(
  seeds: Iterable<PipeSeed>,
  nowMs: number,
  stuckAfterHours: number,
  types: readonly XosPipelineType[] = []
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
  const typeLabelMap = new Map(types.map((t) => [t.id, t.label]))
  const flows: XosPipelineFlow[] = [...byType.entries()].map(([typeId, typePipes]) => {
    const stageOrder = types.find((t) => t.id === typeId)?.stages.map((s) => s.id) ?? []
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

export function upsertSeed(
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
  options?: { nowMs?: number; stuckAfterHours?: number; types?: readonly XosPipelineType[] }
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
    options?.stuckAfterHours ?? DEFAULT_STUCK_ITEM_HOURS,
    options?.types
  )
}
