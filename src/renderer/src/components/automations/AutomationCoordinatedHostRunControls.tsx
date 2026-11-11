import React from 'react'
import { gateScopeLabel, gateImpact } from './coordinated-host-run-control-copy'
export { operatorOutcomeMessage } from './coordinated-host-run-control-copy'
import { RotateCcw, ShieldCheck, Square, SquareTerminal } from 'lucide-react'
import type {
  CoordinatedApprovalObservation,
  CoordinatedStageInspection
} from '../../../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import { approveRefusal, type CoordinatedPendingGate } from './coordinated-run-operator-client'
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
          {approval.approverIdentity
            ? translate(
                'auto.components.automations.AutomationCoordinatedHostRunControls.6a0a7da146',
                ' by {{value0}}',
                { value0: approval.approverIdentity }
              )
            : ''}
          {approval.scope.childDefinitionId
            ? translate(
                'auto.components.automations.AutomationCoordinatedHostRunControls.acc3a32513',
                ' · stage {{value0}}',
                { value0: approval.scope.childDefinitionId }
              )
            : ''}
          {approval.scope.dispatchId
            ? translate(
                'auto.components.automations.AutomationCoordinatedHostRunControls.2738a9404f',
                ' · Dispatch {{value0}}',
                { value0: approval.scope.dispatchId }
              )
            : ''}
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
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedHostRunControls.6e0b6c0a38',
        'Run controls'
      )}
      className="space-y-2 rounded-md border border-border p-3 text-xs min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.6e0b6c0a38',
            'Run controls'
          )}
        </h4>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={controls.busy || stopReason !== null}
          onClick={() => controls.onRequest({ kind: 'stop' })}
        >
          <Square aria-hidden="true" />
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.7f65f56295',
            'Stop run'
          )}
        </Button>
      </div>
      <p className="text-muted-foreground">
        {translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.b03f4407d5',
          'Controls act on this run only. Child roles, prompts and models are edited in the definition and apply to later runs; this run keeps its frozen revision.'
        )}
      </p>
      {inspection.operatorStop ? (
        <p className="text-status-warning break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.c0989bc04d',
            'Stop requested'
          )}{' '}
          {new Date(inspection.operatorStop.at).toLocaleString(getIntlLocale())}
          {inspection.operatorStop.reason ? ` (${inspection.operatorStop.reason})` : ''}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.c3d6dce52b',
            '. Worker exit is not proven until the run settles.'
          )}
        </p>
      ) : stopReason ? (
        <p className="text-muted-foreground break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.281139a6e7',
            'Stop unavailable:'
          )}{' '}
          {stopReason}
        </p>
      ) : null}
      {!actions.retry.available ? (
        <p className="text-muted-foreground break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.d187a6a704',
            'Stage retry unavailable:'
          )}{' '}
          {actions.retry.reason}
        </p>
      ) : null}
      {controls.pendingGates.length ? (
        <ul
          aria-label={translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.5355da02bf',
            'Pending decisions'
          )}
          className="space-y-1.5"
        >
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
                aria-label={translate(
                  'auto.components.automations.AutomationCoordinatedHostRunControls.resolveGateAria',
                  'Resolve {{value0}} gate {{value1}}',
                  { value0: gate.scope, value1: gate.gateId }
                )}
                disabled={controls.busy || decisionReason !== null}
                onClick={() =>
                  controls.onRequest(
                    {
                      kind: 'resolve_run_gate',
                      gateId: gate.gateId,
                      scopeLabel: gateScopeLabel(gate, view),
                      eligibility: { canResolve: decisionReason === null, reason: decisionReason },
                      approveUnavailableReason: approveRefusal(view, gate),
                      impactNote: gateImpact()[gate.scope]
                    },
                    gate
                  )
                }
              >
                <ShieldCheck aria-hidden="true" />
                {translate(
                  'auto.components.automations.AutomationCoordinatedHostRunControls.ec9d9c3c51',
                  'Resolve'
                )}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {decisionReason ? (
        <p className="text-muted-foreground break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.a5d786ac76',
            'Human resolution unavailable:'
          )}{' '}
          {decisionReason}
        </p>
      ) : null}
      {hasApprovals ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunControls.5464807751',
              'Recorded approvals'
            )}
          </p>
          <ApprovalList
            label={translate(
              'auto.components.automations.AutomationCoordinatedHostRunControls.146b1624be',
              'Stage approvals'
            )}
            approvals={inspection.approvals.stage}
          />
          <ApprovalList
            label={translate(
              'auto.components.automations.AutomationCoordinatedHostRunControls.2f2665e552',
              'Parent approvals'
            )}
            approvals={inspection.approvals.parent}
          />
        </div>
      ) : (
        <p className="text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.093d0e9b7d',
            'No approvals are recorded for this run.'
          )}
        </p>
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
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.66a1ad52b0',
            'Open worker terminal'
          )}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={controls.busy || !retryAvailable || !retry.canRetry || retryReason !== null}
          onClick={() => controls.onRequest({ kind: 'retry', stage })}
        >
          <RotateCcw aria-hidden="true" />
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.3149379a55',
            'Retry stage'
          )}
        </Button>
        {gate.pendingGateIds.length ? (
          <Badge variant="outline" className="max-w-full break-all whitespace-normal">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunControls.6d2e58a9cc',
              'Awaiting decision:'
            )}{' '}
            {gate.pendingGateIds.join(', ')}
          </Badge>
        ) : null}
      </div>
      {sessionRefusal ? (
        <p className="text-muted-foreground break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.184c1892b8',
            'Worker session unavailable:'
          )}{' '}
          {sessionRefusal}
        </p>
      ) : null}
      {retryReason ? (
        <p className="text-muted-foreground break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.558d0f7261',
            'Retry unavailable:'
          )}{' '}
          {retryReason}
        </p>
      ) : null}
    </div>
  )
}
