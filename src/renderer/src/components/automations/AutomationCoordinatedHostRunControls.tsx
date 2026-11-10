import React from 'react'
import { RotateCcw, ShieldCheck, Square, SquareTerminal } from 'lucide-react'
import type {
  CoordinatedApprovalObservation,
  CoordinatedStageInspection
} from '../../../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import type {
  CoordinatedPendingGate,
  CoordinatedRunOperatorOutcome
} from './coordinated-run-operator-client'
import { stageSessionOpenRefusal } from './coordinated-stage-session-open'

export type HostRunControlRequest = RunControlActionRequest<CoordinatedStageInspection>

export type CoordinatedHostRunControlBindings = {
  busy: boolean
  /** Null until matching frozen history proves the run's execution authority. */
  scopeUnavailable: string | null
  pendingGates: readonly CoordinatedPendingGate[]
  onRequest: (request: HostRunControlRequest) => void
  onOpenSession: (stage: CoordinatedStageInspection) => void
}

function gateScopeLabel(gate: CoordinatedPendingGate, view: CoordinatedRunView): string {
  if (gate.scope === 'parent') {
    return 'Parent outcome (no stage scope)'
  }
  const childId = gate.scope === 'unclassified' ? null : gate.childDefinitionId
  if (!childId) {
    return 'Run-level escalation (no stage scope)'
  }
  const taskId = view.inspection.stages.find((stage) => stage.childDefinitionId === childId)?.taskId
  return gate.scope === 'stage'
    ? `${childId} / ${taskId ?? 'no-task'} / Dispatch bound by host`
    : `${childId} (escalation)`
}

export function operatorOutcomeMessage(outcome: CoordinatedRunOperatorOutcome): string {
  const { action, view } = outcome
  const subject =
    action.kind === 'stop'
      ? `the stop request. ${
          view.inspection.operatorStop
            ? 'A stop is recorded; worker exit is not proven until the run settles.'
            : 'It reports no recorded stop.'
        }`
      : action.kind === 'retry'
        ? `the retry request for stage ${action.childDefinitionId}.`
        : `the ${action.decision} decision for ${action.gateId}.`
  return `The host answered ${subject} Reported run state: ${outcome.state}${
    outcome.reason ? ` (${outcome.reason})` : ''
  }.`
}

function ApprovalList({
  label,
  approvals
}: {
  label: string
  approvals: readonly CoordinatedApprovalObservation[]
}): React.JSX.Element | null {
  if (!approvals.length) {
    return null
  }
  return (
    <ul aria-label={label} className="space-y-1">
      {approvals.map((approval) => (
        <li
          key={`${approval.approvalId}:${approval.scope.childDefinitionId ?? 'parent'}`}
          className="break-all"
        >
          <span className="font-mono">{approval.approvalId}</span> · {approval.role} ·{' '}
          {approval.status}
          {approval.approverIdentity ? ` by ${approval.approverIdentity}` : ''}
          {approval.scope.childDefinitionId ? ` · stage ${approval.scope.childDefinitionId}` : ''}
          {approval.scope.dispatchId ? ` · Dispatch ${approval.scope.dispatchId}` : ''}
          {approval.rejectionReason ? ` · ${approval.rejectionReason}` : ''}
        </li>
      ))}
    </ul>
  )
}

export function CoordinatedHostRunControls({
  view,
  controls
}: {
  view: CoordinatedRunView
  controls: CoordinatedHostRunControlBindings
}): React.JSX.Element {
  const { inspection, actions } = view
  const stopReason = !actions.stop.available ? actions.stop.reason : controls.scopeUnavailable
  const decisionReason = !actions.humanResolution.available
    ? actions.humanResolution.reason
    : controls.scopeUnavailable
  const hasApprovals = inspection.approvals.stage.length + inspection.approvals.parent.length > 0
  return (
    <section
      aria-label="Run controls"
      className="space-y-2 rounded-md border border-border p-3 text-xs min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          Run controls
        </h4>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={controls.busy || stopReason !== null}
          onClick={() => controls.onRequest({ kind: 'stop' })}
        >
          <Square aria-hidden="true" />
          Stop run
        </Button>
      </div>
      <p className="text-muted-foreground">
        Controls act on this run only. Child roles, prompts and models are edited in the definition
        and apply to later runs; this run keeps its frozen revision.
      </p>
      {inspection.operatorStop ? (
        <p className="text-status-warning break-words">
          Stop requested {new Date(inspection.operatorStop.at).toLocaleString()}
          {inspection.operatorStop.reason ? ` (${inspection.operatorStop.reason})` : ''}. Worker
          exit is not proven until the run settles.
        </p>
      ) : stopReason ? (
        <p className="text-muted-foreground break-words">Stop unavailable: {stopReason}</p>
      ) : null}
      {!actions.retry.available ? (
        <p className="text-muted-foreground break-words">
          Stage retry unavailable: {actions.retry.reason}
        </p>
      ) : null}
      {controls.pendingGates.length ? (
        <ul aria-label="Pending decisions" className="space-y-1.5">
          {controls.pendingGates.map((gate) => (
            <li
              key={gate.gateId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <span className="min-w-0 break-words">
                <span className="font-mono break-all">{gate.gateId}</span> · {gate.label}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={controls.busy || decisionReason !== null || gate.scope === 'unclassified'}
                onClick={() =>
                  controls.onRequest({
                    kind: 'resolve_run_gate',
                    gateId: gate.gateId,
                    scopeLabel: gateScopeLabel(gate, view),
                    eligibility: { canResolve: decisionReason === null, reason: decisionReason }
                  })
                }
              >
                <ShieldCheck aria-hidden="true" />
                Resolve
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {decisionReason ? (
        <p className="text-muted-foreground break-words">
          Human resolution unavailable: {decisionReason}
        </p>
      ) : null}
      {hasApprovals ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">Recorded approvals</p>
          <ApprovalList label="Stage approvals" approvals={inspection.approvals.stage} />
          <ApprovalList label="Parent approvals" approvals={inspection.approvals.parent} />
        </div>
      ) : (
        <p className="text-muted-foreground">No approvals are recorded for this run.</p>
      )}
    </section>
  )
}

export function CoordinatedHostStageActions({
  stage,
  retryAvailable,
  controls
}: {
  stage: CoordinatedStageInspection
  retryAvailable: boolean
  controls: CoordinatedHostRunControlBindings
}): React.JSX.Element {
  const sessionRefusal = stageSessionOpenRefusal(stage)
  const retry = stage.retryEligibility
  const retryReason = retry.canRetry ? controls.scopeUnavailable : retry.reason
  const gate = stage.gateResolutionEligibility
  return (
    <div className="space-y-1 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={sessionRefusal !== null}
          onClick={() => controls.onOpenSession(stage)}
        >
          <SquareTerminal aria-hidden="true" />
          Open worker terminal
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={controls.busy || !retryAvailable || !retry.canRetry || retryReason !== null}
          onClick={() => controls.onRequest({ kind: 'retry', stage })}
        >
          <RotateCcw aria-hidden="true" />
          Retry stage
        </Button>
        {gate.pendingGateId ? (
          <Badge variant="outline" className="max-w-full break-all whitespace-normal">
            Awaiting decision: {gate.pendingGateId}
          </Badge>
        ) : null}
      </div>
      {sessionRefusal ? (
        <p className="text-muted-foreground break-words">
          Worker session unavailable: {sessionRefusal}
        </p>
      ) : null}
      {retryReason ? (
        <p className="text-muted-foreground break-words">Retry unavailable: {retryReason}</p>
      ) : null}
    </div>
  )
}
