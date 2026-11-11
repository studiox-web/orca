// XOS fork: Goal Viewer "Recent runs" list (moved out of XosGoalViewer to stay within file
// limits), with the §3e drill-in action on every run: Continue on… starts a new session primed
// with that run's log context.
import React from 'react'
import { Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosGoalRun } from '../../../../shared/xos-goals-types'
import { formatDuration, formatTimestamp, preferredTelemetryValue } from './xos-format'
import { StatusBadge } from './XosGoalViewerParts'

export function XosGoalRunList({
  item,
  onContinueOn
}: {
  item: XosGoal
  onContinueOn: (run: XosGoalRun) => void
}): React.JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <h2 className="text-sm font-semibold text-primary">Recent runs</h2>
      {item.viewer.recentRuns.length === 0 ? (
        <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
          No run receipts available.
        </p>
      ) : (
        <div className="grid gap-2">
          {item.viewer.recentRuns.map((run) => (
            <div
              key={`${run.log_path}-${run.started_at}`}
              className="rounded-lg border bg-background/60 p-3 text-sm"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge
                  value={run.failure_reason ? `${run.status}: ${run.failure_reason}` : run.status}
                />
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(run.started_at) ?? 'Unknown start'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Continue on from the run of ${run.started_at ?? 'unknown start'}`}
                    onClick={() => onContinueOn(run)}
                  >
                    <Waypoints className="size-3.5" />
                    Continue on…
                  </Button>
                </span>
              </span>
              <span className="mt-2 block truncate font-mono text-xs" title={run.log_path}>
                {run.log_path || 'Run log unavailable'}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {run.runner ?? 'runner?'} ·{' '}
                {preferredTelemetryValue(run.model, item.viewer.configuredModel) ?? 'Unknown model'}{' '}
                ·{' '}
                {preferredTelemetryValue(run.reasoning_effort, item.viewer.configuredReasoning) ??
                  'No reasoning level'}{' '}
                · {formatDuration(run.duration_seconds) ?? 'No duration'}
                {run.exit_code !== null && run.exit_code !== undefined
                  ? ` · exit ${run.exit_code}`
                  : ''}
                {run.trigger === 'manual_takeover' ? ' · operator at the helm' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
