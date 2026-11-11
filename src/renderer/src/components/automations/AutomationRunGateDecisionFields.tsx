import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type {
  RunControlActionRequest,
  RunControlImpactStage
} from './AutomationRunControlImpactDialog'

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
          <span className="text-muted-foreground">Gate ID: </span>
          <span className="font-mono font-medium">{request.gateId}</span>
        </div>
        <div>
          <span className="text-muted-foreground">
            {request.kind === 'resolve_gate' ? 'Stage Scope: ' : 'Scope: '}
          </span>
          <span className="font-mono">
            {request.kind === 'resolve_run_gate'
              ? request.scopeLabel
              : `${request.stage.childDefinitionId} / ${request.stage.taskId ?? 'no-task'} / ${
                  request.stage.activeDispatchId === undefined
                    ? 'Dispatch bound by host'
                    : (request.stage.activeDispatchId ?? 'no-dispatch')
                }`}
          </span>
        </div>
      </div>

      <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
        Approve records an operator approval that the host’s acceptance checks read. Reject closes
        this gate against the stage or run. Escalate records the decision and leaves the gate
        pending. Definitions and run history are not edited.
      </p>
      {request.kind === 'resolve_run_gate' && request.impactNote ? (
        <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
          {request.impactNote}
        </p>
      ) : null}
      {request.kind === 'resolve_run_gate' ? request.evidence : null}
      <div className="space-y-2">
        <Label>Decision</Label>
        <RadioGroup
          className="flex flex-wrap"
          aria-label="Gate decision"
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
        <Label htmlFor="gate-resolution-note">Audit note / evidence reference</Label>
        <Input
          id="gate-resolution-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Optional audit note or receipt reference"
        />
      </div>
    </div>
  )
}
