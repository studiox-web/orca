import { AutomationCoordinatedControlNotice } from './AutomationCoordinatedControlNotice'
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
import { AutomationRunControlImpactDialog } from './AutomationRunControlImpactDialog'
import { withWorkerOpenUnbound } from './coordinated-automation-attempt-projection'
import {
  projectCoordinatedAutomationRun,
  type CoordinatedRunLiveObservation,
  type CoordinatedRunOperatorActions,
  type ProjectedCoordinatedAttempt
} from './coordinated-automation-run-projection'
import { useCoordinatedRunControlLifecycle } from './use-coordinated-run-control-lifecycle'
import { translate } from '@/i18n/i18n'

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

  const {
    controlsBusy,
    controlNotice,
    controlRequest,
    requestControl,
    closeControlRequest,
    handleConfirmStop,
    handleConfirmRetry,
    handleConfirmResolveGate
  } = useCoordinatedRunControlLifecycle({ activeRunId, projection, operatorActions })

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

  return (
    <section
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedRunPanel.0fa651ee73',
        'Coordinated parent run panel'
      )}
      data-testid="automation-coordinated-run-panel"
      className="@container w-full min-w-0 space-y-4 rounded-xl border border-border bg-card/30 p-4"
    >
      {/* Top Bar: Title, Run Switcher (when multiple runs exist), and View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.e194255adc',
              'Coordinated Run Execution'
            )}
          </h3>
          <Badge variant="secondary">
            {projection.stages.length}{' '}
            {translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.970e55e3c7',
              'stage'
            )}
            {projection.stages.length === 1 ? '' : 's'}
          </Badge>

          {candidateRuns.length > 1 ? (
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label={translate(
                'auto.components.automations.AutomationCoordinatedRunPanel.d0c40d6c6b',
                'Select coordinated run'
              )}
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
                    {rev
                      ? translate(
                          'auto.components.automations.AutomationCoordinatedRunPanel.6a1faba538',
                          ' (Rev {{value0}})',
                          { value0: rev }
                        )
                      : ''}
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
            aria-label={translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.f2a01c2ab3',
              'Run stages list view'
            )}
          >
            <List className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.874f0d873a',
              'Stages'
            )}
          </Button>
          <Button
            type="button"
            variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setViewMode('graph')}
            aria-label={translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.b6599330dd',
              'Run stages graph view'
            )}
          >
            <GitFork className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.963dc311f0',
              'Run Graph'
            )}
          </Button>
          <Button
            type="button"
            variant={viewMode === 'receipt' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setViewMode('receipt')}
            aria-label={translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.e032173a64',
              'Run completion receipt view'
            )}
          >
            <FileCheck2 className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunPanel.c246a4bf4c',
              'Receipt'
            )}
          </Button>
          {projection.resolvedSnapshot ? (
            <Button
              type="button"
              variant={viewMode === 'snapshot' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setViewMode('snapshot')}
              aria-label={translate(
                'auto.components.automations.AutomationCoordinatedRunPanel.fd30e5ce3d',
                'Run frozen snapshot view'
              )}
            >
              <History className="size-3" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunPanel.a074477998',
                'Frozen Rev'
              )}{' '}
              {projection.resolvedSnapshot.definitionRevision}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Parent Run Header, State Separation, Hazards, and Limits */}
      <AutomationCoordinatedRunHeaderAndLimits
        projection={projection}
        isStopPending={controlsBusy}
        onRequestStopRun={() => requestControl({ kind: 'stop' })}
        onInspectReceipt={() => setViewMode('receipt')}
      />

      <AutomationCoordinatedControlNotice notice={controlNotice} runId={activeRun.id} />

      {/* Active View Body */}
      {viewMode === 'list' ? (
        <div className="space-y-2.5" data-testid="coordinated-run-stages-list">
          {projection.stages.map((stage) => (
            <AutomationCoordinatedRunStageCard
              key={stage.childDefinitionId}
              stage={stage}
              occupiedMutationLanes={projection.budgetsAndCeilings.occupiedMutationLanes}
              isSelected={stage.childDefinitionId === effectiveSelectedStageId}
              controlsDisabled={controlsBusy}
              onSelectStage={setSelectedStageId}
              onInspectChildDefinition={onInspectChildDefinition}
              onInspectFrozenSnapshot={() => setViewMode('snapshot')}
              onOpenAttempt={handleOpenAttempt}
              onRequestControl={requestControl}
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
                controlsDisabled={controlsBusy}
                onSelectStage={setSelectedStageId}
                onInspectChildDefinition={onInspectChildDefinition}
                onInspectFrozenSnapshot={() => setViewMode('snapshot')}
                onOpenAttempt={handleOpenAttempt}
                onRequestControl={requestControl}
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
        isPending={controlsBusy}
        onClose={closeControlRequest}
        onConfirmStop={handleConfirmStop}
        onConfirmRetry={handleConfirmRetry}
        onConfirmResolveGate={handleConfirmResolveGate}
      />
    </section>
  )
}
