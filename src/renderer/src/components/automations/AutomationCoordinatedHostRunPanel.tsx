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
import { translate } from '@/i18n/i18n'

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
    ? translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.0c06d1eda0',
        'Test runs require a disabled definition.'
      )
    : view && !view.actions.start.available
      ? view.actions.start.reason
      : null
  const reconcileReason =
    view && !view.actions.reconcile.available ? view.actions.reconcile.reason : null
  return (
    <section
      aria-label={
        pinned
          ? translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.9123661199',
              'Host run controls'
            )
          : translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.ef7556bba0',
              'Coordinated test runs'
            )
      }
      className="space-y-3 rounded-lg border border-border p-4 min-w-0"
    >
      <h3 className="text-sm font-medium">
        {pinned
          ? translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.52df24d43f',
              'Host-observed run and controls'
            )
          : translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.2028e358fc',
              'No-effect test runs'
            )}
      </h3>
      <p className="text-xs text-muted-foreground">
        {pinned
          ? translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.bf2744f5cb',
              'Bound to run {{value0}}. Evidence and controls come from the owning host for this exact run and its frozen definition revision.',
              { value0: selectedRunId }
            )
          : translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.895a30868b',
              'Manual isolated workers only. No live agents, publishing, or schedules. Each run keeps its saved definition revision.'
            )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pinned ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={!state.ready || state.busy || Boolean(startReason)}
            onClick={() => void state.start()}
          >
            {state.pendingStart
              ? translate(
                  'auto.components.automations.AutomationCoordinatedHostRunPanel.14ece0f19f',
                  'Recover original test start'
                )
              : translate(
                  'auto.components.automations.AutomationCoordinatedHostRunPanel.fbf7305e30',
                  'Start no-effect test run'
                )}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={state.busy} onClick={state.refresh}>
          {pinned
            ? translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.afd872db2e',
                'Refresh run'
              )
            : translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.6d450f055c',
                'Refresh test runs'
              )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!state.ready || !view || state.busy || Boolean(reconcileReason)}
          onClick={() => void state.reconcile()}
        >
          {pinned
            ? translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.87b95d5c5b',
                'Reconcile run'
              )
            : translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.d1c62536a6',
                'Reconcile selected test run'
              )}
        </Button>
      </div>
      {startReason && !pinned ? (
        <p className="text-xs text-muted-foreground">{startReason}</p>
      ) : null}
      {reconcileReason ? <p className="text-xs text-muted-foreground">{reconcileReason}</p> : null}
      {state.pendingStart && !pinned ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.aaf713a1c0',
            'Recovery uses submitted revision'
          )}{' '}
          {state.pendingStart.expectedDefinitionRevision}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.aaf19d5e75',
            '. Later definition edits are not part of that request.'
          )}
        </p>
      ) : null}
      {runIds.length ? (
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.3807d1b0b4',
            'Selected test run'
          )}
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
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.9abe5b0327',
            'Checking the exact submitted operation…'
          )}
        </p>
      ) : null}
      {state.notice ? (
        <p role="alert" className="text-xs text-status-warning break-words">
          {state.notice}
        </p>
      ) : null}
      {!state.ready && !state.notice && !state.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.c75ac07ab9',
            'Checking host availability…'
          )}
        </p>
      ) : null}
      {unconfirmed ? (
        <p role="alert" className="text-xs text-status-warning break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.2622aa4917',
            'An earlier'
          )}{' '}
          {unconfirmed.label}{' '}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.cea74f130c',
            'for this run was submitted without a confirmed answer ('
          )}
          {unconfirmed.detail}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.bb27818de7',
            '). Its effect is unknown.'
          )}
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
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.cde9ab909a',
              'Ask host about this request'
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunPanel.e0870c1d3a',
              'Resends the identical request. The host answers whether it was already recorded and records it at most once.'
            )}
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
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunPanel.fdaf762a3c',
            'Frozen definition details are unavailable until matching run history is refreshed.'
          )}
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
                      name={translate(
                        'auto.components.automations.AutomationCoordinatedHostRunPanel.790ed0c96c',
                        'Report under review'
                      )}
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
              translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.e798fe5bac',
                'Authority unavailable'
              ),
            automationRunId:
              pending?.candidate?.base.automationRunId ?? view.inspection.automationRunId,
            orchestrationRunId:
              pending?.candidate?.base.orchestrationRunId ?? view.inspection.orchestrationRunId,
            definitionRevision:
              pending?.candidate?.base.definitionRevision ?? view.inspection.definitionRevision,
            currentAutomationRevision:
              props.automation.definitionRevision ?? view.inspection.definitionRevision,
            workspaceLabel:
              run?.workspaceDisplayName ??
              run?.workspaceId ??
              translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.305cc3649e',
                'Not recorded'
              ),
            hostLabel:
              props.hostEntry?.label ??
              translate(
                'auto.components.automations.AutomationCoordinatedHostRunPanel.3bf43ff593',
                'the owning host'
              ),
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
