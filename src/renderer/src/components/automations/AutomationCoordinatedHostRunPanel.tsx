import React from 'react'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { Button } from '@/components/ui/button'
import { AutomationCompletionReceiptInspector } from './AutomationCompletionReceiptInspector'
import { AutomationHistoricalSnapshotViewer } from './AutomationHistoricalSnapshotViewer'
import { useCoordinatedRunApi } from './use-coordinated-run-api'

export function AutomationCoordinatedHostRunPanel(
  props: Parameters<typeof useCoordinatedRunApi>[0]
): React.JSX.Element {
  const state = useCoordinatedRunApi(props)
  const { view, selectedRunId } = state
  const runIds = [
    ...new Set([...props.runs.map((run) => run.id), ...(selectedRunId ? [selectedRunId] : [])])
  ]
  const run = props.runs.find((candidate) => candidate.id === selectedRunId)
  const snapshot = run?.resolvedSnapshot
  const startReason = props.automation.enabled
    ? 'Test runs require a disabled definition.'
    : view && !view.actions.start.available
      ? view.actions.start.reason
      : null
  const reconcileReason =
    view && !view.actions.reconcile.available ? view.actions.reconcile.reason : null
  return (
    <section
      aria-label="Coordinated test runs"
      className="space-y-3 rounded-lg border border-border p-4 min-w-0"
    >
      <h3 className="text-sm font-medium">No-effect test runs</h3>
      <p className="text-xs text-muted-foreground">
        Manual isolated workers only. No live agents, publishing, or schedules. Each run keeps its
        saved definition revision.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!state.ready || state.busy || Boolean(startReason)}
          onClick={() => void state.start()}
        >
          {state.pendingStart ? 'Recover original test start' : 'Start no-effect test run'}
        </Button>
        <Button size="sm" variant="outline" disabled={state.busy} onClick={state.refresh}>
          Refresh test runs
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!state.ready || !view || state.busy || Boolean(reconcileReason)}
          onClick={() => void state.reconcile()}
        >
          Reconcile selected test run
        </Button>
      </div>
      {startReason ? <p className="text-xs text-muted-foreground">{startReason}</p> : null}
      {reconcileReason ? <p className="text-xs text-muted-foreground">{reconcileReason}</p> : null}
      {state.pendingStart ? (
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
      {view ? <CoordinatedHostRunEvidence view={view} /> : null}
      {view &&
      snapshot &&
      snapshot.canonicalDigest === view.inspection.canonicalDigest &&
      snapshot.definitionRevision === view.inspection.definitionRevision ? (
        <AutomationHistoricalSnapshotViewer snapshot={snapshot} />
      ) : view ? (
        <p className="text-xs text-muted-foreground">
          Frozen definition details are unavailable until matching run history is refreshed.
        </p>
      ) : null}
    </section>
  )
}

export function CoordinatedHostRunEvidence({
  view
}: {
  view: CoordinatedRunView
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
                  Accepted Dispatch: {stage.semantic.acceptedDispatchId ?? 'None recorded'} ·
                  Admitted attempts: {stage.semantic.attempts}
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
            <p className="text-muted-foreground">
              Worker session unavailable: {stage.sessionTarget.reason}
            </p>
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
        <p>
          Spend, elapsed time, worker reports, live questions and pending approval details are not
          supplied by this API.
        </p>
        <p>Stop unavailable: {view.actions.stop.reason}</p>
        <p>Stage retry unavailable: {view.actions.retry.reason}</p>
        <p>Human resolution unavailable: {view.actions.humanResolution.reason}</p>
      </div>
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
