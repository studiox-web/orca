import { AutomationCoordinatedRunLimits } from './AutomationCoordinatedRunLimits'
import { parentSemanticMetadata } from './coordinated-run-status-metadata'
import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Folder,
  GitBranch,
  HelpCircle,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  Square
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatUiAutomationSchedule } from './automation-schedule-label'
import type { ProjectedCoordinatedRun } from './coordinated-automation-run-projection'
import { translate } from '@/i18n/i18n'

export type AutomationCoordinatedRunHeaderAndLimitsProps = {
  projection: ProjectedCoordinatedRun
  isStopPending?: boolean
  onRequestStopRun?: () => void
  onInspectReceipt?: () => void
}

export function AutomationCoordinatedRunHeaderAndLimits({
  projection,
  isStopPending = false,
  onRequestStopRun,
  onInspectReceipt
}: AutomationCoordinatedRunHeaderAndLimitsProps): React.JSX.Element {
  const semanticMeta = parentSemanticMetadata()[projection.semanticOutcomeState]
  const SemanticIcon = semanticMeta.icon
  const budgets = projection.budgetsAndCeilings
  const scheduleLabel = formatUiAutomationSchedule(
    projection.scheduleState.rrule,
    projection.scheduleState.triggerPolicy
  )
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
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.352746f60d',
                  'Technical:'
                )}{' '}
                {projection.technicalRunStatus}
              </Badge>

              {projection.materializationPhase ? (
                <Badge variant="outline">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.9ade5a8d49',
                    'Phase:'
                  )}{' '}
                  {projection.materializationPhase}
                </Badge>
              ) : null}

              <Badge variant="secondary">
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.8caa088029',
                  'Frozen Rev'
                )}{' '}
                {projection.definitionRevision}
              </Badge>

              {projection.replanOfAutomationRunId ? (
                <Badge variant="outline">
                  <RefreshCw className="size-2.5" />
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.d22364cc75',
                    'Replanned from'
                  )}{' '}
                  {projection.replanOfAutomationRunId}
                </Badge>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">{projection.semanticOutcomeReason}</p>
            {projection.outcomeContract?.humanStatement ? (
              <p className="text-2xs font-medium text-foreground">
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.740469cb62',
                  'Outcome contract:'
                )}{' '}
                {projection.outcomeContract.humanStatement}
              </p>
            ) : null}
          </div>

          {/* Parent Run Controls: Inspect Receipt & Stop Run */}
          <div className="flex flex-wrap items-center gap-1.5">
            {projection.completionReceipt && onInspectReceipt ? (
              <Button type="button" variant="outline" size="xs" onClick={onInspectReceipt}>
                <CheckCircle2 className="size-3.5 text-status-success" />
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.44f9566e21',
                  'Inspect receipt'
                )}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="stop-coordinated-run-btn"
              disabled={isStopPending}
              aria-busy={isStopPending}
              title={
                isStopPending
                  ? translate(
                      'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.3c352a0915',
                      'A stop request for this run is already being submitted.'
                    )
                  : (projection.stopEligibility.reason ??
                    translate(
                      'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.1b2d430950',
                      'Stop coordinated run {{value0}}',
                      { value0: projection.automationRunId }
                    ))
              }
              onClick={onRequestStopRun}
            >
              <Square className="size-3" />
              {isStopPending
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.07069a2bdc',
                    'Submitting stop…'
                  )
                : translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.6df79099a5',
                    'Stop run'
                  )}
            </Button>
          </div>
        </div>

        {/* 5 Independent State Facets Strip: Run ID, Authority/Host, Workspace, Lifecycle, Schedule */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
          <span>
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.06f737f0de',
              'Run:'
            )}{' '}
            <code className="font-mono text-foreground">{projection.automationRunId}</code>
          </span>
          {projection.orchestrationRunId ? (
            <span>
              {translate(
                'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.5ca0e8c9e5',
                'Orch:'
              )}{' '}
              <code className="font-mono text-foreground">{projection.orchestrationRunId}</code>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Server className="size-3 shrink-0" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.d12923b0f7',
              'Authority:'
            )}{' '}
            <code className="font-mono text-foreground">{projection.targetExecutionAuthority}</code>{' '}
            ({projection.hostLabel})
            {projection.isRemoteAuthority
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.45d420c76e',
                  '[Remote]'
                )
              : ''}
          </span>
          <span className="inline-flex items-center gap-1">
            {projection.isFolderWorkspace ? (
              <Folder className="size-3 shrink-0" />
            ) : (
              <GitBranch className="size-3 shrink-0" />
            )}
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.0647e32707',
              'Workspace:'
            )}{' '}
            <strong className="font-medium text-foreground">{projection.workspaceLabel}</strong>
            {projection.isFolderWorkspace
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.5bfbfd31e4',
                  '(Folder workspace)'
                )
              : ''}
          </span>
          <span>
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.470ff1d61c',
              'Lifecycle:'
            )}{' '}
            <strong className="font-medium text-foreground">{projection.lifecycleState}</strong>
          </span>
          <span>
            {translate(
              'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.1581386b57',
              'Schedule:'
            )}{' '}
            <strong className="font-medium text-foreground">{scheduleLabel}</strong>
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
                <span className="font-semibold">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.1884adee93',
                    'Run quarantined (fail-closed):'
                  )}{' '}
                </span>
                {projection.quarantine.reason}
              </div>
            </div>
          ) : null}

          {projection.hasUncertainEffects ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.faef94bbf1',
                    'Uncertain external effect ('
                  )}
                  {uncertainSummaries.length}):{' '}
                </span>
                {uncertainSummaries.join(' · ')}{' '}
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.5a5b42247f',
                  '— mutation lane paused until reconciled.'
                )}
              </div>
            </div>
          ) : null}

          {projection.hasPendingQuestions ? (
            <div className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning-text">
              <HelpCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.e40fd58de1',
                    'Pending worker question ('
                  )}
                  {pendingQuestions.length}):{' '}
                </span>
                {pendingQuestions.join(' · ')}
              </div>
            </div>
          ) : null}

          {projection.hasBlockers ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.eab17dc506',
                    'Active blocker ('
                  )}
                  {activeBlockers.length}):{' '}
                </span>
                {activeBlockers.join(' · ')}
              </div>
            </div>
          ) : null}

          {budgets.occupiedMutationLanes.length > 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0 text-status-warning" />
              <span>
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.30e805af8f',
                  'Occupied single-writer mutation lanes:'
                )}{' '}
                <code className="font-mono text-foreground">
                  {budgets.occupiedMutationLanes
                    .map((lane) =>
                      translate(
                        'auto.components.automations.coordinatedLabels.heldLane',
                        '{{lane}} (held by {{holder}})',
                        { lane: lane.lane, holder: lane.holderChildName }
                      )
                    )
                    .join(', ')}
                </code>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <AutomationCoordinatedRunLimits budgets={budgets} />
    </div>
  )
}
