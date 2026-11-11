import { Clock, DollarSign, Users } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { ProjectedCoordinatedRun } from './coordinated-automation-run-projection'
function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null) {
    return '—'
  }
  if (seconds < 60) {
    return `${seconds}s`
  }
  const mins = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
}

function formatUsd(amount: number | null): string {
  if (amount === null) {
    return '—'
  }
  return `$${amount.toFixed(2)}`
}

export function AutomationCoordinatedRunLimits({
  budgets
}: {
  budgets: ProjectedCoordinatedRun['budgetsAndCeilings']
}) {
  return (
    <>
      {' '}
      {/* Time, Spend, Concurrency, and Circuit-Breaker Limits Strip */}
      <div
        className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card/60 p-2.5 text-xs @md:grid-cols-3 @2xl:grid-cols-6"
        data-testid="coordinated-run-limits-strip"
      >
        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-3xs text-muted-foreground">
            <Clock className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.c2fff76914',
              'Wall-clock time'
            )}
          </div>
          <div
            className={cn(
              'mt-0.5 font-mono text-xs font-medium',
              budgets.wallClockExceeded ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatDurationSeconds(budgets.elapsedSeconds)} /{' '}
            {formatDurationSeconds(budgets.maxWallClockSeconds)}
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-3xs text-muted-foreground">
            <DollarSign className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.bf7b95a95c',
              'Spend ceiling'
            )}
          </div>
          <div
            className={cn(
              'mt-0.5 font-mono text-xs font-medium',
              budgets.costExceeded ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatUsd(budgets.estimatedCostUsd)} / {formatUsd(budgets.maxEstimatedCostUsd)}
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-3xs text-muted-foreground">
            <Users className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.8fe1190d34',
              'Concurrency'
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-foreground">
            {budgets.activeConcurrency} / {budgets.maxConcurrency ?? '∞'}{' '}
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.d317ea0ce1',
              'active'
            )}
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="text-3xs text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.e3c3d56a5b',
              'Review loops'
            )}
          </div>
          <div
            className={cn(
              'mt-0.5 font-mono text-xs font-medium',
              budgets.reviewLimitReached ? 'text-status-warning-text' : 'text-foreground'
            )}
          >
            {budgets.maxReviewIterationsUsed} / {budgets.maxReviewIterationsCeiling ?? '∞'}
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="text-3xs text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.202f994ae9',
              'Start failures'
            )}
          </div>
          <div
            className={cn(
              'mt-0.5 font-mono text-xs font-medium',
              budgets.circuitBreakerTripped ? 'text-destructive' : 'text-foreground'
            )}
          >
            {budgets.dispatchStartFailuresCount} / {budgets.maxDispatchStartFailuresCeiling}
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="text-3xs text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.5e1743dce4',
              'Active fixers'
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-foreground">
            {budgets.activeFixersCount} / {budgets.maxActiveFixersPerArtifact ?? '∞'}
          </div>
        </div>
      </div>
    </>
  )
}
