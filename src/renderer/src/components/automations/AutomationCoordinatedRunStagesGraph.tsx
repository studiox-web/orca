import React, { useMemo } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSearch,
  HelpCircle,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { CoordinatedAutomationChildDefinition } from '../../../../shared/coordinated-automation-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { computeWorkerGraphLayout } from './automation-workers-graph-layout'
import type {
  CoordinatedStageExecutionStatus,
  OccupiedMutationLaneObservation,
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

export type AutomationCoordinatedRunStagesGraphProps = {
  stages: readonly ProjectedCoordinatedStage[]
  occupiedMutationLanes?: readonly OccupiedMutationLaneObservation[]
  selectedStageId: string | null
  onSelectStage: (childDefinitionId: string) => void
  onInspectChildDefinition?: (childDefinitionId: string) => void
  onInspectFrozenSnapshot?: (childDefinitionId: string) => void
  onOpenAttempt: (attempt: ProjectedCoordinatedAttempt) => void
}

const STATUS_BADGE_STYLES: Record<
  CoordinatedStageExecutionStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  ready: {
    label: 'Ready',
    variant: 'outline',
    icon: Play
  },
  queued: {
    label: 'Queued',
    variant: 'outline',
    icon: Clock
  },
  active: {
    label: 'Active',
    variant: 'default',
    icon: Sparkles
  },
  waiting_for_approval: {
    label: 'Approval gate',
    variant: 'outline',
    icon: PauseCircle
  },
  blocked: {
    label: 'Blocked',
    variant: 'destructive',
    icon: AlertTriangle
  },
  accepted: {
    label: 'Accepted',
    variant: 'secondary',
    icon: CheckCircle2
  },
  superseded: {
    label: 'Superseded',
    variant: 'outline',
    icon: RefreshCw
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: XCircle
  },
  uncertain: {
    label: 'Uncertain',
    variant: 'destructive',
    icon: ShieldAlert
  },
  skipped: {
    label: 'Skipped',
    variant: 'outline',
    icon: Clock
  }
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
        No execution stages recorded in this run.
      </div>
    )
  }

  return (
    <div
      className="space-y-3"
      role="region"
      aria-label="Coordinated run execution stage graph"
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
                <div className="text-center text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Stage {layer.layerIndex + 1}
                </div>

                {layer.nodes.map((node) => {
                  const stage = stageByChildId.get(node.child.id)
                  if (!stage) {
                    return null
                  }
                  const statusMeta = STATUS_BADGE_STYLES[stage.stageExecutionStatus]
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
                      role="button"
                      tabIndex={0}
                      data-testid={`coordinated-run-graph-node-${stage.childDefinitionId}`}
                      aria-pressed={isSelected}
                      aria-label={`Stage ${stage.name}, status ${statusMeta.label}, technical ${stage.technicalStatusLabel}, acceptance ${stage.semanticAcceptanceStatus}`}
                      onClick={() => onSelectStage(stage.childDefinitionId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectStage(stage.childDefinitionId)
                        }
                      }}
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

                      <div className="mt-1.5 truncate text-xs font-semibold text-foreground">
                        {stage.name}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {stage.taskId ?? 'unmapped'} · {stage.activeDispatchId ?? 'no-dispatch'}
                      </div>

                      {stage.definitionDrift !== 'unchanged' ? (
                        <div className="mt-1 truncate text-[10px] text-status-warning-text">
                          {stage.definitionDrift === 'tombstoned'
                            ? 'Removed in current definition'
                            : `Renamed: ${stage.currentDefinitionName}`}
                        </div>
                      ) : null}

                      {/* Separate Technical vs Semantic Acceptance pills */}
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 font-mono text-muted-foreground">
                          Tech: {stage.technicalStatusLabel}
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
                          Acc: {stage.semanticAcceptanceStatus}
                        </span>
                      </div>

                      {/* Evidence & hazard indicators */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>Attempts: {stage.attempts.length}</span>
                        {stage.artifacts.length > 0 ? (
                          <span>· Artifacts: {stage.artifacts.length}</span>
                        ) : null}
                        {stage.pendingQuestion ? (
                          <span className="inline-flex items-center gap-0.5 text-status-warning-text">
                            <HelpCircle className="size-3" />
                            Question
                          </span>
                        ) : null}
                        {stage.hasUncertainEffect ? (
                          <span className="inline-flex items-center gap-0.5 text-destructive">
                            <ShieldAlert className="size-3" />
                            Uncertain
                          </span>
                        ) : null}
                        {isLaneOccupied ? (
                          <span className="inline-flex items-center gap-0.5 text-status-warning-text">
                            <Lock className="size-3" />
                            Lane busy
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
                          onClick={() => {
                            if (stage.definitionDrift === 'tombstoned') {
                              onInspectFrozenSnapshot?.(stage.childDefinitionId)
                            } else {
                              onInspectChildDefinition?.(stage.childDefinitionId)
                            }
                          }}
                        >
                          <FileSearch className="size-3" />
                          {stage.definitionDrift === 'tombstoned' ? 'Snapshot' : 'Definition'}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={!activeAttempt || !activeAttempt.canOpenWorker}
                          title={
                            activeAttempt?.openWorkerUnavailableReason ??
                            'No active dispatch attempt'
                          }
                          onClick={() => {
                            if (activeAttempt) {
                              onOpenAttempt(activeAttempt)
                            }
                          }}
                        >
                          <ExternalLink className="size-3" />
                          Open worker
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
