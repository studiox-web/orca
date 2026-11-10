import React, { useMemo, useState } from 'react'
import { FileCheck2, GitFork, History, List } from 'lucide-react'
import {
  isCoordinatedAutomation,
  type Automation,
  type AutomationRun
} from '../../../../shared/automations-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { openOrchestrationCrewAgent } from '@/lib/open-agent-message-sender'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AutomationCompletionReceiptInspector } from './AutomationCompletionReceiptInspector'
import { AutomationCoordinatedRunHeaderAndLimits } from './AutomationCoordinatedRunHeaderAndLimits'
import { AutomationCoordinatedRunStageCard } from './AutomationCoordinatedRunStageCard'
import { AutomationCoordinatedRunStagesGraph } from './AutomationCoordinatedRunStagesGraph'
import { AutomationHistoricalSnapshotViewer } from './AutomationHistoricalSnapshotViewer'
import {
  AutomationRunControlImpactDialog,
  type RunControlActionRequest
} from './AutomationRunControlImpactDialog'
import { withWorkerOpenUnbound } from './coordinated-automation-attempt-projection'
import {
  projectCoordinatedAutomationRun,
  type CoordinatedRunLiveObservation,
  type CoordinatedRunOperatorActions,
  type ProjectedCoordinatedAttempt,
  type ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

export type CoordinatedRunPanelViewMode = 'list' | 'graph' | 'receipt' | 'snapshot'

const EMPTY_RUNS: AutomationRun[] = []

export type AutomationCoordinatedRunPanelProps = {
  automation: Automation
  run?: AutomationRun | null
  runs?: AutomationRun[]
  selectedRunId?: string | null
  onSelectRunId?: (runId: string) => void
  observation?: CoordinatedRunLiveObservation | null
  observationByRunId?: Readonly<Record<string, CoordinatedRunLiveObservation>>
  operatorActions?: CoordinatedRunOperatorActions | null
  runtimeTarget?: RuntimeClientTarget
  hostLabel?: string | null
  workspaceLabel?: string | null
  isFolderWorkspace?: boolean
  isFeatureFlagEnabled?: boolean
  now?: number
  defaultViewMode?: CoordinatedRunPanelViewMode
  onInspectChildDefinition?: (childDefinitionId: string) => void
  onOpenWorkerAttempt?: (attempt: ProjectedCoordinatedAttempt) => void | Promise<boolean>
}

export function AutomationCoordinatedRunPanel({
  automation,
  run,
  runs = EMPTY_RUNS,
  selectedRunId,
  onSelectRunId,
  observation,
  observationByRunId,
  operatorActions,
  runtimeTarget,
  hostLabel,
  workspaceLabel,
  isFolderWorkspace,
  // Why: fail closed. Callers must pass the persisted experimental flag; a
  // missing prop must never present coordinated controls as enabled.
  isFeatureFlagEnabled = false,
  now,
  defaultViewMode = 'list',
  onInspectChildDefinition,
  onOpenWorkerAttempt
}: AutomationCoordinatedRunPanelProps): React.JSX.Element | null {
  const candidateRuns = useMemo(() => {
    if (run) {
      return run.automationId === automation.id ? [run] : []
    }
    return runs.filter(
      (candidate) =>
        candidate.automationId === automation.id &&
        (Boolean(candidate.resolvedSnapshot) ||
          Boolean(candidate.completionReceipt) ||
          Boolean(candidate.materializationPhase) ||
          Boolean(candidate.coordinatedQuarantine) ||
          Boolean(candidate.retainedEvidence) ||
          isCoordinatedAutomation(automation))
    )
  }, [automation, run, runs])

  const [internalRunId, setInternalRunId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<CoordinatedRunPanelViewMode>(defaultViewMode)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [controlRequest, setControlRequest] = useState<RunControlActionRequest | null>(null)

  const activeRunId = selectedRunId ?? internalRunId ?? candidateRuns[0]?.id ?? null
  const activeRun = useMemo(
    () => candidateRuns.find((candidate) => candidate.id === activeRunId) ?? null,
    [activeRunId, candidateRuns]
  )

  const activeObservation = useMemo(() => {
    if (!activeRun) {
      return undefined
    }
    return observation ?? observationByRunId?.[activeRun.id] ?? null
  }, [activeRun, observation, observationByRunId])

  const rawProjection = useMemo(() => {
    if (!activeRun) {
      return null
    }
    return projectCoordinatedAutomationRun({
      automation,
      run: activeRun,
      observation: activeObservation,
      operatorActions,
      options: {
        hostLabel,
        workspaceLabel,
        isFolderWorkspace,
        isFeatureFlagEnabled,
        now
      }
    })
  }, [
    activeObservation,
    activeRun,
    automation,
    hostLabel,
    isFeatureFlagEnabled,
    isFolderWorkspace,
    now,
    operatorActions,
    workspaceLabel
  ])

  // Why: an attempt is only openable when the caller supplies the authority
  // that owns it (local, SSH, or remote runtime). Guessing a local target
  // would open the wrong host for remote-authority runs.
  const canBindWorkerOpen = Boolean(onOpenWorkerAttempt || runtimeTarget)
  const projection = useMemo(
    () =>
      rawProjection && !canBindWorkerOpen ? withWorkerOpenUnbound(rawProjection) : rawProjection,
    [canBindWorkerOpen, rawProjection]
  )

  if (!activeRun || !projection) {
    return null
  }

  const effectiveSelectedStageId =
    selectedStageId &&
    projection.stages.some((stage) => stage.childDefinitionId === selectedStageId)
      ? selectedStageId
      : (projection.stages[0]?.childDefinitionId ?? null)

  const selectedStage =
    projection.stages.find((stage) => stage.childDefinitionId === effectiveSelectedStageId) ?? null

  const handleOpenAttempt = (attempt: ProjectedCoordinatedAttempt): void => {
    if (onOpenWorkerAttempt) {
      void onOpenWorkerAttempt(attempt)
      return
    }
    if (attempt.crewRow && attempt.canOpenWorker && runtimeTarget) {
      void openOrchestrationCrewAgent(attempt.crewRow, runtimeTarget)
    }
  }

  const handleConfirmStop = (): void => {
    if (!projection.stopEligibility.canStop || !operatorActions?.stopRun?.onStopRun) {
      return
    }
    void operatorActions.stopRun.onStopRun({
      automationId: projection.automationId,
      automationRunId: projection.automationRunId,
      orchestrationRunId: projection.orchestrationRunId,
      definitionRevision: projection.definitionRevision,
      targetExecutionAuthority: projection.targetExecutionAuthority
    })
  }

  const handleConfirmRetry = (stage: ProjectedCoordinatedStage): void => {
    if (
      !stage.retryEligibility.canRetry ||
      !stage.taskId ||
      !stage.retryEligibility.retryOfDispatchId ||
      !projection.orchestrationRunId ||
      !operatorActions?.retryStage?.onRetryStage
    ) {
      return
    }
    void operatorActions.retryStage.onRetryStage({
      automationId: projection.automationId,
      automationRunId: projection.automationRunId,
      orchestrationRunId: projection.orchestrationRunId,
      childDefinitionId: stage.childDefinitionId,
      taskId: stage.taskId,
      retryOfDispatchId: stage.retryEligibility.retryOfDispatchId,
      definitionRevision: projection.definitionRevision,
      targetExecutionAuthority: projection.targetExecutionAuthority
    })
  }

  const handleConfirmResolveGate = (
    stage: ProjectedCoordinatedStage,
    gateId: string,
    decision: 'approve' | 'reject' | 'escalate',
    note: string
  ): void => {
    if (
      !stage.gateResolutionEligibility.canResolve ||
      !projection.orchestrationRunId ||
      !operatorActions?.resolveGate?.onResolveGate
    ) {
      return
    }
    void operatorActions.resolveGate.onResolveGate({
      automationId: projection.automationId,
      automationRunId: projection.automationRunId,
      orchestrationRunId: projection.orchestrationRunId,
      childDefinitionId: stage.childDefinitionId,
      taskId: stage.taskId ?? undefined,
      dispatchId: stage.activeDispatchId ?? undefined,
      gateId,
      decision,
      note: note || undefined,
      targetExecutionAuthority: projection.targetExecutionAuthority
    })
  }

  return (
    <section
      aria-label="Coordinated parent run panel"
      data-testid="automation-coordinated-run-panel"
      className="@container w-full min-w-0 space-y-4 rounded-xl border border-border bg-card/30 p-4"
    >
      {/* Top Bar: Title, Run Switcher (when multiple runs exist), and View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Coordinated Run Execution
          </h3>
          <Badge variant="secondary">
            {projection.stages.length} stage{projection.stages.length === 1 ? '' : 's'}
          </Badge>

          {candidateRuns.length > 1 ? (
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Select coordinated run"
            >
              {candidateRuns.map((candidate) => {
                const isSelectedRun = candidate.id === activeRun.id
                const rev =
                  candidate.automationDefinitionRevision ??
                  candidate.resolvedSnapshot?.definitionRevision
                return (
                  <Button
                    key={candidate.id}
                    type="button"
                    variant={isSelectedRun ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => {
                      if (onSelectRunId) {
                        onSelectRunId(candidate.id)
                      } else {
                        setInternalRunId(candidate.id)
                      }
                    }}
                  >
                    {candidate.id}
                    {rev ? ` (Rev ${rev})` : ''}
                  </Button>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* View Mode Switcher */}
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-0.5">
          <Button
            type="button"
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setViewMode('list')}
            aria-label="Run stages list view"
          >
            <List className="size-3" />
            Stages
          </Button>
          <Button
            type="button"
            variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setViewMode('graph')}
            aria-label="Run stages graph view"
          >
            <GitFork className="size-3" />
            Run Graph
          </Button>
          <Button
            type="button"
            variant={viewMode === 'receipt' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setViewMode('receipt')}
            aria-label="Run completion receipt view"
          >
            <FileCheck2 className="size-3" />
            Receipt
          </Button>
          {projection.resolvedSnapshot ? (
            <Button
              type="button"
              variant={viewMode === 'snapshot' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setViewMode('snapshot')}
              aria-label="Run frozen snapshot view"
            >
              <History className="size-3" />
              Frozen Rev {projection.resolvedSnapshot.definitionRevision}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Parent Run Header, State Separation, Hazards, and Limits */}
      <AutomationCoordinatedRunHeaderAndLimits
        projection={projection}
        onRequestStopRun={() => setControlRequest({ kind: 'stop' })}
        onInspectReceipt={() => setViewMode('receipt')}
      />

      {/* Active View Body */}
      {viewMode === 'list' ? (
        <div className="space-y-2.5" data-testid="coordinated-run-stages-list">
          {projection.stages.map((stage) => (
            <AutomationCoordinatedRunStageCard
              key={stage.childDefinitionId}
              stage={stage}
              occupiedMutationLanes={projection.budgetsAndCeilings.occupiedMutationLanes}
              isSelected={stage.childDefinitionId === effectiveSelectedStageId}
              onSelectStage={setSelectedStageId}
              onInspectChildDefinition={onInspectChildDefinition}
              onInspectFrozenSnapshot={() => setViewMode('snapshot')}
              onOpenAttempt={handleOpenAttempt}
              onRequestControl={setControlRequest}
            />
          ))}
        </div>
      ) : null}

      {viewMode === 'graph' ? (
        <div className="space-y-3">
          <AutomationCoordinatedRunStagesGraph
            stages={projection.stages}
            occupiedMutationLanes={projection.budgetsAndCeilings.occupiedMutationLanes}
            selectedStageId={effectiveSelectedStageId}
            onSelectStage={setSelectedStageId}
            onInspectChildDefinition={onInspectChildDefinition}
            onInspectFrozenSnapshot={() => setViewMode('snapshot')}
            onOpenAttempt={handleOpenAttempt}
          />
          {selectedStage ? (
            <div className="pt-1">
              <AutomationCoordinatedRunStageCard
                stage={selectedStage}
                occupiedMutationLanes={projection.budgetsAndCeilings.occupiedMutationLanes}
                isSelected
                onSelectStage={setSelectedStageId}
                onInspectChildDefinition={onInspectChildDefinition}
                onInspectFrozenSnapshot={() => setViewMode('snapshot')}
                onOpenAttempt={handleOpenAttempt}
                onRequestControl={setControlRequest}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {viewMode === 'receipt' ? (
        <AutomationCompletionReceiptInspector
          receipt={projection.completionReceipt}
          trust={projection.completionTrust}
          retainedEvidence={projection.retainedEvidence}
          quarantine={projection.quarantine}
          technicalRunStatus={projection.technicalRunStatus}
        />
      ) : null}

      {viewMode === 'snapshot' && projection.resolvedSnapshot ? (
        <AutomationHistoricalSnapshotViewer
          snapshot={projection.resolvedSnapshot}
          runId={projection.automationRunId}
        />
      ) : null}

      {/* Impact Preview Dialog for Run-Scoped Operator Controls */}
      <AutomationRunControlImpactDialog
        request={controlRequest}
        projectedRun={projection}
        onClose={() => setControlRequest(null)}
        onConfirmStop={handleConfirmStop}
        onConfirmRetry={handleConfirmRetry}
        onConfirmResolveGate={handleConfirmResolveGate}
      />
    </section>
  )
}
