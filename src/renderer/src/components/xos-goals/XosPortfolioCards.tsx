// XOS fork: Cross-Project Portfolio card parts (stage G). Shared shell pieces and the PF3-PF7
// detail cards (focus sprint, token budgets, versioning, cutover, the health/cost comparison
// table) used by XosPortfolioRollup.
import React, { useState } from 'react'
import { Crosshair, Layers, ShieldCheck, Tags, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type {
  XosCapacityProfile,
  XosPortfolioRollup,
  XosProjectMode,
  XosProjectRollup
} from '../../../../shared/xos-portfolio-types'
import { formatCompactNumber, formatCurrency, relativeTime } from './xos-format'

export const HEALTH_TONE: Record<string, string> = {
  danger: 'xos-tone-danger',
  warning: 'xos-tone-warning',
  success: 'xos-tone-success',
  neutral: 'xos-tone-neutral'
}

export const MODES: XosProjectMode[] = ['focus', 'active', 'maintenance', 'paused']
const CAPACITIES: XosCapacityProfile[] = ['focused', 'balanced', 'expanded']

const CAPACITY_BY_VALUE: Record<string, XosCapacityProfile> = {
  focused: 'focused',
  balanced: 'balanced',
  expanded: 'expanded'
}

export const MODE_BY_VALUE: Record<string, XosProjectMode> = {
  focus: 'focus',
  active: 'active',
  maintenance: 'maintenance',
  paused: 'paused'
}

export function PfCard({
  icon: Icon,
  title,
  badge,
  children
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  badge?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Icon className="size-4" />
        {title}
        {badge && <span className="xos-chip xos-tone-neutral ml-auto">{badge}</span>}
      </h3>
      {children}
    </section>
  )
}

export function Stat({
  label,
  value
}: {
  label: string
  value: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-background/60 p-2 text-center">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

export function ComparisonCard({
  rollup,
  onSelect
}: {
  rollup: XosPortfolioRollup
  onSelect: (key: string) => void
}): React.JSX.Element {
  const heads = [
    'Project',
    'Health',
    'Goals',
    'Attention',
    'Runs 7d',
    'Success 7d',
    'Tokens 7d',
    'Cost 7d',
    'Cost 30d',
    'Success 30d'
  ]
  return (
    <PfCard icon={Layers} title="Cross-project health & cost" badge={`${rollup.projects.length}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {heads.map((head) => (
                <th key={head} className="py-1 pr-3 font-semibold">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rollup.projects.map((project) => (
              <tr key={project.projectKey} className="border-t">
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => onSelect(project.projectKey)}
                  >
                    {project.name}
                  </button>
                  <span className="ml-1 text-[11px] text-muted-foreground">{project.mode}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <span className={HEALTH_TONE[project.healthTone]}>{project.healthLabel}</span>
                </td>
                <td className="py-1.5 pr-3">
                  {project.goals.active}/{project.goals.total}
                </td>
                <td className="py-1.5 pr-3">{project.goals.attention}</td>
                <td className="py-1.5 pr-3">{project.runs.runs7d}</td>
                <td className="py-1.5 pr-3">
                  {project.runs.successRate7d != null ? `${project.runs.successRate7d}%` : '—'}
                </td>
                <td className="py-1.5 pr-3">{formatCompactNumber(project.tokens.tokens7d)}</td>
                <td className="py-1.5 pr-3">{formatCurrency(project.tokens.cost7d)}</td>
                <td className="py-1.5 pr-3">{formatCurrency(project.tokens.cost30d)}</td>
                <td className="py-1.5 pr-3">
                  {project.runs.successRate30d != null ? `${project.runs.successRate30d}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PfCard>
  )
}

export function SprintCard({
  rollup,
  onSave
}: {
  rollup: XosPortfolioRollup
  onSave: (sprint: XosPortfolioRollup['config']['sprint']) => void
}): React.JSX.Element {
  const sprint = rollup.config.sprint
  const [projectKey, setProjectKey] = useState(
    sprint?.projectKey ?? rollup.projects[0]?.projectKey ?? ''
  )
  const [capacity, setCapacity] = useState<XosCapacityProfile>(sprint?.capacity ?? 'balanced')
  const [reserve, setReserve] = useState(sprint?.reservePercent ?? 10)
  return (
    <PfCard
      icon={Crosshair}
      title="PF3 · Focus sprint"
      badge={sprint ? `since ${relativeTime(sprint.startedAt)}` : 'none'}
    >
      <div className="space-y-1.5 text-sm">
        <select
          value={projectKey}
          onChange={(event) => setProjectKey(event.target.value)}
          className="w-full rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {rollup.projects.map((project) => (
            <option key={project.projectKey} value={project.projectKey}>
              {project.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <select
            value={capacity}
            onChange={(event) => setCapacity(CAPACITY_BY_VALUE[event.target.value] ?? 'balanced')}
            className="rounded border bg-background px-1.5 py-0.5 text-xs"
          >
            {CAPACITIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            reserve
            <input
              type="number"
              min={0}
              max={90}
              value={reserve}
              onChange={(event) => setReserve(Number(event.target.value) || 0)}
              className="w-14 rounded border bg-background px-1 py-0.5 text-xs"
            />
            %
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7"
            onClick={() =>
              onSave({
                projectKey,
                startedAt:
                  sprint?.projectKey === projectKey ? sprint.startedAt : new Date().toISOString(),
                capacity,
                reservePercent: reserve
              })
            }
          >
            {sprint ? 'Update sprint' : 'Start sprint'}
          </Button>
          {sprint && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => onSave(null)}
            >
              End sprint
            </Button>
          )}
        </div>
      </div>
    </PfCard>
  )
}

export function BudgetCard({
  rollup,
  onSave
}: {
  rollup: XosPortfolioRollup
  onSave: (
    projectKey: string,
    budget: { weeklyTokens: number | null; weeklyCostUsd: number | null }
  ) => void
}): React.JSX.Element {
  return (
    <PfCard icon={Wallet} title="PF4 · Token budgets" badge="weekly">
      <div className="space-y-1.5">
        {rollup.projects.map((project) => (
          <BudgetRow key={project.projectKey} project={project} onSave={onSave} />
        ))}
      </div>
    </PfCard>
  )
}

function BudgetRow({
  project,
  onSave
}: {
  project: XosProjectRollup
  onSave: (
    projectKey: string,
    budget: { weeklyTokens: number | null; weeklyCostUsd: number | null }
  ) => void
}): React.JSX.Element {
  const [cost, setCost] = useState(project.budget.weeklyCostUsd?.toString() ?? '')
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{project.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          7d {formatCurrency(project.tokens.cost7d)} · 30d {formatCurrency(project.tokens.cost30d)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          $
          <input
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            placeholder="no limit"
            className="w-20 rounded border bg-background px-1 py-0.5 text-xs"
          />
          /wk
        </label>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() =>
            onSave(project.projectKey, {
              weeklyTokens: null,
              weeklyCostUsd: cost ? Number(cost) : null
            })
          }
        >
          Save
        </Button>
        {project.budget.utilization7d != null && (
          <span
            className={`xos-chip ml-auto ${project.budget.utilization7d >= 100 ? 'xos-tone-danger' : project.budget.utilization7d >= 70 ? 'xos-tone-warning' : 'xos-tone-success'}`}
          >
            {project.budget.utilization7d}% used
          </span>
        )}
      </div>
    </div>
  )
}

export function VersioningCard({ rollup }: { rollup: XosPortfolioRollup }): React.JSX.Element {
  return (
    <PfCard icon={Tags} title="PF6 · Versioned definitions" badge="immutable">
      <div className="space-y-1.5 text-sm">
        {rollup.projects.map((project) => (
          <div key={project.projectKey} className="flex items-center gap-2">
            <span
              className={`xos-chip ${project.versioning.imported ? 'xos-tone-success' : 'xos-tone-neutral'}`}
            >
              {project.versioning.imported ? 'imported' : 'legacy'}
            </span>
            <span className="truncate">{project.name}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {project.versioning.commitSha ?? 'no commit'} · {project.versioning.versionedGoals}/
              {project.versioning.totalGoals} goals
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Every run receipt carries the definition hash of the contract it ran.
        </p>
      </div>
    </PfCard>
  )
}

export function CutoverCard({ rollup }: { rollup: XosPortfolioRollup }): React.JSX.Element {
  return (
    <PfCard
      icon={ShieldCheck}
      title="PF7 · Cutover safety"
      badge={`fingerprint ${rollup.projects[0]?.cutover.fingerprint?.slice(0, 8) ?? '—'}`}
    >
      <div className="space-y-1.5 text-sm">
        {rollup.projects.map((project) => (
          <div key={project.projectKey} className="flex items-center gap-2">
            <span
              className={`xos-chip ${project.cutover.state === 'complete' ? 'xos-tone-success' : project.cutover.state === 'pending' ? 'xos-tone-warning' : 'xos-tone-neutral'}`}
            >
              {project.cutover.state}
            </span>
            <span className="truncate">{project.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {project.cutover.legacyActiveLines}/{project.cutover.legacyGoalLines} legacy cron
              lines active
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          The legacy owner stays paused until the Orca replacement matches a week of receipts.
        </p>
      </div>
    </PfCard>
  )
}
