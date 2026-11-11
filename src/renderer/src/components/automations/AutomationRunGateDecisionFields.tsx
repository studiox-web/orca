import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type {
  RunControlActionRequest,
  RunControlImpactStage
} from './AutomationRunControlImpactDialog'
import { translate } from '@/i18n/i18n'

type Decision = 'approve' | 'reject' | 'escalate'

export function AutomationRunGateDecisionFields<S extends RunControlImpactStage>({
  request,
  decision,
  note,
  onDecision,
  onNote
}: {
  request: Extract<RunControlActionRequest<S>, { kind: 'resolve_gate' | 'resolve_run_gate' }>
  decision: Decision
  note: string
  onDecision: (value: Decision) => void
  onNote: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3 text-xs text-foreground">
      <div className="space-y-1 rounded border border-border/50 bg-background p-2.5 text-2xs">
        <div>
          <span className="text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationRunGateDecisionFields.11c2acb32a',
              'Gate ID:'
            )}{' '}
          </span>
          <span className="font-mono font-medium">{request.gateId}</span>
        </div>
        <div>
          <span className="text-muted-foreground">
            {request.kind === 'resolve_gate'
              ? translate(
                  'auto.components.automations.AutomationRunGateDecisionFields.94d440ea59',
                  'Stage Scope:'
                )
              : translate(
                  'auto.components.automations.AutomationRunGateDecisionFields.07453f82d0',
                  'Scope:'
                )}
          </span>
          <span className="font-mono">
            {request.kind === 'resolve_run_gate'
              ? request.scopeLabel
              : `${request.stage.childDefinitionId} / ${request.stage.taskId ?? 'no-task'} / ${
                  request.stage.activeDispatchId === undefined
                    ? translate(
                        'auto.components.automations.AutomationRunGateDecisionFields.e2038e6fa1',
                        'Dispatch bound by host'
                      )
                    : (request.stage.activeDispatchId ?? 'no-dispatch')
                }`}
          </span>
        </div>
      </div>

      <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
        {translate(
          'auto.components.automations.AutomationRunGateDecisionFields.8df99d2726',
          'For an approval requirement, approve records an operator approval and reject closes the decision for this candidate. Escalate records an audit event and leaves the requirement pending. An escalation notice is acknowledged only; its halt remains in place. Decisions are recorded in this run’s history.'
        )}
      </p>
      {request.kind === 'resolve_run_gate' && request.impactNote ? (
        <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
          {request.impactNote}
        </p>
      ) : null}
      {request.kind === 'resolve_run_gate' ? request.evidence : null}
      <div className="space-y-2">
        <Label>
          {translate(
            'auto.components.automations.AutomationRunGateDecisionFields.c6921b45d2',
            'Decision'
          )}
        </Label>
        <RadioGroup
          className="flex flex-wrap"
          aria-label={translate(
            'auto.components.automations.AutomationRunGateDecisionFields.ce38b1bd55',
            'Gate decision'
          )}
          value={decision}
          onValueChange={(value) => {
            if (value === 'approve' || value === 'reject' || value === 'escalate') {
              onDecision(value)
            }
          }}
        >
          {(['approve', 'reject', 'escalate'] as const).map((opt) => (
            <div key={opt} className="flex items-center gap-2 rounded-md border p-2">
              <RadioGroupItem
                id={`gate-decision-${opt}`}
                value={opt}
                disabled={
                  opt === 'approve' &&
                  request.kind === 'resolve_run_gate' &&
                  Boolean(request.approveUnavailableReason)
                }
                aria-label={opt}
              />
              <Label htmlFor={`gate-decision-${opt}`}>{opt}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gate-resolution-note">
          {translate(
            'auto.components.automations.AutomationRunGateDecisionFields.0409fb6731',
            'Audit note / evidence reference'
          )}
        </Label>
        <Input
          id="gate-resolution-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={translate(
            'auto.components.automations.AutomationRunGateDecisionFields.846e039360',
            'Optional audit note or receipt reference'
          )}
        />
      </div>
    </div>
  )
}
