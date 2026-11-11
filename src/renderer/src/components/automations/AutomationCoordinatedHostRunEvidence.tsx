import React from 'react'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { AutomationCompletionReceiptInspector } from './AutomationCompletionReceiptInspector'
import {
  CoordinatedHostRunControls,
  CoordinatedHostStageActions,
  type CoordinatedHostRunControlBindings
} from './AutomationCoordinatedHostRunControls'
import { CoordinatedHostStageEvidence } from './AutomationCoordinatedHostStageEvidence'

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
              {stage.pendingApproval
                ? ' · waiting for human approval'
                : inspection.activeStageIds.includes(stage.childDefinitionId)
                  ? ' · attempt open'
                  : ''}
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
              {stage.pendingApproval
                ? 'waiting for human approval'
                : stage.semantic.kind === 'available'
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
                      Attempt {attempt.attemptNumber} · {attempt.kind} ·{' '}
                      {stage.pendingApproval?.dispatchId === attempt.dispatchId
                        ? 'awaiting human approval'
                        : attempt.status}{' '}
                      · Dispatch {attempt.dispatchId ?? 'not bound'}
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
