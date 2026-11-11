import { AutomationCoordinatedStageActions } from './AutomationCoordinatedStageActions'
import { stageStatusMetadata } from './coordinated-run-status-metadata'
import React from 'react'
import { ExternalLink, FileSearch, GitBranch, Lock, Terminal } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AutomationCoordinatedRunStageEvidence } from './AutomationCoordinatedRunStageEvidence'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import type {
  OccupiedMutationLaneObservation,
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'
import { translate } from '@/i18n/i18n'

export type AutomationCoordinatedRunStageCardProps = {
  stage: ProjectedCoordinatedStage
  occupiedMutationLanes?: readonly OccupiedMutationLaneObservation[]
  isSelected?: boolean
  controlsDisabled?: boolean
  onSelectStage?: (childDefinitionId: string) => void
  onInspectChildDefinition?: (childDefinitionId: string) => void
  onInspectFrozenSnapshot?: (childDefinitionId: string) => void
  onOpenAttempt: (attempt: ProjectedCoordinatedAttempt) => void
  onRequestControl?: (request: RunControlActionRequest) => void
}

const EMPTY_OCCUPIED_LANES: readonly OccupiedMutationLaneObservation[] = []

export function AutomationCoordinatedRunStageCard({
  stage,
  occupiedMutationLanes = EMPTY_OCCUPIED_LANES,
  isSelected = false,
  controlsDisabled = false,
  onSelectStage,
  onInspectChildDefinition,
  onInspectFrozenSnapshot,
  onOpenAttempt,
  onRequestControl
}: AutomationCoordinatedRunStageCardProps): React.JSX.Element {
  const statusMeta = stageStatusMetadata()[stage.stageExecutionStatus]
  const StatusIcon = statusMeta.icon
  const activeAttempt = stage.activeAttempt
  const openTargetKind = activeAttempt?.crewRow?.openTarget?.kind ?? null
  const agentId = stage.launchConfig.agentId ?? 'claude'
  const isLaneOccupied = Boolean(
    stage.mutationLane && occupiedMutationLanes.some((lane) => lane.lane === stage.mutationLane)
  )

  return (
    <article
      id={`coordinated-run-stage-${stage.childDefinitionId}`}
      data-testid={`coordinated-run-stage-card-${stage.childDefinitionId}`}
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.2f652047ff',
        'Stage {{value0}} ({{value1}})',
        { value0: stage.name, value1: statusMeta.label }
      )}
      onClick={() => onSelectStage?.(stage.childDefinitionId)}
      className={cn(
        '@container rounded-lg border bg-card p-3 transition-colors duration-150',
        isSelected ? 'border-ring ring-1 ring-ring/30' : 'border-border hover:border-ring/40'
      )}
    >
      {/* Top Row: Status, Role, Frozen Name, Drift Badge, and Primary Navigation */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={statusMeta.variant}>
              <StatusIcon className="size-3 shrink-0" />
              {statusMeta.label}
            </Badge>
            <Badge variant="secondary">{stage.role}</Badge>
            <span className="text-xs font-semibold text-foreground">{stage.name}</span>
            <span className="break-all font-mono text-2xs text-muted-foreground">
              ({stage.childDefinitionId})
            </span>

            {stage.definitionDrift === 'renamed' && stage.currentDefinitionName ? (
              <Badge
                variant="outline"
                className="max-w-full whitespace-normal break-words"
                data-testid={`stage-drift-badge-${stage.childDefinitionId}`}
              >
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.7cddae7cec',
                  'Renamed in current definition:'
                )}{' '}
                {stage.currentDefinitionName}
              </Badge>
            ) : null}

            {stage.definitionDrift === 'tombstoned' ? (
              <Badge
                variant="outline"
                className="max-w-full whitespace-normal break-words"
                data-testid={`stage-drift-badge-${stage.childDefinitionId}`}
              >
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.bed812ad72',
                  'Removed in Rev'
                )}{' '}
                {stage.tombstonedInRevision ??
                  translate(
                    'auto.components.automations.AutomationCoordinatedRunStageCard.2c170c5025',
                    'later'
                  )}{' '}
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.ab58e23d57',
                  '— preserved in snapshot'
                )}
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Navigation Actions: View Definition vs Open Worker */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          {stage.definitionDrift === 'tombstoned' ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onInspectFrozenSnapshot?.(stage.childDefinitionId)}
              aria-label={translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.14381ff777',
                'View frozen snapshot for {{value0}}',
                { value0: stage.name }
              )}
              title={translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.a5ebb6f06e',
                'Child worker was removed from the current editable definition; inspect its frozen run snapshot'
              )}
            >
              <FileSearch className="size-3" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.f31ffeb05d',
                'Frozen definition'
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onInspectChildDefinition?.(stage.childDefinitionId)}
              disabled={!onInspectChildDefinition}
              title={
                !onInspectChildDefinition
                  ? translate(
                      'auto.components.automations.AutomationCoordinatedRunStageCard.c3ed463525',
                      'Definition navigation is unavailable in this view.'
                    )
                  : undefined
              }
              aria-label={translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.0ab7f03c54',
                'View definition for {{value0}}',
                { value0: stage.name }
              )}
            >
              <FileSearch className="size-3" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.605957edf3',
                'View definition'
              )}
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={!activeAttempt || !activeAttempt.canOpenWorker}
            title={
              activeAttempt?.openWorkerUnavailableReason ??
              (activeAttempt
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunStageCard.8d8e13d28e',
                    'Open live worker ({{value0}})',
                    { value0: openTargetKind ?? 'attempt' }
                  )
                : translate(
                    'auto.components.automations.AutomationCoordinatedRunStageCard.8a5f3c42a8',
                    'No dispatch attempt has started for this stage yet'
                  ))
            }
            aria-label={translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.1e3b4ff74e',
              'Open worker for {{value0}}',
              { value0: stage.name }
            )}
            data-testid={`open-stage-worker-${stage.childDefinitionId}`}
            onClick={() => {
              if (activeAttempt) {
                onOpenAttempt(activeAttempt)
              }
            }}
          >
            {openTargetKind === 'terminal' ? (
              <Terminal className="size-3" />
            ) : (
              <ExternalLink className="size-3" />
            )}
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.71afa8d36c',
              'Open worker'
            )}
            {openTargetKind ? ` (${openTargetKind})` : ''}
          </Button>
        </div>
      </div>

      {/* Explicit Technical vs Semantic Acceptance Separation Row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-secondary/20 px-2.5 py-1.5 text-2xs">
        <span className="font-medium text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.1a6b175731',
            'State separation:'
          )}
        </span>
        <Badge variant="outline" data-testid={`stage-technical-status-${stage.childDefinitionId}`}>
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.2bb072deb1',
            'Technical:'
          )}{' '}
          {stage.technicalStatusLabel}
        </Badge>
        <Badge
          variant={
            stage.semanticAcceptanceStatus === 'accepted' ||
            stage.semanticAcceptanceStatus === 'waived'
              ? 'secondary'
              : stage.semanticAcceptanceStatus === 'rejected' ||
                  stage.semanticAcceptanceStatus === 'revision_requested'
                ? 'destructive'
                : 'outline'
          }
          data-testid={`stage-semantic-acceptance-${stage.childDefinitionId}`}
        >
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.da033880fe',
            'Acceptance:'
          )}{' '}
          {stage.semanticAcceptanceStatus}
        </Badge>

        {stage.activeAttempt?.technicalStatus === 'completed' &&
        stage.semanticAcceptanceStatus !== 'accepted' &&
        stage.semanticAcceptanceStatus !== 'waived' ? (
          <span className="text-2xs text-status-warning-text">
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.66ba9b61dd',
              'Worker finished technically, awaiting semantic acceptance'
            )}
          </span>
        ) : null}
      </div>

      {/* Ownership, Task/Dispatch IDs, Agent/Model, Dependencies, and Mutation Lane */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.04f144d452',
            'Task:'
          )}{' '}
          <code className="font-mono text-foreground">
            {stage.taskId ??
              translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.f5142de6f7',
                'unmapped'
              )}
          </code>
        </span>
        <span>
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.951154c7e4',
            'Dispatch:'
          )}{' '}
          <code className="font-mono text-foreground">
            {stage.activeDispatchId ??
              translate(
                'auto.components.automations.AutomationCoordinatedRunStageCard.e91da88207',
                'none'
              )}
          </code>
        </span>
        <span>
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.2192a7c28b',
            'Attempts:'
          )}{' '}
          <strong className="font-medium text-foreground">
            {stage.attempts.length}
            {stage.supersededAttemptsCount > 0
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.c1b58b8bd7',
                  ' ({{value0}} superseded)',
                  { value0: stage.supersededAttemptsCount }
                )
              : ''}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <AgentIcon agent={agentId} size={12} />
          <strong className="font-medium text-foreground">{agentId}</strong>
          {stage.launchConfig.model ? ` (${stage.launchConfig.model})` : ''}
        </span>
        {stage.dependencies.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3 shrink-0" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.602490968f',
              'Depends on:'
            )}{' '}
            {stage.dependencies.map((d) => d.childId).join(', ')}
          </span>
        ) : (
          <span>
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.1a688040bc',
              'Root stage'
            )}
          </span>
        )}
        {stage.mutationLane ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-3xs',
              isLaneOccupied
                ? 'bg-status-warning-background text-status-warning-text'
                : 'bg-secondary/60 text-muted-foreground'
            )}
          >
            <Lock className="size-2.5 shrink-0" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.cff107be88',
              'Lane:'
            )}{' '}
            {stage.mutationLane}
            {isLaneOccupied
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.8e2fc2409e',
                  '(occupied)'
                )
              : ''}
          </span>
        ) : null}
      </div>

      {/* Stage Evidence & Attempts */}
      <AutomationCoordinatedRunStageEvidence stage={stage} onOpenAttempt={onOpenAttempt} />

      <AutomationCoordinatedStageActions
        stage={stage}
        controlsDisabled={controlsDisabled}
        onRequestControl={onRequestControl}
      />
    </article>
  )
}
