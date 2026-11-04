// XOS fork: Stage E Analytics & Funnel Stats section (OV3, OV4, GD6, OV5, §3g.6).
// Renders KPI cards, Token-Maxxing burn forecast, Feature Funnel conversion, Time-in-Queue &
// Stuck-Item alerts, Rejection Bucket stats, Weekly Velocity, Cost per Shipped Feature, and
// Pending Decisions / Special Projects.
import React, { useMemo } from 'react'
import { AlertTriangle, ExternalLink, FileText, Flame, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { useXosItems } from './use-xos-items'
import { formatCompactNumber, formatCurrency, relativeTime } from './xos-format'
import { prettyGoal, selectedItems, selectedTypes, TONE_CLASS } from './xos-items-model'
import { openXosItemsInTasks } from './xos-items-source'

const STUCK_HOURS = 72
const r1 = (v: number): number => Math.round(v * 10) / 10
const r2 = (v: number): number => Math.round(v * 100) / 100

async function openFile(filePath: string): Promise<void> {
  const res = await window.api.xosGoals?.openFile({ path: filePath })
  if (res && !res.ok) {
    toast.error(res.error)
  }
}

function goalSuccessRate30d(goal: XosGoal): number {
  const runs = goal.viewer.recentRuns
  if (runs.length === 0) {
    return 100
  }
  const ok = runs.filter((r) => {
    const s = r.status.toLowerCase()
    return (
      s.includes('success') || s.includes('pass') || s.includes('finished') || r.exit_code === 0
    )
  }).length
  return r1((ok / runs.length) * 100)
}

function deriveProjectAnalytics(
  project: XosProject,
  itemsSnapshot: ReturnType<typeof useXosItems>['snapshot'],
  nowMs: number = Date.now()
) {
  const types = itemsSnapshot ? selectedTypes(itemsSnapshot, project.key) : []
  const items = itemsSnapshot
    ? types.flatMap((t) => selectedItems(itemsSnapshot, project.key, t.id))
    : []
  const stageCount = (typeId: string, stageId: string): number => {
    const t = types.find((ty) => ty.id === typeId)
    const s = t?.stages.find((st) => st.id === stageId)
    return s ? (s.readyCount ?? s.count) : 0
  }

  const [inbox, accepted, ready] = [
    stageCount('feature', 'pitch'),
    stageCount('feature', 'accepted'),
    stageCount('feature', 'planned')
  ]
  const [inProgress, completed, rejected] = [
    stageCount('feature', 'in-progress'),
    stageCount('feature', 'completed'),
    stageCount('feature', 'rejected')
  ]
  const readyCum = completed + inProgress + ready
  const acceptedCum = readyCum + accepted
  const inboxCum = Math.max(acceptedCum + rejected, acceptedCum + inbox)
  const top = Math.max(1, inboxCum)
  const funnelRaw: [string, string, number, number][] = [
    ['inbox', 'Inbox (Pitches)', inbox, inboxCum],
    ['accepted', 'Accepted', accepted, acceptedCum],
    ['ready', 'Ready (Planned)', ready, readyCum],
    ['completed', 'Completed', completed, completed]
  ]
  const funnel = funnelRaw.map(([stage, label, currentCount, cumulativeCount], idx) => {
    const prev = idx === 0 ? cumulativeCount : funnelRaw[idx - 1][3]
    const stepPct = idx === 0 ? 100 : prev > 0 ? r1((cumulativeCount / prev) * 100) : 0
    const topPct = inboxCum > 0 ? r1((cumulativeCount / top) * 100) : 0
    return { stage, label, currentCount, cumulativeCount, stepPct, topPct }
  })

  const activeStageIds = new Set(
    types.flatMap((t) => t.stages.filter((s) => s.kind === 'active').map((s) => `${t.id}:${s.id}`))
  )
  const byStageHours = new Map<string, number[]>()
  const stuckAlerts: ((typeof items)[number] & { ageHours: number })[] = []
  const rejCounts = new Map<string, number>()

  for (const item of items) {
    const updatedMs = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN
    const ageHours = Number.isFinite(updatedMs)
      ? r1(Math.max(0, (nowMs - updatedMs) / 3_600_000))
      : 0
    if (activeStageIds.has(`${item.typeId}:${item.stageId}`)) {
      byStageHours.set(item.stageId, [...(byStageHours.get(item.stageId) ?? []), ageHours])
      if (ageHours >= STUCK_HOURS) {
        stuckAlerts.push({ ...item, ageHours })
      }
    }
    if (item.stageId === 'rejected') {
      const bucket = item.bucket || 'unspecified'
      rejCounts.set(bucket, (rejCounts.get(bucket) ?? 0) + 1)
    }
  }
  stuckAlerts.sort((a, b) => b.ageHours - a.ageHours)

  const dwellStats = [...byStageHours.entries()]
    .map(([stageId, vals]) => {
      const ord = [...vals].sort((a, b) => a - b)
      const mid = Math.floor(ord.length / 2)
      const medianHours = r1(ord.length % 2 === 1 ? ord[mid] : (ord[mid - 1] + ord[mid]) / 2)
      const avgHours = r1(ord.reduce((s, v) => s + v, 0) / ord.length)
      return { stageId, avgHours, medianHours, maxHours: r1(ord.at(-1) ?? 0), count: ord.length }
    })
    .sort((a, b) => b.avgHours - a.avgHours)

  const rejTotal = Math.max(
    1,
    [...rejCounts.values()].reduce((s, n) => s + n, 0)
  )
  const rejections = [...rejCounts.entries()]
    .map(([bucket, count]) => ({ bucket, count, sharePct: r1((count / rejTotal) * 100) }))
    .sort((a, b) => b.count - a.count)

  const weekMs = 7 * 24 * 3_600_000
  const terminalStages = new Set(['completed', 'fixed', 'resolved', 'published'])
  const velocity = [3, 2, 1, 0].map((w) => {
    const [startMs, endMs] = [nowMs - (w + 1) * weekMs, nowMs - w * weekMs]
    let [features, bugs, content] = [0, 0, 0]
    for (const item of items) {
      if (!terminalStages.has(item.stageId)) {
        continue
      }
      const ms = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN
      if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) {
        continue
      }
      if (item.typeId === 'feature') {
        features += 1
      } else if (item.typeId === 'bug') {
        bugs += 1
      } else {
        content += 1
      }
    }
    const label = w === 0 ? 'This wk' : `${w}w ago`
    return { label, total: features + bugs + content, features, bugs, content }
  })

  const runs30d = project.goals.reduce((s, g) => s + g.viewer.usage30d.runs, 0)
  const runs7d = project.goals.reduce((s, g) => s + g.viewer.usage7d.runs, 0)
  const tokens7d = project.goals.reduce((s, g) => s + g.viewer.usage7d.tokens, 0)
  const tokens30d = project.goals.reduce((s, g) => s + g.viewer.usage30d.tokens, 0)
  const cost30d = r2(project.goals.reduce((s, g) => s + g.viewer.usage30d.cost, 0))
  const cost7d = r2(tokens30d > 0 ? cost30d * (tokens7d / tokens30d) : 0)
  const ok30d = project.goals.reduce(
    (s, g) => s + Math.round((goalSuccessRate30d(g) / 100) * g.viewer.usage30d.runs),
    0
  )
  const successRate30d = runs30d > 0 ? r1((ok30d / runs30d) * 100) : 100

  const fGoals = project.goals.filter((g) => g.goal.toLowerCase().includes('feature'))
  const costPool = fGoals.length ? fGoals : project.goals
  const featureCost30d = costPool.reduce((s, g) => s + g.viewer.usage30d.cost, 0)
  const featureTokens30d = costPool.reduce((s, g) => s + g.viewer.usage30d.tokens, 0)
  const shipped30d = Math.max(
    velocity.reduce((s, w) => s + w.features, 0),
    completed > 0 ? Math.min(completed, 10) : 0
  )
  const avgFeatureCostUsd = shipped30d > 0 ? r2(featureCost30d / shipped30d) : 0
  const avgFeatureTokens = shipped30d > 0 ? Math.round(featureTokens30d / shipped30d) : 0

  const dailyTokens7d = Math.round(tokens7d / 7)
  const dailyTokens30d = Math.max(1, Math.round(tokens30d / 30))
  const burnRatioPct = Math.min(150, r1((dailyTokens7d / dailyTokens30d) * 95))
  const burnStatus: 'on-track' | 'under-burning' | 'over-burning' =
    burnRatioPct > 105 ? 'over-burning' : burnRatioPct < 75 ? 'under-burning' : 'on-track'
  const decisionsPath =
    project.goals.find((g) => g.viewer.decisionsPath)?.viewer.decisionsPath ?? null
  const lists = { funnel, dwellStats, stuckAlerts, rejections, velocity }
  const runKpis = { runs7d, runs30d, tokens7d, tokens30d }
  const spendKpis = { cost7d, cost30d, successRate30d, shipped30d, decisionsPath }
  const costKpis = { avgFeatureCostUsd, avgFeatureTokens, dailyTokens7d, burnRatioPct, burnStatus }
  return { ...lists, ...runKpis, ...spendKpis, ...costKpis }
}

export function XosAnalyticsSection({
  project,
  onSelectGoal
}: {
  project: XosProject
  onSelectGoal: (goal: XosGoal) => void
}): React.JSX.Element {
  const { snapshot } = useXosItems()
  const stats = useMemo(() => deriveProjectAnalytics(project, snapshot), [project, snapshot])
  const burnTone =
    stats.burnStatus === 'on-track'
      ? TONE_CLASS.ok
      : stats.burnStatus === 'over-burning'
        ? TONE_CLASS['backed-up']
        : TONE_CLASS.starved
  const escalations = project.goals.filter(
    (g) => g.messages.inboxOpen > 0 || g.result.toLowerCase().includes('fail')
  )
  const runsSub = `${stats.successRate30d}% 30d success rate`
  const spendVal = `${formatCurrency(stats.cost7d)} / ${formatCurrency(stats.cost30d)}`
  const spendSub = `${formatCompactNumber(stats.tokens7d)} / ${formatCompactNumber(stats.tokens30d)} tok`
  const featVal = stats.shipped30d > 0 ? formatCurrency(stats.avgFeatureCostUsd) : '—'
  const featSub = `${stats.shipped30d} shipped · ${formatCompactNumber(stats.avgFeatureTokens)} tok avg`
  const [burnVal, burnSub] = [
    `${formatCompactNumber(stats.dailyTokens7d)}/day`,
    `${stats.burnRatioPct}% of 95% budget target`
  ]
  const kpiCards: [string, string, string, string | null][] = [
    ['Runs (7d / 30d)', `${stats.runs7d} / ${stats.runs30d}`, runsSub, null],
    ['Token Spend (7d / 30d)', spendVal, spendSub, null],
    ['Cost / Shipped Feature', featVal, featSub, null],
    ['Token-Maxxing Burn (OV4)', burnVal, burnSub, stats.burnStatus.replace('-', ' ')]
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpiCards.map(([label, value, sub, badge]) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              {badge && <span className={['xos-chip', burnTone].join(' ')}>{badge}</span>}
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-2.5 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="size-3.5" />
              Feature Funnel Conversion
            </h3>
            <span className="text-xs text-muted-foreground">
              Inbox → Accepted → Ready → Completed
            </span>
          </div>
          <div className="space-y-2">
            {stats.funnel.map((step) => (
              <div key={step.stage} className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{step.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {step.currentCount} in queue · {step.cumulativeCount} cumulative ({step.stepPct}
                    % step · {step.topPct}% total)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, step.topPct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2.5 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Flame className="size-3.5" />
              Weekly Velocity &amp; Rejections
            </h3>
            <span className="text-xs text-muted-foreground">Last 4 weeks</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {stats.velocity.map((w) => (
              <div key={w.label} className="rounded-md border bg-muted/20 p-2">
                <p className="text-[11px] text-muted-foreground">{w.label}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums">{w.total}</p>
                <p className="text-[10px] text-muted-foreground">
                  {w.features}F · {w.bugs}B · {w.content}C
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground">Rejection Buckets</p>
            {stats.rejections.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rejected items recorded.</p>
            ) : (
              stats.rejections.slice(0, 5).map((r) => (
                <div key={r.bucket} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-[11px]">{r.bucket}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.count} ({r.sharePct}%)
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-2.5 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Time in Queue &amp; Stuck-Item Alerts (&gt;{STUCK_HOURS}h)
            </h3>
            {stats.stuckAlerts.length > 0 && (
              <span className="xos-chip xos-tone-warning">{stats.stuckAlerts.length} stuck</span>
            )}
          </div>
          {stats.dwellStats.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              {stats.dwellStats.slice(0, 6).map((d) => (
                <div key={d.stageId} className="rounded border bg-muted/15 px-2.5 py-1.5">
                  <p className="font-medium capitalize">{d.stageId}</p>
                  <p className="tabular-nums text-[11px] text-muted-foreground">
                    avg {d.avgHours}h · med {d.medianHours}h · max {d.maxHours}h
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="scrollbar-sleek max-h-40 space-y-1.5 overflow-y-auto">
            {stats.stuckAlerts.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No active queue items stuck past {STUCK_HOURS}h.
              </p>
            ) : (
              stats.stuckAlerts.slice(0, 8).map((a) => {
                const target = { projectKey: project.key, typeId: a.typeId, stageId: a.stageId }
                return (
                  <div
                    key={a.path}
                    className="flex items-center justify-between gap-2 rounded border bg-muted/20 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.typeId}/{a.stageId} · {a.ageHours}h old ({relativeTime(a.updatedAt)})
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openXosItemsInTasks(target)}>
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="space-y-2.5 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="size-3.5" />
              Special Projects &amp; Pending Decisions (GD6 / OV5)
            </h3>
            {stats.decisionsPath && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openFile(stats.decisionsPath!)}
              >
                <FileText className="size-3.5" />
                DECISIONS.md
              </Button>
            )}
          </div>
          {escalations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No pending human decisions or escalations queued.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {escalations.slice(0, 4).map((g) => (
                <li key={g.goal} className="rounded border bg-muted/20 px-2.5 py-1.5">
                  <span className="font-medium">{prettyGoal(g.goal)}:</span>{' '}
                  {g.messages.inboxOpen > 0 ? `${g.messages.inboxOpen} open inbox msg` : g.result}
                </li>
              ))}
            </ul>
          )}
          <div className="scrollbar-sleek max-h-40 space-y-1 overflow-y-auto pt-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Goal Token Efficiency (30d)
            </p>
            {project.goals.map((g) => (
              <button
                key={g.goal}
                type="button"
                onClick={() => onSelectGoal(g)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
              >
                <span className="truncate font-medium">{prettyGoal(g.goal)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {g.viewer.usage30d.runs} runs · {goalSuccessRate30d(g)}% ok ·{' '}
                  {formatCurrency(g.viewer.usage30d.cost)}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
