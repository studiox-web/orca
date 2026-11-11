// XOS fork: Stage E Analytics & Funnel Stats section (OV3, OV4, GD6, OV5, §3g.6).
// Renders KPI cards, Token-Maxxing burn forecast, Feature Funnel conversion, Time-in-Queue &
// Stuck-Item alerts, Rejection Bucket stats, Weekly Velocity, Cost per Shipped Feature, and
// Pending Decisions / Special Projects.
import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, FileText, Flame, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { XosProjectAnalytics } from '../../../../shared/xos-analytics-types'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { formatCompactNumber, formatCurrency, relativeTime } from './xos-format'
import { prettyGoal, TONE_CLASS } from './xos-items-model'
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

/** Run and spend totals of the board; queue metrics come from main (xos-analytics.ts). */
function deriveRunTotals(project: XosProject) {
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
  const decisionsPath =
    project.goals.find((g) => g.viewer.decisionsPath)?.viewer.decisionsPath ?? null
  return { runs7d, runs30d, tokens7d, tokens30d, cost7d, cost30d, successRate30d, decisionsPath }
}

const EMPTY_ANALYTICS: XosProjectAnalytics = {
  timeInQueue: [],
  stuckAlerts: [],
  funnel: [],
  rejections: [],
  velocity: [],
  featureCosts: {
    shippedFeatures: [],
    avgCostPerFeatureUsd: 0,
    avgTokensPerFeature: 0,
    totalShippedCostUsd: 0
  },
  burn: []
}

export function XosAnalyticsSection({
  project,
  onSelectGoal
}: {
  project: XosProject
  onSelectGoal: (goal: XosGoal) => void
}): React.JSX.Element {
  const [analytics, setAnalytics] = useState<XosProjectAnalytics>(EMPTY_ANALYTICS)
  useEffect(() => {
    let current = true
    void window.api.xosGoals?.getAnalytics({ projectKey: project.key }).then((result) => {
      if (current && result) {
        setAnalytics(result)
      }
    })
    return () => {
      current = false
    }
  }, [project.key])
  const stats = useMemo(() => deriveRunTotals(project), [project])
  const { featureCosts, funnel, rejections, stuckAlerts, timeInQueue, velocity } = analytics
  const shipped = featureCosts.shippedFeatures.length
  const burn = analytics.burn[0] ?? null
  const burnTone =
    burn?.status === 'on-track'
      ? TONE_CLASS.ok
      : burn?.status === 'over-burning'
        ? TONE_CLASS['backed-up']
        : TONE_CLASS.starved
  const escalations = project.goals.filter(
    (g) => g.messages.inboxOpen > 0 || g.result.toLowerCase().includes('fail')
  )
  const runsSub = `${stats.successRate30d}% 30d success rate`
  const spendVal = `${formatCurrency(stats.cost7d)} / ${formatCurrency(stats.cost30d)}`
  const spendSub = `${formatCompactNumber(stats.tokens7d)} / ${formatCompactNumber(stats.tokens30d)} tok`
  const featVal = shipped > 0 ? formatCurrency(featureCosts.avgCostPerFeatureUsd) : '—'
  const featSub = `${shipped} shipped · ${formatCompactNumber(featureCosts.avgTokensPerFeature)} tok avg`
  const [burnVal, burnSub] = burn
    ? [
        `${burn.projectedPctAtReset}% at reset`,
        `${burn.agent}: ${burn.usedPercent}% used, target ${burn.targetUtilizationPct}%`
      ]
    : ['—', 'No live quota window']
  const kpiCards: [string, string, string, string | null][] = [
    ['Runs (7d / 30d)', `${stats.runs7d} / ${stats.runs30d}`, runsSub, null],
    ['Token Spend (7d / 30d)', spendVal, spendSub, null],
    ['Cost / Shipped Feature', featVal, featSub, null],
    ['Token-Maxxing Burn (OV4)', burnVal, burnSub, burn?.status.replace('-', ' ') ?? null]
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
            {funnel.map((step) => (
              <div key={step.stage} className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{step.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {step.currentCount} in queue · {step.cumulativeCount} cumulative (
                    {step.conversionFromPrevPct}% step · {step.conversionFromTopPct}% total)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, step.conversionFromTopPct))}%` }}
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
            {velocity.map((w) => (
              <div key={w.weekStart} className="rounded-md border bg-muted/20 p-2">
                <p className="text-[11px] text-muted-foreground">{w.weekStart}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums">{w.completedCount}</p>
                <p className="text-[10px] text-muted-foreground">
                  {w.featuresCompleted}F · {w.bugsFixed}B · {w.contentPublished}C
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground">Rejection Buckets</p>
            {rejections.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rejected items recorded.</p>
            ) : (
              rejections.slice(0, 5).map((r) => (
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
            {stuckAlerts.length > 0 && (
              <span className="xos-chip xos-tone-warning">{stuckAlerts.length} stuck</span>
            )}
          </div>
          {timeInQueue.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              {timeInQueue.slice(0, 6).map((d) => (
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
            {stuckAlerts.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No active queue items stuck past {STUCK_HOURS}h.
              </p>
            ) : (
              stuckAlerts.slice(0, 8).map((a) => {
                const target = { projectKey: project.key, typeId: a.typeId, stageId: a.stageId }
                return (
                  <div
                    key={a.path}
                    className="flex items-center justify-between gap-2 rounded border bg-muted/20 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.item}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.typeId}/{a.stageId} · {a.ageHours}h old ({relativeTime(a.oldestAt)})
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
