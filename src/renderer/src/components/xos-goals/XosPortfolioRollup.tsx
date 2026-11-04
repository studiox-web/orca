// XOS fork: Cross-Project Portfolio view (stage G, PF1-PF7). Sits under the "All projects" tiles:
// the control-plane summary, per-project modes (PF2) and approvals (PF5), top bottleneck queues,
// and the deck-pack readiness matrix with the installer preview. The detail cards (sprint PF3,
// budgets PF4, versioning PF6, cutover PF7, comparison) live in XosPortfolioCards.
import React, { useCallback, useEffect, useState } from 'react'
import { Check, Crosshair, Layers, Package, Pause, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { XosPortfolioRollup } from '../../../../shared/xos-portfolio-types'
import { formatCompactNumber, formatCurrency, relativeTime } from './xos-format'
import {
  BudgetCard,
  ComparisonCard,
  CutoverCard,
  HEALTH_TONE,
  MODES,
  MODE_BY_VALUE,
  PfCard,
  SprintCard,
  Stat,
  VersioningCard
} from './XosPortfolioCards'

function usePortfolioRollup(): {
  rollup: XosPortfolioRollup | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const api = window.api.xosGoals
  const [rollup, setRollup] = useState<XosPortfolioRollup | null>(null)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    if (!api) {
      return
    }
    setLoading(true)
    try {
      setRollup(await api.getRollup())
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [api])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { rollup, loading, refresh }
}

export function XosPortfolioRollupView({
  onSelect
}: {
  onSelect: (key: string) => void
}): React.JSX.Element {
  const { rollup, loading, refresh } = usePortfolioRollup()
  const [preview, setPreview] = useState<{ packId: string; projectKey: string } | null>(null)

  const mutate = async (
    mutation: Parameters<NonNullable<typeof window.api.xosGoals>['mutatePortfolio']>[0]
  ): Promise<void> => {
    const api = window.api.xosGoals
    if (!api) {
      return
    }
    const result = await api.mutatePortfolio(mutation)
    if (result.ok) {
      toast.success(result.message)
      await refresh()
    } else {
      toast.error(result.error)
    }
  }

  if (!rollup) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
        Loading portfolio rollup…
      </div>
    )
  }
  const overall = rollup.overall
  const previewPack = preview ? rollup.packs.find((pack) => pack.id === preview.packId) : null
  const previewProject = preview
    ? rollup.projects.find((project) => project.projectKey === preview.projectKey)
    : null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PfCard
          icon={Layers}
          title="PF1 · Control plane"
          badge={`${rollup.projects.length} projects`}
        >
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Health"
              value={<span className={HEALTH_TONE[overall.healthTone]}>{overall.healthLabel}</span>}
            />
            <Stat label="Goals" value={overall.goals.total} />
            <Stat label="Attention" value={overall.goals.attention} />
            <Stat label="Active" value={overall.goals.active} />
            <Stat label="Queued" value={overall.goals.queued} />
            <Stat label="Running" value={overall.goals.running} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatCompactNumber(overall.tokens.tokens7d)} tokens /{' '}
            {formatCurrency(overall.tokens.cost7d)} 7d ·{' '}
            {formatCompactNumber(overall.tokens.tokens30d)} tokens /{' '}
            {formatCurrency(overall.tokens.cost30d)} 30d
          </p>
        </PfCard>

        <PfCard icon={Pause} title="PF2 · Modes & pause" badge="hierarchical">
          <div className="space-y-1.5">
            {rollup.projects.map((project) => (
              <div key={project.projectKey} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="truncate font-medium hover:underline"
                  onClick={() => onSelect(project.projectKey)}
                >
                  {project.name}
                </button>
                <select
                  value={project.mode}
                  onChange={(event) =>
                    void mutate({
                      kind: 'set-mode',
                      projectKey: project.projectKey,
                      mode: MODE_BY_VALUE[event.target.value] ?? 'active'
                    })
                  }
                  className="ml-auto rounded border bg-background px-1.5 py-0.5 text-xs"
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  {project.goals.paused}/{project.goals.total} paused
                </span>
              </div>
            ))}
          </div>
        </PfCard>

        <SprintCard
          rollup={rollup}
          onSave={(sprint) => void mutate({ kind: 'set-sprint', sprint })}
        />

        <PfCard
          icon={ShieldCheck}
          title="PF5 · Approvals"
          badge={`${overall.reviews.pending} pending`}
        >
          <div className="space-y-1.5">
            {rollup.projects.map((project) => (
              <div
                key={project.projectKey}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">{project.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {project.reviews.pending} pending · {project.reviews.accepted} accepted ·{' '}
                  {project.reviews.rejected} rejected
                </span>
              </div>
            ))}
            {overall.reviews.pending === 0 && (
              <p className="text-xs text-muted-foreground">Nothing waiting on you.</p>
            )}
          </div>
        </PfCard>
      </div>

      <ComparisonCard rollup={rollup} onSelect={onSelect} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BudgetCard
          rollup={rollup}
          onSave={(projectKey, budget) => void mutate({ kind: 'set-budget', projectKey, budget })}
        />
        <VersioningCard rollup={rollup} />
        <CutoverCard rollup={rollup} />
      </div>

      <PfCard icon={Crosshair} title="Top bottleneck queues" badge="across projects">
        {rollup.topBottlenecks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active queues with work.</p>
        ) : (
          <div className="space-y-1.5">
            {rollup.topBottlenecks.map((queue) => (
              <div
                key={`${queue.projectKey}:${queue.typeId}/${queue.stageId}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span
                  className={`xos-chip ${queue.tone === 'ok' ? 'xos-tone-success' : HEALTH_TONE[queue.tone === 'backed-up' ? 'danger' : 'warning']}`}
                >
                  {queue.tone}
                </span>
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => onSelect(queue.projectKey)}
                >
                  {queue.projectName}
                </button>
                <span className="text-muted-foreground">
                  {queue.typeId}/{queue.stageId}: {queue.count}
                  {queue.readyCount != null ? ` (${queue.readyCount} ready)` : ''}
                </span>
                {queue.oldestAt && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    oldest {relativeTime(queue.oldestAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </PfCard>

      <PfCard
        icon={Package}
        title="Deck packs & template readiness"
        badge={rollup.packs.length.toString()}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-semibold">Pack</th>
                {rollup.projects.map((project) => (
                  <th key={project.projectKey} className="py-1 pr-3 font-semibold">
                    {project.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rollup.packs.map((pack) => (
                <tr key={pack.id} className="border-t">
                  <td className="py-1.5 pr-3">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() =>
                        setPreview({
                          packId: pack.id,
                          projectKey: rollup.projects[0]?.projectKey ?? ''
                        })
                      }
                    >
                      {pack.label}
                    </button>
                    <p className="text-[11px] text-muted-foreground">{pack.description}</p>
                  </td>
                  {rollup.projects.map((project) => {
                    const readiness = project.packs.find((entry) => entry.packId === pack.id)
                    return (
                      <td key={project.projectKey} className="py-1.5 pr-3">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() =>
                            setPreview({ packId: pack.id, projectKey: project.projectKey })
                          }
                        >
                          <span
                            className={`xos-chip ${readiness?.ready ? 'xos-tone-success' : (readiness?.installed ?? 0) > 0 ? 'xos-tone-warning' : 'xos-tone-neutral'}`}
                          >
                            {readiness?.installed ?? 0}/{readiness?.total ?? pack.goals.length}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PfCard>

      {preview && previewPack && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-lg space-y-3 rounded-lg border bg-card p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">Install preview · {previewPack.label}</h3>
            <select
              value={preview.projectKey}
              onChange={(event) =>
                setPreview({ packId: preview.packId, projectKey: event.target.value })
              }
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            >
              {rollup.projects.map((project) => (
                <option key={project.projectKey} value={project.projectKey}>
                  {project.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Installing creates the missing goals with the queue wiring of the pack. Preview only —
              the installer lands with the Cards view.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto scrollbar-sleek">
              {previewPack.goals.map((goal) => {
                const installed = !previewProject?.packs
                  .find((entry) => entry.packId === preview.packId)
                  ?.missing.includes(goal)
                return (
                  <div
                    key={goal}
                    className="flex items-center gap-2 rounded border bg-background/60 px-2 py-1 text-sm"
                  >
                    {installed ? (
                      <Check className="size-3.5 xos-tone-success" />
                    ) : (
                      <span className="size-3.5 rounded-full border" />
                    )}
                    <span className={installed ? 'text-muted-foreground line-through' : ''}>
                      {goal}
                    </span>
                    <span
                      className={`xos-chip ml-auto ${installed ? 'xos-tone-success' : 'xos-tone-warning'}`}
                    >
                      {installed ? 'installed' : 'would create'}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
