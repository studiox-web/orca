import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  operatorOutcomeMessage,
  type CoordinatedHostRunControlBindings,
  type HostRunControlRequest
} from './AutomationCoordinatedHostRunControls'
import { AutomationHistoricalSnapshotViewer } from './AutomationHistoricalSnapshotViewer'
import { AutomationRunControlImpactDialog } from './AutomationRunControlImpactDialog'
import { CoordinatedHeldReport } from './AutomationCoordinatedHostStageEvidence'
import { CoordinatedHostRunEvidence } from './AutomationCoordinatedHostRunEvidence'
import {
  captureCoordinatedGateCandidate,
  type CoordinatedGateCandidate
} from './coordinated-run-gate-candidate'
import {
  describePendingGates,
  matchingFrozenSnapshot,
  operatorScopeRefusal,
  type CoordinatedPendingGate
} from './coordinated-run-operator-client'
import { openCoordinatedStageSession } from './coordinated-stage-session-open'
import { useCoordinatedRunApi } from './use-coordinated-run-api'

export function AutomationCoordinatedHostRunPanel(
  props: Parameters<typeof useCoordinatedRunApi>[0]
): React.JSX.Element {
  const state = useCoordinatedRunApi(props)
  const { view, selectedRunId } = state
  const pinned = Boolean(props.pinnedRun)
  const runIds = pinned
    ? []
    : [...new Set([...props.runs.map((run) => run.id), ...(selectedRunId ? [selectedRunId] : [])])]
  const unconfirmed = state.unconfirmedOperator
  const run = state.selectedRun
  const snapshot = view ? matchingFrozenSnapshot(view, run) : null
  const [pending, setPending] = useState<{
    runId: string
    request: HostRunControlRequest
    gate?: CoordinatedPendingGate
    candidate?: CoordinatedGateCandidate
  } | null>(null)
  const scopeRefusal = view ? operatorScopeRefusal(view, snapshot) : null
  // Why: a confirmation opened for one run must never submit against a newly selected run.
  const request =
    view && pending?.runId === view.inspection.automationRunId ? pending.request : null
  const owner = props.capturedOwner?.owner
  const controls: CoordinatedHostRunControlBindings | null = view
    ? {
        busy: state.busy || !state.ready,
        scopeUnavailable: scopeRefusal,
        pendingGates: describePendingGates(view, snapshot),
        onRequest: (next, gate) => {
          const candidate =
            gate && owner
              ? captureCoordinatedGateCandidate({ automation: props.automation, owner }, view, gate)
              : undefined
          setPending({ runId: view.inspection.automationRunId, request: next, gate, candidate })
        },
        onOpenSession: (stage) => {
          if (owner) {
            void openCoordinatedStageSession(stage, owner, props.hostEntry?.label)
          }
        }
      }
    : null
  const startReason = props.automation.enabled
    ? 'Test runs require a disabled definition.'
    : view && !view.actions.start.available
      ? view.actions.start.reason
      : null
  const reconcileReason =
    view && !view.actions.reconcile.available ? view.actions.reconcile.reason : null
  return (
    <section
      aria-label={pinned ? 'Host run controls' : 'Coordinated test runs'}
      className="space-y-3 rounded-lg border border-border p-4 min-w-0"
    >
      <h3 className="text-sm font-medium">
        {pinned ? 'Host-observed run and controls' : 'No-effect test runs'}
      </h3>
      <p className="text-xs text-muted-foreground">
        {pinned
          ? `Bound to run ${selectedRunId}. Evidence and controls come from the owning host for this exact run and its frozen definition revision.`
          : 'Manual isolated workers only. No live agents, publishing, or schedules. Each run keeps its saved definition revision.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pinned ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={!state.ready || state.busy || Boolean(startReason)}
            onClick={() => void state.start()}
          >
            {state.pendingStart ? 'Recover original test start' : 'Start no-effect test run'}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={state.busy} onClick={state.refresh}>
          {pinned ? 'Refresh run' : 'Refresh test runs'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!state.ready || !view || state.busy || Boolean(reconcileReason)}
          onClick={() => void state.reconcile()}
        >
          {pinned ? 'Reconcile run' : 'Reconcile selected test run'}
        </Button>
      </div>
      {startReason && !pinned ? (
        <p className="text-xs text-muted-foreground">{startReason}</p>
      ) : null}
      {reconcileReason ? <p className="text-xs text-muted-foreground">{reconcileReason}</p> : null}
      {state.pendingStart && !pinned ? (
        <p className="text-xs text-muted-foreground">
          Recovery uses submitted revision {state.pendingStart.expectedDefinitionRevision}. Later
          definition edits are not part of that request.
        </p>
      ) : null}
      {runIds.length ? (
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Selected test run
          <select
            className="w-full min-w-0 rounded-md border border-input bg-background p-2 text-xs"
            value={selectedRunId ?? ''}
            onChange={(event) => state.selectRun(event.target.value)}
          >
            {runIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {state.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Checking the exact submitted operation…
        </p>
      ) : null}
      {state.notice ? (
        <p role="alert" className="text-xs text-status-warning break-words">
          {state.notice}
        </p>
      ) : null}
      {!state.ready && !state.notice && !state.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Checking host availability…
        </p>
      ) : null}
      {unconfirmed ? (
        <p role="alert" className="text-xs text-status-warning break-words">
          An earlier {unconfirmed.label} for this run was submitted without a confirmed answer (
          {unconfirmed.detail}). Its effect is unknown.
        </p>
      ) : null}
      {unconfirmed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!state.ready || state.busy}
            onClick={() => void state.replayUnconfirmed()}
          >
            Ask host about this request
          </Button>
          <p className="text-xs text-muted-foreground">
            Resends the identical request. The host answers whether it was already recorded and
            records it at most once.
          </p>
        </div>
      ) : null}
      {state.operatorOutcome ? (
        <p role="status" className="text-xs text-muted-foreground break-words">
          {operatorOutcomeMessage(state.operatorOutcome)}
        </p>
      ) : null}
      {view && controls ? <CoordinatedHostRunEvidence view={view} controls={controls} /> : null}
      {view && snapshot ? (
        <AutomationHistoricalSnapshotViewer snapshot={snapshot} />
      ) : view ? (
        <p className="text-xs text-muted-foreground">
          Frozen definition details are unavailable until matching run history is refreshed.
        </p>
      ) : null}
      {view && controls ? (
        <AutomationRunControlImpactDialog
          request={
            request?.kind === 'resolve_run_gate' && pending?.candidate
              ? {
                  ...request,
                  evidence: pending.candidate.heldReport ? (
                    <CoordinatedHeldReport
                      name="Report under review"
                      held={pending.candidate.heldReport}
                    />
                  ) : undefined
                }
              : request
          }
          projectedRun={{
            targetExecutionAuthority:
              pending?.candidate?.base.targetExecutionAuthority ??
              view.inspection.targetExecutionAuthority ??
              'Authority unavailable',
            automationRunId:
              pending?.candidate?.base.automationRunId ?? view.inspection.automationRunId,
            orchestrationRunId:
              pending?.candidate?.base.orchestrationRunId ?? view.inspection.orchestrationRunId,
            definitionRevision:
              pending?.candidate?.base.definitionRevision ?? view.inspection.definitionRevision,
            currentAutomationRevision:
              props.automation.definitionRevision ?? view.inspection.definitionRevision,
            workspaceLabel: run?.workspaceDisplayName ?? run?.workspaceId ?? 'Not recorded',
            hostLabel: props.hostEntry?.label ?? 'the owning host',
            stopEligibility: {
              canStop: view.actions.stop.available && scopeRefusal === null,
              reason: !view.actions.stop.available ? view.actions.stop.reason : scopeRefusal
            }
          }}
          isPending={controls.busy}
          onClose={() => setPending(null)}
          onConfirmStop={() => void state.operate({ kind: 'stop' })}
          onConfirmRetry={(stage) => {
            const retryOfDispatchId = stage.retryEligibility.retryOfDispatchId
            if (retryOfDispatchId) {
              void state.operate({
                kind: 'retry',
                childDefinitionId: stage.childDefinitionId,
                retryOfDispatchId
              })
            }
          }}
          onConfirmResolveGate={(_stage, _gateId, decision, note) => {
            // Why: the decision keeps the exact host scope and child it was opened for, never a bare id.
            const gate = pending?.gate
            if (gate && pending.candidate) {
              void state.operate({
                kind: 'gate',
                candidate: pending.candidate,
                gateId: gate.gateId,
                scope: gate.scope,
                childDefinitionId: gate.childDefinitionId,
                decision,
                ...(note ? { note } : {})
              })
            }
          }}
        />
      ) : null}
    </section>
  )
}

export { CoordinatedHostRunEvidence } from './AutomationCoordinatedHostRunEvidence'
