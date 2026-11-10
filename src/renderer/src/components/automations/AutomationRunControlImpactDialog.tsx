import React, { useState } from 'react'
import { AlertTriangle, RotateCcw, ShieldCheck, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type {
  ProjectedCoordinatedRun,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

export type RunControlActionRequest =
  | { kind: 'stop' }
  | { kind: 'retry'; stage: ProjectedCoordinatedStage }
  | { kind: 'resolve_gate'; stage: ProjectedCoordinatedStage; gateId: string }

type AutomationRunControlImpactDialogProps = {
  request: RunControlActionRequest | null
  projectedRun: ProjectedCoordinatedRun
  onClose: () => void
  onConfirmStop: () => void
  onConfirmRetry: (stage: ProjectedCoordinatedStage) => void
  onConfirmResolveGate: (
    stage: ProjectedCoordinatedStage,
    gateId: string,
    decision: 'approve' | 'reject' | 'escalate',
    note: string
  ) => void
}

export function AutomationRunControlImpactDialog({
  request,
  projectedRun,
  onClose,
  onConfirmStop,
  onConfirmRetry,
  onConfirmResolveGate
}: AutomationRunControlImpactDialogProps): React.JSX.Element {
  const [gateDecision, setGateDecision] = useState<'approve' | 'reject' | 'escalate'>('approve')
  const [gateNote, setGateNote] = useState('')

  const canExecute =
    request?.kind === 'stop'
      ? projectedRun.stopEligibility.canStop
      : request?.kind === 'retry'
        ? request.stage.retryEligibility.canRetry
        : request?.kind === 'resolve_gate'
          ? request.stage.gateResolutionEligibility.canResolve
          : false

  const unavailableReason =
    request?.kind === 'stop'
      ? projectedRun.stopEligibility.reason
      : request?.kind === 'retry'
        ? request.stage.retryEligibility.reason
        : request?.kind === 'resolve_gate'
          ? request.stage.gateResolutionEligibility.reason
          : null

  const handleConfirm = (): void => {
    if (!request || !canExecute) {
      return
    }
    if (request.kind === 'stop') {
      onConfirmStop()
      onClose()
      return
    }
    if (request.kind === 'retry') {
      onConfirmRetry(request.stage)
      onClose()
      return
    }
    onConfirmResolveGate(request.stage, request.gateId, gateDecision, gateNote.trim())
    setGateNote('')
    onClose()
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            {request?.kind === 'stop' ? (
              <>
                <Square className="mr-2 size-4 text-destructive" aria-hidden="true" />
                <span>
                  {translate(
                    'auto.components.automations.runPanel.stopImpactTitle',
                    'Stop Coordinated Run — Impact Preview'
                  )}
                </span>
              </>
            ) : request?.kind === 'retry' ? (
              <>
                <RotateCcw className="mr-2 size-4 text-foreground" aria-hidden="true" />
                <span>
                  {translate(
                    'auto.components.automations.runPanel.retryImpactTitle',
                    'Retry Worker Stage — Impact Preview'
                  )}
                </span>
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 size-4 text-foreground" aria-hidden="true" />
                <span>
                  {translate(
                    'auto.components.automations.runPanel.resolveGateImpactTitle',
                    'Resolve Stage Gate — Impact Preview'
                  )}
                </span>
              </>
            )}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-xs text-muted-foreground">
              {/* Authority & Scope Summary */}
              <div
                className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3 text-2xs"
                data-testid="run-control-impact-scope"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tracking-wider text-muted-foreground uppercase">
                    Target Scope & Authority
                  </span>
                  <Badge variant="outline">{projectedRun.targetExecutionAuthority}</Badge>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <div>
                    <span>Run ID: </span>
                    <span className="font-mono text-foreground">
                      {projectedRun.automationRunId}
                    </span>
                  </div>
                  <div>
                    <span>Orchestration Run: </span>
                    <span className="font-mono text-foreground">
                      {projectedRun.orchestrationRunId ?? 'Not materialized'}
                    </span>
                  </div>
                  <div>
                    <span>Frozen Revision: </span>
                    <span className="font-mono text-foreground">
                      Rev {projectedRun.definitionRevision}
                    </span>
                  </div>
                  <div>
                    <span>Workspace: </span>
                    <span className="font-mono text-foreground">{projectedRun.workspaceLabel}</span>
                  </div>
                </div>
              </div>

              {request?.kind === 'stop' ? (
                <div className="space-y-1.5 text-xs text-foreground">
                  <p>
                    Stopping this run halts active and queued Task dispatches for{' '}
                    <span className="font-mono">{projectedRun.automationRunId}</span> on{' '}
                    <span className="font-mono">{projectedRun.hostLabel}</span>.
                  </p>
                  <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
                    Definition isolation: Parent schedule, enablement, and reusable child worker
                    definitions (Rev {projectedRun.currentAutomationRevision}) remain unchanged.
                  </p>
                </div>
              ) : null}

              {request?.kind === 'retry' ? (
                <div className="space-y-2 text-xs text-foreground">
                  <div className="space-y-1 rounded border border-border/50 bg-background p-2.5 text-2xs">
                    <div>
                      <span className="text-muted-foreground">Stage: </span>
                      <span className="font-medium">{request.stage.name}</span>{' '}
                      <span className="font-mono text-3xs text-muted-foreground">
                        ({request.stage.childDefinitionId})
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reused Native Task: </span>
                      <span className="font-mono">{request.stage.taskId ?? 'None'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retry Of Dispatch: </span>
                      <span className="font-mono">
                        {request.stage.retryEligibility.retryOfDispatchId ?? 'None'}
                      </span>
                    </div>
                  </div>
                  <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
                    Definition isolation: Retrying reuses Task{' '}
                    <span className="font-mono">{request.stage.taskId}</span> and creates a new
                    Dispatch attempt against frozen Rev {projectedRun.definitionRevision}. It never
                    mutates the reusable child worker definition.
                  </p>
                </div>
              ) : null}

              {request?.kind === 'resolve_gate' ? (
                <div className="space-y-3 text-xs text-foreground">
                  <div className="space-y-1 rounded border border-border/50 bg-background p-2.5 text-2xs">
                    <div>
                      <span className="text-muted-foreground">Gate ID: </span>
                      <span className="font-mono font-medium">{request.gateId}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Stage Scope: </span>
                      <span className="font-mono">
                        {request.stage.childDefinitionId} / {request.stage.taskId ?? 'no-task'} /{' '}
                        {request.stage.activeDispatchId ?? 'no-dispatch'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Decision</Label>
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="radiogroup"
                      aria-label="Gate decision"
                    >
                      {(['approve', 'reject', 'escalate'] as const).map((opt) => (
                        <Button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={gateDecision === opt}
                          variant={gateDecision === opt ? 'secondary' : 'outline'}
                          size="xs"
                          onClick={() => setGateDecision(opt)}
                        >
                          {opt}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="gate-resolution-note">Audit note / evidence reference</Label>
                    <Input
                      id="gate-resolution-note"
                      value={gateNote}
                      onChange={(e) => setGateNote(e.target.value)}
                      placeholder="Optional audit note or receipt reference"
                    />
                  </div>
                </div>
              ) : null}

              {!canExecute && unavailableReason ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-background p-2.5 text-2xs text-status-warning-text"
                  data-testid="run-control-unavailable-reason"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{unavailableReason}</span>
                </div>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {translate('auto.components.automations.workers.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={request?.kind === 'stop' ? 'destructive' : 'default'}
            size="sm"
            disabled={!canExecute}
            data-testid="confirm-run-control-action"
            onClick={handleConfirm}
          >
            {request?.kind === 'stop'
              ? 'Confirm Stop Run'
              : request?.kind === 'retry'
                ? 'Confirm Retry Stage'
                : 'Confirm Gate Decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
