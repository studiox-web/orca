// XOS fork: Stage D drill-in row for the Goal Viewer (plan §3c "Recommended manager command → a
// one-click run", §3e drill-in actions, §3h.2 "Build now" / "Work on it myself"): Continue on…,
// Work on it myself, Build now, and the manager command bar for area manager / C-suite goals.
import React from 'react'
import { Hammer, PersonStanding, Waypoints, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosGoalRun, XosProject } from '../../../../shared/xos-goals-types'
import type { XosDrillInMode } from './XosContinueOnDialog'

/** The goal a manager recommendation points at, when it names a run-goal(-cron).sh command. */
function recommendedGoal(
  recommended: string,
  project: XosProject
): { target: XosGoal; viaMessage: boolean } | null {
  const named = /run-goal(?:-cron)?\.sh\s+([A-Za-z0-9_-]+)/.exec(recommended)?.[1]
  const target = named ? project.goals.find((candidate) => candidate.goal === named) : undefined
  if (target) {
    return { target, viaMessage: false }
  }
  const bare = project.goals.find((candidate) => candidate.goal === recommended.trim())
  return bare ? { target: bare, viaMessage: false } : null
}

function ManagerCommandBar({
  item,
  project,
  onRun
}: {
  item: XosGoal
  project: XosProject
  onRun: (goal: XosGoal, message?: string) => void
}): React.JSX.Element | null {
  const recommended = item.status.recommended_command?.replace(/^`|`$/g, '').trim()
  const isLeadership = item.goal === item.area.manager || item.area.id === 'c-suite'
  if (!recommended || !isLeadership) {
    return null
  }
  const parsed = recommendedGoal(recommended, project)
  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <h2 className="text-sm font-semibold text-primary">Manager command</h2>
      <p className="text-xs text-muted-foreground">
        The manager recommends this next move; run it with one click.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs"
          title={recommended}
        >
          {recommended}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={() => (parsed ? onRun(parsed.target) : onRun(item, recommended))}
        >
          <Zap className="size-4" />
          Run
        </Button>
      </div>
    </section>
  )
}

export function XosGoalDrillIn({
  item,
  project,
  busy,
  onRun,
  onContinueOn,
  onRelease
}: {
  item: XosGoal
  project: XosProject
  busy: boolean
  onRun: (goal: XosGoal, message?: string) => void
  onContinueOn: (mode: XosDrillInMode, fromRun?: XosGoalRun | null) => void
  onRelease: (advance: boolean) => void
}): React.JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
        <span className="text-xs font-semibold text-muted-foreground">Drill in</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onContinueOn('continue-on')}
        >
          <Waypoints className="size-4" />
          Continue on…
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onContinueOn('work-myself')}
        >
          <PersonStanding className="size-4" />
          Work on it myself
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onContinueOn('build-now')}
        >
          <Hammer className="size-4" />
          Build now
        </Button>
      </div>
      {item.takeover && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {item.takeover.agent} is at the helm: this goal&apos;s lane is held until you release
            it.
          </span>
          <Button type="button" size="sm" disabled={busy} onClick={() => onRelease(true)}>
            Done: release to auto
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRelease(false)}
          >
            Release without moving the item
          </Button>
        </div>
      )}
      <ManagerCommandBar item={item} project={project} onRun={onRun} />
    </>
  )
}
