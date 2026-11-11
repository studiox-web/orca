import React from 'react'
import { RotateCcw, ShieldCheck, Square, SquareTerminal } from 'lucide-react'
import type {
  CoordinatedApprovalObservation,
  CoordinatedStageInspection
} from '../../../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIntlLocale } from '@/i18n/i18n'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import {
  approveRefusal,
  type CoordinatedPendingGate,
  type CoordinatedRunOperatorOutcome
} from './coordinated-run-operator-client'
import { stageSessionOpenRefusal } from './coordinated-stage-session-open'

export type HostRunControlRequest = RunControlActionRequest<CoordinatedStageInspection>

export type CoordinatedHostRunControlBindings = {
  busy: boolean
  /** Why the frozen operator scope cannot be named; null when the host supplies it. */
  scopeUnavailable: string | null
  pendingGates: readonly CoordinatedPendingGate[]
  onRequest: (request: HostRunControlRequest, gate?: CoordinatedPendingGate) => void
  onOpenSession: (stage: CoordinatedStageInspection) => void
}

function gateScopeLabel(gate: CoordinatedPendingGate, view: CoordinatedRunView): string {
  if (gate.scope === 'parent') {
    return 'Parent outcome (no stage scope)'
  }
  if (!gate.childDefinitionId) {
    return 'Run-level escalation (no stage scope)'
  }
  if (gate.scope === 'escalation') {
    return `${gate.childDefinitionId} (escalation)`
  }
  const stage = view.inspection.stages.find(
    (entry) => entry.childDefinitionId === gate.childDefinitionId
  )
  const dispatchId = stage?.pendingApproval?.dispatchId
  return `${gate.childDefinitionId} / ${stage?.taskId ?? 'no-task'} / ${
    dispatchId ? `approve binds ${dispatchId}` : 'no held report to approve'
  }`
}

const GATE_IMPACT = {
  stage:
    'Approval applies only to the held report shown here. A changed report or attempt requires a new decision; this does not reopen the completed worker.',
  parent: 'This decision applies to the parent outcome, not to any one stage.',
  escalation:
    'An escalation decision records your acknowledgement only. It does not clear the halt or approve a requirement.'
} as const

export function operatorOutcomeMessage(outcome: CoordinatedRunOperatorOutcome): string {
  const { action, disposition } = outcome
  const subject =
    action.kind === 'stop'
      ? 'stop request'
      : action.kind === 'retry'
        ? `retry of stage ${action.childDefinitionId}`
        : `${action.decision} decision for ${action.scope} gate ${action.gateId}`
  const recorded =
    disposition === 'already_recorded'
      ? `The host had already recorded this ${subject}; this request wrote nothing.`
      : `The host recorded the ${subject}.`
  const caveat = action.kind === 'stop' ? ' Worker exit is not proven until the run settles.' : ''
  return `${recorded}${caveat} Reported run state: ${outcome.state}${
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
          Stop requested {new Date(inspection.operatorStop.at).toLocaleString(getIntlLocale())}
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
              key={gate.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <span className="min-w-0 break-words">
                <span className="font-mono break-all">{gate.gateId}</span> · {gate.scope} ·{' '}
                {gate.label}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label={`Resolve ${gate.scope} gate ${gate.gateId}`}
                disabled={controls.busy || decisionReason !== null}
                onClick={() =>
                  controls.onRequest(
                    {
                      kind: 'resolve_run_gate',
                      gateId: gate.gateId,
                      scopeLabel: gateScopeLabel(gate, view),
                      eligibility: { canResolve: decisionReason === null, reason: decisionReason },
                      approveUnavailableReason: approveRefusal(view, gate),
                      impactNote: GATE_IMPACT[gate.scope]
                    },
                    gate
                  )
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
        {gate.pendingGateIds.length ? (
          <Badge variant="outline" className="max-w-full break-all whitespace-normal">
            Awaiting decision: {gate.pendingGateIds.join(', ')}
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
