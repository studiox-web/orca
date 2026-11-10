import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSearch,
  GitBranch,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle
} from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AutomationCoordinatedRunStageEvidence } from './AutomationCoordinatedRunStageEvidence'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import type {
  CoordinatedStageExecutionStatus,
  OccupiedMutationLaneObservation,
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

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

const STAGE_STATUS_META: Record<
  CoordinatedStageExecutionStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  unknown: { label: 'Unobserved', variant: 'outline', icon: Clock },
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
    variant: 'secondary',
    icon: Sparkles
  },
  waiting_for_approval: {
    label: 'Waiting for approval',
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
    label: 'Uncertain effect',
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
  const statusMeta = STAGE_STATUS_META[stage.stageExecutionStatus]
  const StatusIcon = statusMeta.icon
  const activeAttempt = stage.activeAttempt
  const openTargetKind = activeAttempt?.crewRow?.openTarget?.kind ?? null
  const agentId = stage.launchConfig.agentId ?? 'claude'
  const isLaneOccupied = Boolean(
    stage.mutationLane && occupiedMutationLanes.some((lane) => lane.lane === stage.mutationLane)
  )
  const pendingGateId =
    stage.gateResolutionEligibility.pendingGateId ?? stage.approvals[0]?.approvalId ?? null
  const showGateAction =
    stage.stageExecutionStatus === 'waiting_for_approval' || stage.approvals.length > 0

  return (
    <article
      id={`coordinated-run-stage-${stage.childDefinitionId}`}
      data-testid={`coordinated-run-stage-card-${stage.childDefinitionId}`}
      aria-label={`Stage ${stage.name} (${statusMeta.label})`}
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
                Renamed in current definition: {stage.currentDefinitionName}
              </Badge>
            ) : null}

            {stage.definitionDrift === 'tombstoned' ? (
              <Badge
                variant="outline"
                className="max-w-full whitespace-normal break-words"
                data-testid={`stage-drift-badge-${stage.childDefinitionId}`}
              >
                Removed in Rev {stage.tombstonedInRevision ?? 'later'} — preserved in snapshot
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
              aria-label={`View frozen snapshot for ${stage.name}`}
              title="Child worker was removed from the current editable definition; inspect its frozen run snapshot"
            >
              <FileSearch className="size-3" />
              Frozen definition
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
                  ? 'Definition navigation is unavailable in this view.'
                  : undefined
              }
              aria-label={`View definition for ${stage.name}`}
            >
              <FileSearch className="size-3" />
              View definition
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
                ? `Open live worker (${openTargetKind ?? 'attempt'})`
                : 'No dispatch attempt has started for this stage yet')
            }
            aria-label={`Open worker for ${stage.name}`}
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
            Open worker{openTargetKind ? ` (${openTargetKind})` : ''}
          </Button>
        </div>
      </div>

      {/* Explicit Technical vs Semantic Acceptance Separation Row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-secondary/20 px-2.5 py-1.5 text-[11px]">
        <span className="font-medium text-muted-foreground">State separation:</span>
        <Badge variant="outline" data-testid={`stage-technical-status-${stage.childDefinitionId}`}>
          Technical: {stage.technicalStatusLabel}
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
          Acceptance: {stage.semanticAcceptanceStatus}
        </Badge>

        {stage.activeAttempt?.technicalStatus === 'completed' &&
        stage.semanticAcceptanceStatus !== 'accepted' &&
        stage.semanticAcceptanceStatus !== 'waived' ? (
          <span className="text-[11px] text-status-warning-text">
            Worker finished technically, awaiting semantic acceptance
          </span>
        ) : null}
      </div>

      {/* Ownership, Task/Dispatch IDs, Agent/Model, Dependencies, and Mutation Lane */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Task: <code className="font-mono text-foreground">{stage.taskId ?? 'unmapped'}</code>
        </span>
        <span>
          Dispatch:{' '}
          <code className="font-mono text-foreground">{stage.activeDispatchId ?? 'none'}</code>
        </span>
        <span>
          Attempts:{' '}
          <strong className="font-medium text-foreground">
            {stage.attempts.length}
            {stage.supersededAttemptsCount > 0
              ? ` (${stage.supersededAttemptsCount} superseded)`
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
            Depends on: {stage.dependencies.map((d) => d.childId).join(', ')}
          </span>
        ) : (
          <span>Root stage</span>
        )}
        {stage.mutationLane ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]',
              isLaneOccupied
                ? 'bg-status-warning-background text-status-warning-text'
                : 'bg-secondary/60 text-muted-foreground'
            )}
          >
            <Lock className="size-2.5 shrink-0" />
            Lane: {stage.mutationLane}
            {isLaneOccupied ? ' (occupied)' : ''}
          </span>
        ) : null}
      </div>

      {/* Stage Evidence & Attempts */}
      <AutomationCoordinatedRunStageEvidence stage={stage} onOpenAttempt={onOpenAttempt} />

      {/* Run-Scoped Stage Operator Controls */}
      <div
        className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid={`retry-stage-btn-${stage.childDefinitionId}`}
            disabled={controlsDisabled}
            aria-busy={controlsDisabled}
            title={
              controlsDisabled
                ? 'Another run control request is already being submitted.'
                : (stage.retryEligibility.reason ??
                  `Retry stage ${stage.name} by reusing task ${stage.taskId}`)
            }
            onClick={() => onRequestControl?.({ kind: 'retry', stage })}
          >
            <RefreshCw className="size-3" />
            Retry stage
          </Button>

          {showGateAction && pendingGateId ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid={`resolve-gate-btn-${stage.childDefinitionId}`}
              disabled={controlsDisabled}
              aria-busy={controlsDisabled}
              title={
                controlsDisabled
                  ? 'Another run control request is already being submitted.'
                  : (stage.gateResolutionEligibility.reason ??
                    `Resolve approval gate ${pendingGateId} for ${stage.name}`)
              }
              onClick={() =>
                onRequestControl?.({
                  kind: 'resolve_gate',
                  stage,
                  gateId: pendingGateId
                })
              }
            >
              <ShieldCheck className="size-3" />
              Resolve gate ({pendingGateId})
            </Button>
          ) : null}
        </div>

        {!stage.retryEligibility.canRetry && stage.retryEligibility.reason ? (
          <span
            className="text-[11px] text-muted-foreground"
            data-testid={`retry-stage-reason-${stage.childDefinitionId}`}
          >
            {stage.retryEligibility.reason}
          </span>
        ) : null}
      </div>
    </article>
  )
}
