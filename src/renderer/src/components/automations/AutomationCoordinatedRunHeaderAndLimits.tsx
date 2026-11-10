import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  Folder,
  GitBranch,
  HelpCircle,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Square,
  Users
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatUiAutomationSchedule } from './automation-schedule-label'
import type {
  CoordinatedParentSemanticState,
  ProjectedCoordinatedRun
} from './coordinated-automation-run-projection'

export type AutomationCoordinatedRunHeaderAndLimitsProps = {
  projection: ProjectedCoordinatedRun
  onRequestStopRun?: () => void
  onInspectReceipt?: () => void
}

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

const SEMANTIC_STATE_META: Record<
  CoordinatedParentSemanticState,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  completed: {
    label: 'Semantic goal completed',
    variant: 'secondary',
    icon: CheckCircle2
  },
  ready_for_review: {
    label: 'Ready for review',
    variant: 'outline',
    icon: CheckCircle2
  },
  ready_to_publish: {
    label: 'Ready to publish',
    variant: 'secondary',
    icon: CheckCircle2
  },
  published_verified: {
    label: 'Published & verified',
    variant: 'secondary',
    icon: CheckCircle2
  },
  waiting_for_approval: {
    label: 'Waiting for approval',
    variant: 'outline',
    icon: AlertTriangle
  },
  in_progress: {
    label: 'In progress',
    variant: 'default',
    icon: Sparkles
  },
  pending: {
    label: 'Pending / Queued',
    variant: 'outline',
    icon: Clock
  },
  blocked: {
    label: 'Blocked',
    variant: 'destructive',
    icon: AlertTriangle
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: ShieldAlert
  },
  outcome_uncertain: {
    label: 'Outcome uncertain',
    variant: 'destructive',
    icon: ShieldAlert
  },
  quarantined: {
    label: 'Quarantined (fail-closed)',
    variant: 'destructive',
    icon: ShieldAlert
  },
  unaccepted: {
    label: 'Unaccepted technical completion',
    variant: 'outline',
    icon: AlertTriangle
  }
}

export function AutomationCoordinatedRunHeaderAndLimits({
  projection,
  onRequestStopRun,
  onInspectReceipt
}: AutomationCoordinatedRunHeaderAndLimitsProps): React.JSX.Element {
  const semanticMeta = SEMANTIC_STATE_META[projection.semanticOutcomeState]
  const SemanticIcon = semanticMeta.icon
  const budgets = projection.budgetsAndCeilings
  const scheduleLabel = formatUiAutomationSchedule(projection.scheduleState.rrule)
  const pendingQuestions = projection.stages
    .filter((stage) => stage.pendingQuestion !== null)
    .map((stage) => `${stage.name}: ${stage.pendingQuestion?.preview}`)
  const activeBlockers = projection.stages.flatMap((stage) =>
    stage.blockers.map((blocker) => `${stage.name} (${blocker.code}): ${blocker.message}`)
  )
  const uncertainSummaries = projection.stages
    .filter((stage) => stage.hasUncertainEffect)
    .map((stage) => `${stage.name} (${stage.childDefinitionId})`)

  return (
    <div className="space-y-3" data-testid="coordinated-run-header-and-limits">
      {/* Primary Parent Run Summary Banner */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={semanticMeta.variant}
                data-testid="coordinated-run-semantic-outcome-badge"
              >
                <SemanticIcon className="size-3.5 shrink-0" />
                {semanticMeta.label}
              </Badge>

              <Badge variant="outline" data-testid="coordinated-run-technical-status-badge">
                Technical: {projection.technicalRunStatus}
              </Badge>

              {projection.materializationPhase ? (
                <Badge variant="outline">Phase: {projection.materializationPhase}</Badge>
              ) : null}

              <Badge variant="secondary">Frozen Rev {projection.definitionRevision}</Badge>

              {projection.replanOfAutomationRunId ? (
                <Badge variant="outline">
                  <RefreshCw className="size-2.5" />
                  Replanned from {projection.replanOfAutomationRunId}
                </Badge>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">{projection.semanticOutcomeReason}</p>
            {projection.outcomeContract?.humanStatement ? (
              <p className="text-[11px] font-medium text-foreground">
                Outcome contract: {projection.outcomeContract.humanStatement}
              </p>
            ) : null}
          </div>

          {/* Parent Run Controls: Inspect Receipt & Stop Run */}
          <div className="flex flex-wrap items-center gap-1.5">
            {projection.completionReceipt && onInspectReceipt ? (
              <Button type="button" variant="outline" size="xs" onClick={onInspectReceipt}>
                <CheckCircle2 className="size-3.5 text-status-success" />
                Inspect receipt
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="stop-coordinated-run-btn"
              title={
                projection.stopEligibility.reason ??
                `Stop coordinated run ${projection.automationRunId}`
              }
              onClick={onRequestStopRun}
            >
              <Square className="size-3" />
              Stop run
            </Button>
          </div>
        </div>

        {/* 5 Independent State Facets Strip: Run ID, Authority/Host, Workspace, Lifecycle, Schedule */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <span>
            Run: <code className="font-mono text-foreground">{projection.automationRunId}</code>
          </span>
          {projection.orchestrationRunId ? (
            <span>
              Orch:{' '}
              <code className="font-mono text-foreground">{projection.orchestrationRunId}</code>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Server className="size-3 shrink-0" />
            Authority:{' '}
            <code className="font-mono text-foreground">
              {projection.targetExecutionAuthority}
            </code>{' '}
            ({projection.hostLabel}){projection.isRemoteAuthority ? ' [Remote]' : ''}
          </span>
          <span className="inline-flex items-center gap-1">
            {projection.isFolderWorkspace ? (
              <Folder className="size-3 shrink-0" />
            ) : (
              <GitBranch className="size-3 shrink-0" />
            )}
            Workspace:{' '}
            <strong className="font-medium text-foreground">{projection.workspaceLabel}</strong>
            {projection.isFolderWorkspace ? ' (Folder workspace)' : ''}
          </span>
          <span>
            Lifecycle:{' '}
            <strong className="font-medium text-foreground">{projection.lifecycleState}</strong>
          </span>
          <span>
            Schedule: <strong className="font-medium text-foreground">{scheduleLabel}</strong>
          </span>
        </div>
      </div>

      {/* Hazard & Blocker Callouts (Quarantine, Uncertain Effect, Pending Questions, Blockers, Mutation Lanes) */}
      {projection.quarantine ||
      projection.hasUncertainEffects ||
      projection.hasPendingQuestions ||
      projection.hasBlockers ||
      budgets.occupiedMutationLanes.length > 0 ? (
        <div className="space-y-1.5" data-testid="coordinated-run-hazards-panel">
          {projection.quarantine ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">Run quarantined (fail-closed): </span>
                {projection.quarantine.reason}
              </div>
            </div>
          ) : null}

          {projection.hasUncertainEffects ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">
                  Uncertain external effect ({uncertainSummaries.length}):{' '}
                </span>
                {uncertainSummaries.join(' · ')} — mutation lane paused until reconciled.
              </div>
            </div>
          ) : null}

          {projection.hasPendingQuestions ? (
            <div className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning-text">
              <HelpCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">
                  Pending worker question ({pendingQuestions.length}):{' '}
                </span>
                {pendingQuestions.join(' · ')}
              </div>
            </div>
          ) : null}

          {projection.hasBlockers ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">Active blocker ({activeBlockers.length}): </span>
                {activeBlockers.join(' · ')}
              </div>
            </div>
          ) : null}

          {budgets.occupiedMutationLanes.length > 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0 text-status-warning" />
              <span>
                Occupied single-writer mutation lanes:{' '}
                <code className="font-mono text-foreground">
                  {budgets.occupiedMutationLanes
                    .map((lane) => `${lane.lane} (held by ${lane.holderChildName})`)
                    .join(', ')}
                </code>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Time, Spend, Concurrency, and Circuit-Breaker Limits Strip */}
      <div
        className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card/60 p-2.5 text-xs @md:grid-cols-3 @2xl:grid-cols-6"
        data-testid="coordinated-run-limits-strip"
      >
        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="size-3" />
            Wall-clock time
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
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <DollarSign className="size-3" />
            Spend ceiling
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
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Users className="size-3" />
            Concurrency
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-foreground">
            {budgets.activeConcurrency} / {budgets.maxConcurrency ?? '∞'} active
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-1.5">
          <div className="text-[10px] text-muted-foreground">Review loops</div>
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
          <div className="text-[10px] text-muted-foreground">Start failures</div>
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
          <div className="text-[10px] text-muted-foreground">Active fixers</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-foreground">
            {budgets.activeFixersCount} / {budgets.maxActiveFixersPerArtifact ?? '∞'}
          </div>
        </div>
      </div>
    </div>
  )
}
