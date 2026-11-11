import React from 'react'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { AutomationCompletionReceiptInspector } from './AutomationCompletionReceiptInspector'
import {
  CoordinatedHostRunControls,
  CoordinatedHostStageActions,
  type CoordinatedHostRunControlBindings
} from './AutomationCoordinatedHostRunControls'
import { CoordinatedHostStageEvidence } from './AutomationCoordinatedHostStageEvidence'
import { translate } from '@/i18n/i18n'

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
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.9b300904d3',
              'Runtime:'
            )}{' '}
          </dt>
          <dd className="inline">{view.runtimeId}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.27b1017297',
              'Parent run:'
            )}{' '}
          </dt>
          <dd className="inline">{inspection.automationRunId}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.cae982227e',
              'Orchestration run:'
            )}{' '}
          </dt>
          <dd className="inline">
            {inspection.orchestrationRunId ??
              translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.fb55fa31b0',
                'Unavailable'
              )}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.69b3ca2125',
              'Frozen revision:'
            )}{' '}
          </dt>
          <dd className="inline">{inspection.definitionRevision}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.298bac65e9',
              'Technical run status:'
            )}{' '}
          </dt>
          <dd className="inline">{inspection.runStatus}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.6cbcad3b90',
              'Semantic receipt:'
            )}{' '}
          </dt>
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
      <ul
        className="space-y-2"
        aria-label={translate(
          'auto.components.automations.AutomationCoordinatedHostRunEvidence.3a0d30800c',
          'Host-observed stages'
        )}
      >
        {inspection.stages.map((stage) => (
          <li
            key={stage.childDefinitionId}
            className="space-y-1 rounded-md border border-border p-3 text-xs break-words"
          >
            <h4 className="font-medium">
              {stage.name} · {stage.role}
              {stage.pendingApproval
                ? translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.384aa49ab6',
                    '· waiting for human approval'
                  )
                : inspection.activeStageIds.includes(stage.childDefinitionId)
                  ? translate(
                      'auto.components.automations.AutomationCoordinatedHostRunEvidence.8b0b61e3f2',
                      '· attempt open'
                    )
                  : ''}
            </h4>
            <p className="break-all">
              {translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.a1bd7fcc82',
                'Child'
              )}{' '}
              {stage.childDefinitionId}{' '}
              {translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.78c63b4acc',
                '· Task'
              )}{' '}
              {stage.taskId ??
                translate(
                  'auto.components.automations.AutomationCoordinatedHostRunEvidence.10955ebcd6',
                  'not materialized'
                )}{' '}
              {translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.c34b9c223e',
                '· Mapped Dispatch'
              )}{' '}
              {stage.mappedDispatchId ??
                translate(
                  'auto.components.automations.AutomationCoordinatedHostRunEvidence.10955ebcd6',
                  'not materialized'
                )}
            </p>
            <p>
              {translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.5a0743d860',
                'Technical:'
              )}{' '}
              {stage.native.kind === 'available'
                ? `${stage.native.taskStatus} · ${stage.native.latestDispatchStatus ?? translate('auto.components.automations.AutomationCoordinatedHostRunEvidence.f986ce2832', 'No Dispatch status')}`
                : `${stage.native.kind}: ${stage.native.reason}`}
            </p>
            {stage.native.kind === 'available' ? (
              <p className="break-all">
                {translate(
                  'auto.components.automations.AutomationCoordinatedHostRunEvidence.fe9a07afb8',
                  'Latest native Dispatch:'
                )}{' '}
                {stage.native.latestDispatchId ??
                  translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.f8f9f1bfba',
                    'None'
                  )}
              </p>
            ) : null}
            <p>
              {translate(
                'auto.components.automations.AutomationCoordinatedHostRunEvidence.d3ff89a3fb',
                'Semantic acceptance:'
              )}{' '}
              {stage.pendingApproval
                ? translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.4b8870be98',
                    'waiting for human approval'
                  )
                : stage.semantic.kind === 'available'
                  ? stage.semantic.status
                  : `${stage.semantic.kind}: ${stage.semantic.reason}`}
            </p>
            {stage.semantic.kind === 'available' ? (
              <>
                <p className="break-all">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.4dcde4c98b',
                    'Latest launched Dispatch:'
                  )}{' '}
                  {stage.semantic.activeDispatchId ??
                    translate(
                      'auto.components.automations.AutomationCoordinatedHostRunEvidence.f8f9f1bfba',
                      'None'
                    )}{' '}
                  {translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.599b9b6bdd',
                    '· Accepted Dispatch:'
                  )}{' '}
                  {stage.semantic.acceptedDispatchId ??
                    translate(
                      'auto.components.automations.AutomationCoordinatedHostRunEvidence.feebee1110',
                      'None recorded'
                    )}{' '}
                  {translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.05f3a3cedb',
                    '· Admitted attempts:'
                  )}{' '}
                  {stage.semantic.attempts}
                </p>
                {stage.semantic.lastError ? (
                  <p className="text-status-warning">{stage.semantic.lastError}</p>
                ) : null}
                <ol
                  aria-label={translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.a3f1237e14',
                    '{{value0}} attempts',
                    { value0: stage.name }
                  )}
                  className="space-y-1"
                >
                  {stage.semantic.lineage.map((attempt) => (
                    <li key={attempt.attemptNumber} className="break-all">
                      {translate(
                        'auto.components.automations.AutomationCoordinatedHostRunEvidence.fa4add8c25',
                        'Attempt'
                      )}{' '}
                      {attempt.attemptNumber} · {attempt.kind} ·{' '}
                      {stage.pendingApproval?.dispatchId === attempt.dispatchId
                        ? translate(
                            'auto.components.automations.AutomationCoordinatedHostRunEvidence.adf79b13db',
                            'awaiting human approval'
                          )
                        : attempt.status}{' '}
                      {translate(
                        'auto.components.automations.AutomationCoordinatedHostRunEvidence.c4e6ea96d1',
                        '· Dispatch'
                      )}{' '}
                      {attempt.dispatchId ??
                        translate(
                          'auto.components.automations.AutomationCoordinatedHostRunEvidence.3c2e32b7e5',
                          'not bound'
                        )}
                      {attempt.retryOfDispatchId
                        ? translate(
                            'auto.components.automations.AutomationCoordinatedHostRunEvidence.e9a89fbc5b',
                            ' · retry of {{value0}}',
                            { value0: attempt.retryOfDispatchId }
                          )
                        : ''}
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
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.977accf68f',
              'Observed generation'
            )}{' '}
            {inspection.progress.generation}
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.d42e484d40',
              ', sequence'
            )}{' '}
            {inspection.progress.sequence}
            {translate(
              'auto.components.automations.AutomationCoordinatedHostRunEvidence.c705396437',
              '; reports'
            )}{' '}
            {inspection.progress.reportCount}.
          </p>
          {inspection.progress.halt ? (
            <p className="text-status-warning">
              {inspection.progress.halt.state}: {inspection.progress.halt.reason}
            </p>
          ) : null}
          {inspection.progress.escalations.map((item) => (
            <p key={item.key} className="text-status-warning">
              {item.code}: {item.detail}
              {item.requiresHumanDecision
                ? translate(
                    'auto.components.automations.AutomationCoordinatedHostRunEvidence.43b8657613',
                    '· Human decision required'
                  )
                : ''}
            </p>
          ))}
          {inspection.progress.effects.map((effect) => (
            <p key={effect.effectId}>
              {effect.kind}: {effect.status} ·{' '}
              {effect.receipt ??
                translate(
                  'auto.components.automations.AutomationCoordinatedHostRunEvidence.0fbd792b62',
                  'No effect receipt'
                )}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunEvidence.3eeae3694b',
            'Progress'
          )}{' '}
          {inspection.progress.kind}: {inspection.progress.reason}
        </p>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunEvidence.8f107d8355',
            'Findings unavailable:'
          )}{' '}
          {view.findings.reason}
        </p>
        <p>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunEvidence.2f05aaa8d6',
            'Limits unavailable:'
          )}{' '}
          {view.limits.reason}
        </p>
        <p>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostRunEvidence.16e158696d',
            'Spend, elapsed time and live questions are not supplied by this API.'
          )}
        </p>
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
