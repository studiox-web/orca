// XOS fork: Stage E item-history analytics, funnel conversion, rejection stats, velocity, and
// cost per shipped feature (OV3, OV4, GD6, OV5, §3g.6).
import { basename, join } from 'node:path'
import type { XosProjectAnalytics } from '../../shared/xos-analytics-types'
import type { XosGoalUsage } from '../../shared/xos-goals-types'
import { parseFrontmatter, readHead } from './xos-goal-files'
import { readTokenUsage } from './xos-goal-receipts'
import { readTransitionEvents, type XosItemTransitionEvent } from './xos-item-claims'
import { listAgentWindows } from './xos-quota'
import { scanProjectQueues } from './xos-work-items'

export const DEFAULT_STUCK_THRESHOLD_HOURS = 72

export type XosActiveQueueItem = {
  item: string
  path: string
  typeId: string
  stageId: string
  bucket?: string | null
  ready?: boolean | null
  mtimeMs: number
  claimedBy?: string | null
}

export type XosFunnelStage = 'inbox' | 'accepted' | 'ready' | 'completed'
export type XosRunCostEntry = { tokens: number; costUsd: number; model?: string | null }
export type XosShippedFeatureCost = {
  item: string
  completedAt: string
  runs: number
  tokens: number
  costUsd: number
  models: string[]
}

const r1 = (value: number): number => Math.round(value * 10) / 10
const r2 = (value: number): number => Math.round(value * 100) / 100

export function computeTimeInQueue(
  transitions: readonly XosItemTransitionEvent[],
  activeItems: readonly XosActiveQueueItem[] = [],
  nowMs: number = Date.now()
) {
  const sorted = [...transitions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const enteredAt = new Map<string, { stage: string; ms: number }>()
  const samples = new Map<string, number[]>()
  const push = (stage: string, hours: number): void => {
    if (stage && Number.isFinite(hours) && hours >= 0) {
      samples.set(stage, [...(samples.get(stage) ?? []), hours])
    }
  }
  for (const ev of sorted) {
    const atMs = Date.parse(ev.at)
    if (!Number.isFinite(atMs)) {
      continue
    }
    const prev = enteredAt.get(ev.item)
    if (prev) {
      push(ev.fromStage || prev.stage, (atMs - prev.ms) / 3_600_000)
    }
    enteredAt.set(ev.item, { stage: ev.toStage, ms: atMs })
  }
  for (const active of activeItems) {
    const prev = enteredAt.get(active.item)
    const startMs = prev && prev.stage === active.stageId ? prev.ms : active.mtimeMs
    if (Number.isFinite(startMs) && nowMs >= startMs) {
      push(active.stageId, (nowMs - startMs) / 3_600_000)
    }
  }
  return [...samples.entries()].map(([stageId, list]) => {
    const ord = [...list].sort((a, b) => a - b)
    const mid = Math.floor(ord.length / 2)
    const medianHours = r1(ord.length % 2 === 1 ? ord[mid] : (ord[mid - 1] + ord[mid]) / 2)
    const avgHours = r1(ord.reduce((a, v) => a + v, 0) / ord.length)
    return {
      stageId,
      avgHours,
      medianHours,
      maxHours: r1(ord.at(-1) ?? 0),
      sampleCount: ord.length
    }
  })
}

export function computeStuckItemAlerts(
  activeItems: readonly XosActiveQueueItem[],
  nowMs: number = Date.now(),
  stuckAfterHours: number = DEFAULT_STUCK_THRESHOLD_HOURS
) {
  return activeItems
    .map(({ item, path, typeId, stageId, mtimeMs, claimedBy }) => {
      const ageHours = r1(Math.max(0, (nowMs - mtimeMs) / 3_600_000))
      const oldestAt = new Date(mtimeMs).toISOString()
      return { item, path, typeId, stageId, ageHours, oldestAt, claimedBy: claimedBy ?? null }
    })
    .filter((entry) => entry.ageHours >= stuckAfterHours)
    .sort((a, b) => b.ageHours - a.ageHours)
}

export function computeFunnelStats(args: {
  inboxCount: number
  acceptedCount: number
  readyCount: number
  completedCount: number
  rejectedCount?: number
  inProgressCount?: number
}) {
  const completed = Math.max(0, args.completedCount)
  const ready = Math.max(0, args.readyCount)
  const readyCum = completed + Math.max(0, args.inProgressCount ?? 0) + ready
  const acceptedCum = readyCum + Math.max(0, args.acceptedCount)
  const inboxCum = Math.max(
    acceptedCum + Math.max(0, args.rejectedCount ?? 0),
    acceptedCum + Math.max(0, args.inboxCount)
  )
  const stages: [XosFunnelStage, string, number, number][] = [
    ['inbox', 'Inbox', args.inboxCount, inboxCum],
    ['accepted', 'Accepted', args.acceptedCount, acceptedCum],
    ['ready', 'Ready', args.readyCount, readyCum],
    ['completed', 'Completed', args.completedCount, completed]
  ]
  const top = stages[0][3]
  return stages.map(([stage, label, currentCount, cumulativeCount], idx) => {
    const prev = idx === 0 ? cumulativeCount : stages[idx - 1][3]
    const conversionFromPrevPct =
      idx === 0 ? 100 : prev > 0 ? r1((cumulativeCount / prev) * 100) : 0
    const conversionFromTopPct = top > 0 ? r1((cumulativeCount / top) * 100) : 0
    const base = { stage, label, currentCount, cumulativeCount }
    return { ...base, conversionFromPrevPct, conversionFromTopPct }
  })
}

export function computeRejectionBucketStats(
  buckets: readonly (string | { bucket: string; count?: number })[]
) {
  const counts = new Map<string, number>()
  for (const entry of buckets) {
    const name = (typeof entry === 'string' ? entry : entry.bucket).trim()
    const add = typeof entry === 'string' ? 1 : (entry.count ?? 1)
    if (name && add > 0) {
      counts.set(name, (counts.get(name) ?? 0) + add)
    }
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  return [...counts.entries()]
    .map(([bucket, count]) => ({
      bucket,
      count,
      sharePct: total > 0 ? r1((count / total) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket))
}

export function computeWeeklyVelocity(
  transitions: readonly XosItemTransitionEvent[],
  options?: { nowMs?: number; weeks?: number }
) {
  const nowMs = options?.nowMs ?? Date.now()
  const weeks = Math.max(1, options?.weeks ?? 4)
  const weekMs = 7 * 24 * 3_600_000
  return Array.from({ length: weeks }, (_, idx) => {
    const i = weeks - 1 - idx
    const [startMs, endMs] = [nowMs - (i + 1) * weekMs, nowMs - i * weekMs]
    let [featuresCompleted, bugsFixed, contentPublished] = [0, 0, 0]
    for (const ev of transitions) {
      const atMs = Date.parse(ev.at)
      if (!Number.isFinite(atMs) || atMs < startMs || atMs >= endMs) {
        continue
      }
      if (ev.toStage === 'completed') {
        featuresCompleted += 1
      } else if (ev.toStage === 'fixed' || ev.toStage === 'resolved') {
        bugsFixed += 1
      } else if (ev.toStage === 'published') {
        contentPublished += 1
      }
    }
    const weekStart = new Date(startMs).toISOString().slice(0, 10)
    const completedCount = featuresCompleted + bugsFixed + contentPublished
    return { weekStart, completedCount, featuresCompleted, bugsFixed, contentPublished }
  })
}

export function computeCostPerShippedFeature(args: {
  transitions: readonly XosItemTransitionEvent[]
  usageByGoal?: ReadonlyMap<string, readonly XosGoalUsage[]>
  runCostById?: Readonly<Record<string, XosRunCostEntry>>
}) {
  const byItem = new Map<string, XosItemTransitionEvent[]>()
  for (const ev of args.transitions) {
    byItem.set(ev.item, [...(byItem.get(ev.item) ?? []), ev])
  }
  const shippedFeatures: XosShippedFeatureCost[] = []
  for (const [item, events] of byItem) {
    const ordered = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const completedEv = ordered.findLast((ev) => ev.toStage === 'completed')
    if (!completedEv) {
      continue
    }
    let [tokens, cost] = [0, 0]
    const [models, usedTs] = [new Set<string>(), new Set<string>()]
    for (const ev of ordered) {
      const byRun = ev.runId ? args.runCostById?.[ev.runId] : undefined
      if (byRun) {
        tokens += byRun.tokens
        cost += byRun.costUsd
        if (byRun.model) {
          models.add(byRun.model)
        }
        continue
      }
      const evMs = Date.parse(ev.at)
      const match = (args.usageByGoal?.get(ev.goal) ?? []).find(
        (u) =>
          u.ts &&
          !usedTs.has(`${ev.goal}:${u.ts}`) &&
          Math.abs(Date.parse(u.ts) - evMs) <= 7_200_000
      )
      if (match) {
        usedTs.add(`${ev.goal}:${match.ts}`)
        tokens += match.actual_tokens
        cost += match.estimated_cost_usd
        if (match.model && match.model !== 'unknown') {
          models.add(match.model)
        }
      }
    }
    const base = { item, completedAt: completedEv.at, runs: ordered.length }
    shippedFeatures.push({ ...base, tokens, costUsd: r2(cost), models: [...models] })
  }
  const totalShippedCostUsd = r2(shippedFeatures.reduce((s, f) => s + f.costUsd, 0))
  const totalTokens = shippedFeatures.reduce((s, f) => s + f.tokens, 0)
  const n = shippedFeatures.length
  const avgCostPerFeatureUsd = n > 0 ? r2(totalShippedCostUsd / n) : 0
  const avgTokensPerFeature = n > 0 ? Math.round(totalTokens / n) : 0
  return { shippedFeatures, avgCostPerFeatureUsd, avgTokensPerFeature, totalShippedCostUsd }
}

export function computeTokenBurnForecast(args: {
  usedPercent: number
  windowMinutes: number
  resetsAtMs: number
  targetUtilizationPct?: number
  nowMs?: number
}) {
  const target = args.targetUtilizationPct ?? 95
  const rem = Math.max(0, (args.resetsAtMs - (args.nowMs ?? Date.now())) / 3_600_000)
  const rate = args.usedPercent / Math.max(0.25, Math.max(1, args.windowMinutes / 60) - rem)
  const proj = Math.min(200, args.usedPercent + rate * rem)
  const hoursToTarget =
    args.usedPercent >= target ? 0 : rate > 0 ? r1((target - args.usedPercent) / rate) : null
  const status: 'on-track' | 'under-burning' | 'over-burning' =
    proj > 102 ? 'over-burning' : proj < target - 10 ? 'under-burning' : 'on-track'
  const base = { usedPercent: r1(args.usedPercent), targetUtilizationPct: target }
  const rates = { burnRatePctPerHour: r2(rate), projectedPctAtReset: r1(proj) }
  return { ...base, ...rates, hoursToTarget, status }
}

export function computeRepoAnalytics(
  repoRoot: string,
  nowMs: number = Date.now()
): XosProjectAnalytics {
  const transitions = readTransitionEvents(repoRoot, 500)
  const usageByGoal = readTokenUsage(join(repoRoot, 'automations'))
  const activeItems: XosActiveQueueItem[] = []
  const rejectionBuckets: { bucket: string; count: number }[] = []
  const fc: Record<string, number> = {}
  for (const { type, stages } of scanProjectQueues(repoRoot, { activeOnly: false })) {
    for (const st of stages) {
      if ((st.stage.kind ?? 'active') === 'active') {
        for (const f of st.files) {
          const fm = parseFrontmatter(readHead(f.path, 4096))
          const claimedBy = typeof fm.claimed_by === 'string' ? fm.claimed_by : null
          const base = { item: basename(f.path, '.md'), path: f.path, typeId: type.id }
          const stage = { stageId: st.stage.id, bucket: f.bucket, mtimeMs: f.mtimeMs }
          activeItems.push({ ...base, ...stage, claimedBy })
        }
      }
      if (type.id === 'feature') {
        fc[st.stage.id] = st.readyCount ?? st.files.length
        if (st.stage.id === 'rejected') {
          st.files.forEach((f) => rejectionBuckets.push({ bucket: f.bucket ?? 'other', count: 1 }))
        }
      }
    }
  }
  const funnel = computeFunnelStats({
    inboxCount: fc.pitch ?? 0,
    acceptedCount: fc.accepted ?? 0,
    readyCount: fc.planned ?? 0,
    inProgressCount: fc['in-progress'] ?? 0,
    completedCount: fc.completed ?? 0,
    rejectedCount: fc.rejected ?? 0
  })
  return {
    timeInQueue: computeTimeInQueue(transitions, activeItems, nowMs),
    stuckAlerts: computeStuckItemAlerts(activeItems, nowMs),
    funnel,
    rejections: computeRejectionBucketStats(rejectionBuckets),
    velocity: computeWeeklyVelocity(transitions, { nowMs }),
    featureCosts: computeCostPerShippedFeature({ transitions, usageByGoal }),
    burn: listAgentWindows().map(({ agent, window }) => ({
      agent,
      ...computeTokenBurnForecast({
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        resetsAtMs: window.resetsAt ?? nowMs + window.windowMinutes * 60_000,
        nowMs
      })
    }))
  }
}
