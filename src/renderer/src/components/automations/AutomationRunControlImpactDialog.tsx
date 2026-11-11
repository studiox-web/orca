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
import { AutomationRunGateDecisionFields } from './AutomationRunGateDecisionFields'
import { translate } from '@/i18n/i18n'
import type {
  ProjectedCoordinatedRun,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

type ControlEligibility = { canResolve: boolean; reason: string | null }

/** The frozen run scope an impact preview names; satisfied by both the projection and host views. */
export type RunControlImpactRun = Pick<
  ProjectedCoordinatedRun,
  | 'targetExecutionAuthority'
  | 'automationRunId'
  | 'orchestrationRunId'
  | 'definitionRevision'
  | 'currentAutomationRevision'
  | 'workspaceLabel'
  | 'hostLabel'
  | 'stopEligibility'
>

export type RunControlImpactStage = {
  name: string
  childDefinitionId: string
  taskId: string | null
  /** Optional on non-stage decision previews. */
  activeDispatchId?: string | null
  retryEligibility: { canRetry: boolean; reason: string | null; retryOfDispatchId: string | null }
  gateResolutionEligibility: ControlEligibility
}

export type RunControlActionRequest<S extends RunControlImpactStage = ProjectedCoordinatedStage> =
  | { kind: 'stop' }
  | { kind: 'retry'; stage: S }
  | { kind: 'resolve_gate'; stage: S; gateId: string }
  /** An exact host-scoped stage, parent, or escalation decision. */
  | {
      kind: 'resolve_run_gate'
      gateId: string
      scopeLabel: string
      eligibility: ControlEligibility
      /** Set when the host refuses `approve` for this gate; other decisions stay submittable. */
      approveUnavailableReason?: string | null
      /** What a decision in this scope does and does not change. */
      impactNote?: string
      evidence?: React.ReactNode
    }

type AutomationRunControlImpactDialogProps<S extends RunControlImpactStage> = {
  request: RunControlActionRequest<S> | null
  projectedRun: RunControlImpactRun
  isPending?: boolean
  onClose: () => void
  onConfirmStop: () => void
  onConfirmRetry: (stage: S) => void
  onConfirmResolveGate: (
    stage: S | null,
    gateId: string,
    decision: 'approve' | 'reject' | 'escalate',
    note: string
  ) => void
}

export function AutomationRunControlImpactDialog<
  S extends RunControlImpactStage = ProjectedCoordinatedStage
>({
  request,
  projectedRun,
  isPending = false,
  onClose,
  onConfirmStop,
  onConfirmRetry,
  onConfirmResolveGate
}: AutomationRunControlImpactDialogProps<S>): React.JSX.Element {
  const [gateDecision, setGateDecision] = useState<'approve' | 'reject' | 'escalate'>('approve')
  const [gateNote, setGateNote] = useState('')

  const gateEligibility =
    request?.kind === 'resolve_gate'
      ? request.stage.gateResolutionEligibility
      : request?.kind === 'resolve_run_gate'
        ? request.eligibility
        : null

  const approveRefusal =
    request?.kind === 'resolve_run_gate' && gateDecision === 'approve'
      ? (request.approveUnavailableReason ?? null)
      : null

  const canExecute =
    request?.kind === 'stop'
      ? projectedRun.stopEligibility.canStop
      : request?.kind === 'retry'
        ? request.stage.retryEligibility.canRetry
        : (gateEligibility?.canResolve ?? false) && approveRefusal === null

  const unavailableReason =
    request?.kind === 'stop'
      ? projectedRun.stopEligibility.reason
      : request?.kind === 'retry'
        ? request.stage.retryEligibility.reason
        : (gateEligibility?.reason ?? approveRefusal)

  const handleConfirm = (): void => {
    if (!request || !canExecute || isPending) {
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
    onConfirmResolveGate(
      request.kind === 'resolve_gate' ? request.stage : null,
      request.gateId,
      gateDecision,
      gateNote.trim()
    )
    setGateNote('')
    onClose()
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" scrollable className="max-w-lg">
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
                  {request?.kind === 'resolve_run_gate'
                    ? translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.2204045196',
                        'Resolve Run Decision — Impact Preview'
                      )
                    : translate(
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
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.2e2e1312e1',
                      'Target Scope & Authority'
                    )}
                  </span>
                  <Badge variant="outline">{projectedRun.targetExecutionAuthority}</Badge>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <div>
                    <span>
                      {translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.a3287e4685',
                        'Run ID:'
                      )}{' '}
                    </span>
                    <span className="font-mono text-foreground">
                      {projectedRun.automationRunId}
                    </span>
                  </div>
                  <div>
                    <span>
                      {translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.604f00e4c6',
                        'Orchestration Run:'
                      )}{' '}
                    </span>
                    <span className="font-mono text-foreground">
                      {projectedRun.orchestrationRunId ??
                        translate(
                          'auto.components.automations.AutomationRunControlImpactDialog.6200fd5043',
                          'Not materialized'
                        )}
                    </span>
                  </div>
                  <div>
                    <span>
                      {translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.1557ffd756',
                        'Frozen Revision:'
                      )}{' '}
                    </span>
                    <span className="font-mono text-foreground">
                      {translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.8a766cf23d',
                        'Rev'
                      )}{' '}
                      {projectedRun.definitionRevision}
                    </span>
                  </div>
                  <div>
                    <span>
                      {translate(
                        'auto.components.automations.AutomationRunControlImpactDialog.d5bf9e2ba2',
                        'Workspace:'
                      )}{' '}
                    </span>
                    <span className="font-mono text-foreground">{projectedRun.workspaceLabel}</span>
                  </div>
                </div>
              </div>

              {request?.kind === 'stop' ? (
                <div className="space-y-1.5 text-xs text-foreground">
                  <p>
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.2cbfc9a9a9',
                      'Records a stop request for'
                    )}{' '}
                    <span className="font-mono">{projectedRun.automationRunId}</span>{' '}
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.632dd7c025',
                      'on'
                    )}{' '}
                    <span className="font-mono">{projectedRun.hostLabel}</span>
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.9c0768bf7c',
                      '. The host starts no further Dispatches and asks running workers to cancel.'
                    )}
                  </p>
                  <p>
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.6c5bf66212',
                      'A stop request is not proof that a worker exited. The run stays uncertain until the host has exit evidence, and effects already in flight are not undone.'
                    )}
                  </p>
                  <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.0985f9281f',
                      'Definition isolation: Parent schedule, enablement, and reusable child worker definitions (Rev'
                    )}{' '}
                    {projectedRun.currentAutomationRevision}
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.d78a26937f',
                      ') remain unchanged.'
                    )}
                  </p>
                </div>
              ) : null}

              {request?.kind === 'retry' ? (
                <div className="space-y-2 text-xs text-foreground">
                  <div className="space-y-1 rounded border border-border/50 bg-background p-2.5 text-2xs">
                    <div>
                      <span className="text-muted-foreground">
                        {translate(
                          'auto.components.automations.AutomationRunControlImpactDialog.eb7bee2599',
                          'Stage:'
                        )}{' '}
                      </span>
                      <span className="font-medium">{request.stage.name}</span>{' '}
                      <span className="font-mono text-3xs text-muted-foreground">
                        ({request.stage.childDefinitionId})
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {translate(
                          'auto.components.automations.AutomationRunControlImpactDialog.c0d4429a1f',
                          'Reused Native Task:'
                        )}{' '}
                      </span>
                      <span className="font-mono">
                        {request.stage.taskId ??
                          translate(
                            'auto.components.automations.AutomationRunControlImpactDialog.dde8465787',
                            'None'
                          )}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {translate(
                          'auto.components.automations.AutomationRunControlImpactDialog.618c29f70d',
                          'Retry Of Dispatch:'
                        )}{' '}
                      </span>
                      <span className="font-mono">
                        {request.stage.retryEligibility.retryOfDispatchId ??
                          translate(
                            'auto.components.automations.AutomationRunControlImpactDialog.dde8465787',
                            'None'
                          )}
                      </span>
                    </div>
                  </div>
                  <p className="rounded border border-border/50 bg-muted/20 p-2 text-2xs text-muted-foreground">
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.2883bb6049',
                      'Definition isolation: Retrying reuses Task'
                    )}{' '}
                    <span className="font-mono">{request.stage.taskId}</span>{' '}
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.4e6997a116',
                      'and creates a new Dispatch attempt against frozen Rev'
                    )}{' '}
                    {projectedRun.definitionRevision}
                    {translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.83199ae2c9',
                      '. It never mutates the reusable child worker definition.'
                    )}
                  </p>
                </div>
              ) : null}

              {request?.kind === 'resolve_gate' || request?.kind === 'resolve_run_gate' ? (
                <AutomationRunGateDecisionFields
                  request={request}
                  decision={gateDecision}
                  note={gateNote}
                  onDecision={setGateDecision}
                  onNote={setGateNote}
                />
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
            disabled={!canExecute || isPending}
            aria-busy={isPending}
            data-testid="confirm-run-control-action"
            onClick={handleConfirm}
          >
            {isPending
              ? translate(
                  'auto.components.automations.AutomationRunControlImpactDialog.87fb08b662',
                  'Submitting…'
                )
              : request?.kind === 'stop'
                ? translate(
                    'auto.components.automations.AutomationRunControlImpactDialog.8c9a2da719',
                    'Confirm Stop Run'
                  )
                : request?.kind === 'retry'
                  ? translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.eaeabef13f',
                      'Confirm Retry Stage'
                    )
                  : translate(
                      'auto.components.automations.AutomationRunControlImpactDialog.4dc04d862f',
                      'Confirm Gate Decision'
                    )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
