import React, { useState } from 'react'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { Button } from '@/components/ui/button'
import { AutomationCompletionReceiptInspector } from './AutomationCompletionReceiptInspector'
import {
  CoordinatedHostRunControls,
  CoordinatedHostStageActions,
  operatorOutcomeMessage,
  type CoordinatedHostRunControlBindings,
  type HostRunControlRequest
} from './AutomationCoordinatedHostRunControls'
import { AutomationHistoricalSnapshotViewer } from './AutomationHistoricalSnapshotViewer'
import { AutomationRunControlImpactDialog } from './AutomationRunControlImpactDialog'
import { CoordinatedHostStageEvidence } from './AutomationCoordinatedHostStageEvidence'
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
        onRequest: (next, gate) =>
          setPending({ runId: view.inspection.automationRunId, request: next, gate }),
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
          request={request}
          projectedRun={{
            targetExecutionAuthority:
              view.inspection.targetExecutionAuthority ?? 'Authority unavailable',
            automationRunId: view.inspection.automationRunId,
            orchestrationRunId: view.inspection.orchestrationRunId,
            definitionRevision: view.inspection.definitionRevision,
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
            if (gate) {
              void state.operate({
                kind: 'gate',
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

export function CoordinatedHostRunEvidence({
  view,
  controls
}: {
  view: CoordinatedRunView
  controls: CoordinatedHostRunControlBindings
}): React.JSX.Element {
  const { inspection } = view
  return (
    <div className="space-y-3 min-w-0">
      <dl className="grid gap-1 text-xs break-all">
        <div>
          <dt className="inline text-muted-foreground">Runtime: </dt>
          <dd className="inline">{view.runtimeId}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Parent run: </dt>
          <dd className="inline">{inspection.automationRunId}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Orchestration run: </dt>
          <dd className="inline">{inspection.orchestrationRunId ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Frozen revision: </dt>
          <dd className="inline">{inspection.definitionRevision}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Technical run status: </dt>
          <dd className="inline">{inspection.runStatus}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Semantic receipt: </dt>
          <dd className="inline">
            {inspection.receipt.kind === 'available'
              ? inspection.receipt.receipt.finalState
              : `${inspection.receipt.kind}: ${inspection.receipt.reason}`}
          </dd>
        </div>
      </dl>
      {inspection.runError ? (
        <p className="text-xs text-status-warning">{inspection.runError}</p>
      ) : null}
      <ul className="space-y-2" aria-label="Host-observed stages">
        {inspection.stages.map((stage) => (
          <li
            key={stage.childDefinitionId}
            className="space-y-1 rounded-md border border-border p-3 text-xs break-words"
          >
            <h4 className="font-medium">
              {stage.name} · {stage.role}
              {inspection.activeStageIds.includes(stage.childDefinitionId) ? ' · attempt open' : ''}
            </h4>
            <p className="break-all">
              Child {stage.childDefinitionId} · Task {stage.taskId ?? 'not materialized'} · Mapped
              Dispatch {stage.mappedDispatchId ?? 'not materialized'}
            </p>
            <p>
              Technical:{' '}
              {stage.native.kind === 'available'
                ? `${stage.native.taskStatus} · ${stage.native.latestDispatchStatus ?? 'No Dispatch status'}`
                : `${stage.native.kind}: ${stage.native.reason}`}
            </p>
            {stage.native.kind === 'available' ? (
              <p className="break-all">
                Latest native Dispatch: {stage.native.latestDispatchId ?? 'None'}
              </p>
            ) : null}
            <p>
              Semantic acceptance:{' '}
              {stage.semantic.kind === 'available'
                ? stage.semantic.status
                : `${stage.semantic.kind}: ${stage.semantic.reason}`}
            </p>
            {stage.semantic.kind === 'available' ? (
              <>
                <p className="break-all">
                  Latest launched Dispatch: {stage.semantic.activeDispatchId ?? 'None'} · Accepted
                  Dispatch: {stage.semantic.acceptedDispatchId ?? 'None recorded'} · Admitted
                  attempts: {stage.semantic.attempts}
                </p>
                {stage.semantic.lastError ? (
                  <p className="text-status-warning">{stage.semantic.lastError}</p>
                ) : null}
                <ol aria-label={`${stage.name} attempts`} className="space-y-1">
                  {stage.semantic.lineage.map((attempt) => (
                    <li key={attempt.attemptNumber} className="break-all">
                      Attempt {attempt.attemptNumber} · {attempt.kind} · {attempt.status} · Dispatch{' '}
                      {attempt.dispatchId ?? 'not bound'}
                      {attempt.retryOfDispatchId ? ` · retry of ${attempt.retryOfDispatchId}` : ''}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            <CoordinatedHostStageEvidence stage={stage} />
            <CoordinatedHostStageActions
              stage={stage}
              retryAvailable={view.actions.retry.available}
              controls={controls}
            />
          </li>
        ))}
      </ul>
      {inspection.progress.kind === 'available' ? (
        <div className="space-y-1 text-xs">
          <p>
            Observed generation {inspection.progress.generation}, sequence{' '}
            {inspection.progress.sequence}; reports {inspection.progress.reportCount}.
          </p>
          {inspection.progress.halt ? (
            <p className="text-status-warning">
              {inspection.progress.halt.state}: {inspection.progress.halt.reason}
            </p>
          ) : null}
          {inspection.progress.escalations.map((item) => (
            <p key={item.key} className="text-status-warning">
              {item.code}: {item.detail}
              {item.requiresHumanDecision ? ' · Human decision required' : ''}
            </p>
          ))}
          {inspection.progress.effects.map((effect) => (
            <p key={effect.effectId}>
              {effect.kind}: {effect.status} · {effect.receipt ?? 'No effect receipt'}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Progress {inspection.progress.kind}: {inspection.progress.reason}
        </p>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Findings unavailable: {view.findings.reason}</p>
        <p>Limits unavailable: {view.limits.reason}</p>
        <p>Spend, elapsed time and live questions are not supplied by this API.</p>
      </div>
      <CoordinatedHostRunControls view={view} controls={controls} />
      {inspection.receipt.kind === 'available' ? (
        <AutomationCompletionReceiptInspector
          receipt={inspection.receipt.receipt}
          trust={inspection.receipt.trust}
          retainedEvidence={null}
          quarantine={null}
          technicalRunStatus={inspection.runStatus}
        />
      ) : null}
    </div>
  )
}
