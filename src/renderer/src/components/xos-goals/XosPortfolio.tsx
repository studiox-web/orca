// XOS fork: "All projects" portfolio: tiles + the cross-project "Running now" strip, plus the
// stage G PF1-PF7 rollup cards (XosPortfolioRollup).
export { XosPortfolioRollupView } from './XosPortfolioRollup'
import React from 'react'
import { RefreshCw } from 'lucide-react'
import type { XosGoal, XosGoalBoard, XosProject } from '../../../../shared/xos-goals-types'
import { areaHealth, goalHasIssue } from './xos-org-hierarchy'
import { formatDuration, formatTimestamp, relativeTime } from './xos-format'
import { HealthBadge } from './XosOrgChartViews'

export function RunningStrip({
  board,
  onOpen
}: {
  board: XosGoalBoard
  onOpen: (project: XosProject, goal: XosGoal) => void
}): React.JSX.Element | null {
  const running = board.projects.flatMap((project) =>
    project.goals.filter((goal) => goal.running).map((goal) => ({ project, goal }))
  )
  if (running.length === 0) {
    return null
  }
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <span className="flex items-center gap-2 font-semibold text-primary">
        <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
        Running now
      </span>
      {running.map(({ project, goal }) => (
        <button
          key={`${project.key}:${goal.goal}`}
          type="button"
          onClick={() => onOpen(project, goal)}
          className="rounded-full border bg-background px-3 py-1 text-xs font-semibold hover:border-primary/50"
        >
          {project.name} · {goal.title} · {formatDuration(goal.running?.elapsedSeconds)}
        </button>
      ))}
    </section>
  )
}

export function PortfolioTiles({
  board,
  onSelect
}: {
  board: XosGoalBoard
  onSelect: (key: string) => void
}): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {board.projects.map((project) => {
        const goals = project.goals
        const issues = goals.filter(goalHasIssue).length
        const paused = goals.filter((goal) => goal.paused).length
        const scheduled = goals.filter((goal) => goal.viewer.cron.configured && !goal.paused).length
        const inbox = goals.reduce((sum, goal) => sum + goal.messages.inboxOpen, 0)
        const next = goals
          .map((goal) => goal.nextRun)
          .filter((value): value is string => !!value)
          .sort()[0]
        const cost30d = goals.reduce((sum, goal) => sum + goal.viewer.usage30d.cost, 0)
        return (
          <button
            key={project.key}
            type="button"
            onClick={() => onSelect(project.key)}
            className="rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate text-lg font-semibold">{project.name}</h2>
              <HealthBadge health={areaHealth(goals)} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={project.root}>
              {project.root}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              {[
                ['Goals', goals.length],
                ['Scheduled', scheduled],
                ['Running', goals.filter((goal) => goal.running).length],
                ['Issues', issues],
                ['Paused', paused],
                ['Inbox', inbox]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-background/60 p-2">
                  <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
                  <dd className="text-base font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {next
                ? `Next goal run ${formatTimestamp(next)} (${relativeTime(next)})`
                : 'No goal runs scheduled'}{' '}
              · 30-day goal cost ${cost30d.toFixed(2)} · {project.scripts.length} script job
              {project.scripts.length === 1 ? '' : 's'}
            </p>
          </button>
        )
      })}
    </div>
  )
}
