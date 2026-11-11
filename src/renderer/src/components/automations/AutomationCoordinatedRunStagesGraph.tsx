import { graphStageStatusMetadata } from './coordinated-stage-graph-status'
import React, { useMemo } from 'react'
import { ArrowRight, ExternalLink, FileSearch, HelpCircle, Lock, ShieldAlert } from 'lucide-react'
import type { CoordinatedAutomationChildDefinition } from '../../../../shared/coordinated-automation-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { computeWorkerGraphLayout } from './automation-workers-graph-layout'
import type {
  OccupiedMutationLaneObservation,
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'
import { translate } from '@/i18n/i18n'

export type AutomationCoordinatedRunStagesGraphProps = {
  stages: readonly ProjectedCoordinatedStage[]
  occupiedMutationLanes?: readonly OccupiedMutationLaneObservation[]
  selectedStageId: string | null
  onSelectStage: (childDefinitionId: string) => void
  onInspectChildDefinition?: (childDefinitionId: string) => void
  onInspectFrozenSnapshot?: (childDefinitionId: string) => void
  onOpenAttempt: (attempt: ProjectedCoordinatedAttempt) => void
}

const EMPTY_OCCUPIED_LANES: readonly OccupiedMutationLaneObservation[] = []

export function AutomationCoordinatedRunStagesGraph({
  stages,
  occupiedMutationLanes = EMPTY_OCCUPIED_LANES,
  selectedStageId,
  onSelectStage,
  onInspectChildDefinition,
  onInspectFrozenSnapshot,
  onOpenAttempt
}: AutomationCoordinatedRunStagesGraphProps): React.JSX.Element {
  const stageByChildId = useMemo(() => {
    const map = new Map<string, ProjectedCoordinatedStage>()
    for (const stage of stages) {
      map.set(stage.childDefinitionId, stage)
    }
    return map
  }, [stages])

  const layout = useMemo(() => {
    const syntheticChildren: CoordinatedAutomationChildDefinition[] = stages.map((stage) => ({
      id: stage.childDefinitionId,
      name: stage.name,
      role: stage.role,
      promptSource: { kind: 'inline', text: stage.promptSummary?.text ?? '' },
      dependencies: [...stage.dependencies],
      mutationClass: stage.mutationClass,
      mutationLane: stage.mutationLane ?? undefined,
      launchConfig: stage.launchConfig,
      enabled: stage.enabledInSnapshot
    }))
    return computeWorkerGraphLayout(syntheticChildren)
  }, [stages])

  if (stages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.automations.AutomationCoordinatedRunStagesGraph.e2a04c28fc',
          'No execution stages recorded in this run.'
        )}
      </div>
    )
  }

  return (
    <div
      className="space-y-3"
      role="region"
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.c2e942c6c7',
        'Coordinated run execution stage graph'
      )}
      data-testid="coordinated-run-stages-graph"
    >
      <div className="overflow-x-auto rounded-lg border border-border bg-card/40 p-4">
        <div className="flex min-w-max items-stretch gap-3">
          {layout.layers.map((layer, idx) => (
            <React.Fragment key={layer.layerIndex}>
              {idx > 0 ? (
                <div className="flex items-center justify-center px-0.5 text-muted-foreground/60">
                  <ArrowRight className="size-4 shrink-0" />
                </div>
              ) : null}

              <div className="flex flex-col justify-center gap-3">
                <div className="text-center text-3xs font-medium tracking-wider text-muted-foreground uppercase">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunStagesGraph.508f0b82cf',
                    'Stage'
                  )}{' '}
                  {layer.layerIndex + 1}
                </div>

                {layer.nodes.map((node) => {
                  const stage = stageByChildId.get(node.child.id)
                  if (!stage) {
                    return null
                  }
                  const statusMeta = graphStageStatusMetadata()[stage.stageExecutionStatus]
                  const StatusIcon = statusMeta.icon
                  const isSelected = selectedStageId === stage.childDefinitionId
                  const activeAttempt = stage.activeAttempt
                  const isLaneOccupied = Boolean(
                    stage.mutationLane &&
                    occupiedMutationLanes.some((lane) => lane.lane === stage.mutationLane)
                  )

                  return (
                    <div
                      key={stage.childDefinitionId}
                      role="group"
                      data-testid={`coordinated-run-graph-node-${stage.childDefinitionId}`}
                      data-current={isSelected}
                      aria-label={translate(
                        'auto.components.automations.AutomationCoordinatedRunStagesGraph.stageSummaryAria',
                        'Stage {{value0}}, status {{value1}}, technical {{value2}}, acceptance {{value3}}',
                        {
                          value0: stage.name,
                          value1: statusMeta.label,
                          value2: stage.technicalStatusLabel,
                          value3: stage.semanticAcceptanceStatus
                        }
                      )}
                      className={cn(
                        'w-64 rounded-lg border bg-card p-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        isSelected
                          ? 'border-ring bg-accent/30 ring-1 ring-ring/30'
                          : 'border-border hover:border-ring/50 hover:bg-accent/15'
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <Badge variant={statusMeta.variant}>
                          <StatusIcon className="size-3 shrink-0" />
                          {statusMeta.label}
                        </Badge>
                        <Badge variant="secondary">{stage.role}</Badge>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="mt-1.5 max-w-full justify-start text-left whitespace-normal"
                        aria-label={translate(
                          'auto.components.automations.AutomationCoordinatedRunStagesGraph.acf2696545',
                          'Select stage {{value0}} ({{value1}})',
                          { value0: stage.name, value1: stage.childDefinitionId }
                        )}
                        aria-pressed={isSelected}
                        onClick={() => onSelectStage(stage.childDefinitionId)}
                      >
                        {stage.name}
                      </Button>
                      <div className="truncate font-mono text-3xs text-muted-foreground">
                        {stage.taskId ??
                          translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.ac89d05c88',
                            'unmapped'
                          )}{' '}
                        ·{' '}
                        {stage.activeDispatchId ??
                          translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.d842cf2baa',
                            'no-dispatch'
                          )}
                      </div>

                      {stage.definitionDrift !== 'unchanged' ? (
                        <div className="mt-1 truncate text-3xs text-status-warning-text">
                          {stage.definitionDrift === 'tombstoned'
                            ? translate(
                                'auto.components.automations.AutomationCoordinatedRunStagesGraph.1e7610785f',
                                'Removed in current definition'
                              )
                            : translate(
                                'auto.components.automations.AutomationCoordinatedRunStagesGraph.9f149c94ca',
                                'Renamed: {{value0}}',
                                { value0: stage.currentDefinitionName }
                              )}
                        </div>
                      ) : null}

                      {/* Separate Technical vs Semantic Acceptance pills */}
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-3xs">
                        <span className="rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 font-mono text-muted-foreground">
                          {translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.ed9835a021',
                            'Tech:'
                          )}{' '}
                          {stage.technicalStatusLabel}
                        </span>
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 font-mono',
                            stage.semanticAcceptanceStatus === 'accepted' ||
                              stage.semanticAcceptanceStatus === 'waived'
                              ? 'border-status-success-border bg-status-success-background text-status-success'
                              : stage.semanticAcceptanceStatus === 'rejected' ||
                                  stage.semanticAcceptanceStatus === 'revision_requested'
                                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                : 'border-status-warning-border bg-status-warning-background text-status-warning-text'
                          )}
                        >
                          {translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.8eacb7beb3',
                            'Acc:'
                          )}{' '}
                          {stage.semanticAcceptanceStatus}
                        </span>
                      </div>

                      {/* Evidence & hazard indicators */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-3xs text-muted-foreground">
                        <span>
                          {translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.536affbcf4',
                            'Attempts:'
                          )}{' '}
                          {stage.attempts.length}
                        </span>
                        {stage.artifacts.length > 0 ? (
                          <span>
                            {translate(
                              'auto.components.automations.AutomationCoordinatedRunStagesGraph.bb00568229',
                              '· Artifacts:'
                            )}{' '}
                            {stage.artifacts.length}
                          </span>
                        ) : null}
                        {stage.pendingQuestion ? (
                          <span className="inline-flex items-center gap-0.5 text-status-warning-text">
                            <HelpCircle className="size-3" />
                            {translate(
                              'auto.components.automations.AutomationCoordinatedRunStagesGraph.f2ef8a4079',
                              'Question'
                            )}
                          </span>
                        ) : null}
                        {stage.hasUncertainEffect ? (
                          <span className="inline-flex items-center gap-0.5 text-destructive">
                            <ShieldAlert className="size-3" />
                            {translate(
                              'auto.components.automations.AutomationCoordinatedRunStagesGraph.52b371bc7c',
                              'Uncertain'
                            )}
                          </span>
                        ) : null}
                        {isLaneOccupied ? (
                          <span className="inline-flex items-center gap-0.5 text-status-warning-text">
                            <Lock className="size-3" />
                            {translate(
                              'auto.components.automations.AutomationCoordinatedRunStagesGraph.d0d15572b8',
                              'Lane busy'
                            )}
                          </span>
                        ) : null}
                      </div>

                      {/* Node quick actions */}
                      <div
                        className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-border/50 pt-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            stage.definitionDrift === 'tombstoned'
                              ? !onInspectFrozenSnapshot
                              : !onInspectChildDefinition
                          }
                          title={
                            stage.definitionDrift !== 'tombstoned' && !onInspectChildDefinition
                              ? translate(
                                  'auto.components.automations.AutomationCoordinatedRunStagesGraph.d63c27646f',
                                  'Definition navigation is unavailable in this view.'
                                )
                              : undefined
                          }
                          onClick={() => {
                            if (stage.definitionDrift === 'tombstoned') {
                              onInspectFrozenSnapshot?.(stage.childDefinitionId)
                            } else {
                              onInspectChildDefinition?.(stage.childDefinitionId)
                            }
                          }}
                        >
                          <FileSearch className="size-3" />
                          {stage.definitionDrift === 'tombstoned'
                            ? translate(
                                'auto.components.automations.AutomationCoordinatedRunStagesGraph.7da14efceb',
                                'Snapshot'
                              )
                            : translate(
                                'auto.components.automations.AutomationCoordinatedRunStagesGraph.7231e3266d',
                                'Definition'
                              )}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={!activeAttempt || !activeAttempt.canOpenWorker}
                          title={
                            activeAttempt?.openWorkerUnavailableReason ??
                            translate(
                              'auto.components.automations.AutomationCoordinatedRunStagesGraph.7c091be3f6',
                              'No active dispatch attempt'
                            )
                          }
                          onClick={() => {
                            if (activeAttempt) {
                              onOpenAttempt(activeAttempt)
                            }
                          }}
                        >
                          <ExternalLink className="size-3" />
                          {translate(
                            'auto.components.automations.AutomationCoordinatedRunStagesGraph.1000809b96',
                            'Open worker'
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
