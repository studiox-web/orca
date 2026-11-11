import React from 'react'
import type {
  CoordinatedStageInspection,
  CoordinatedStagePendingApprovalView,
  CoordinatedStageReportEvidence
} from '../../../../shared/coordinated-automation-run-inspection'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'

function dispositionCopy() {
  return {
    accepted: translate(
      'auto.components.automations.AutomationCoordinatedHostStageEvidence.b2d32e1015',
      'Accepted by the coordinator'
    ),
    rejected: translate(
      'auto.components.automations.AutomationCoordinatedHostStageEvidence.2949d09531',
      'Rejected by the coordinator'
    ),
    stale: translate(
      'auto.components.automations.AutomationCoordinatedHostStageEvidence.5462e4e159',
      'Stale: superseded before admission'
    ),
    duplicate: translate(
      'auto.components.automations.AutomationCoordinatedHostStageEvidence.9d86e697b4',
      'Duplicate of an earlier report'
    )
  } as const
}

/**
 * The stage's latest admitted worker report as the host re-read it. Report text is worker-authored
 * and rendered as plain text only; artifact URIs are shown, never linked or opened.
 */
export function CoordinatedHostStageEvidence({
  stage
}: {
  stage: CoordinatedStageInspection
}): React.JSX.Element {
  if (stage.pendingApproval) {
    return <CoordinatedHeldReport name={stage.name} held={stage.pendingApproval} />
  }
  const { evidence } = stage
  if (evidence.kind !== 'available') {
    return (
      <p className="text-muted-foreground break-words">
        {translate(
          'auto.components.automations.AutomationCoordinatedHostStageEvidence.edb302e34e',
          'Report evidence'
        )}{' '}
        {evidence.kind}: {evidence.reason}
      </p>
    )
  }
  const latestDispatchId =
    stage.semantic.kind === 'available' ? stage.semantic.activeDispatchId : null
  const superseded = latestDispatchId !== null && latestDispatchId !== evidence.dispatchId
  return (
    <section
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedHostStageEvidence.6591e14652',
        '{{value0}} report evidence',
        { value0: stage.name }
      )}
      className="space-y-1 border-t border-border pt-2 min-w-0"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={evidence.disposition === 'accepted' ? 'secondary' : 'outline'}>
          {dispositionCopy()[evidence.disposition]}
        </Badge>
        <span className="text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.79b6395ec2',
            'Worker reported:'
          )}{' '}
          {evidence.outcome}
        </span>
      </div>
      {evidence.disposition !== 'accepted' ? (
        <p className="text-status-warning break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.7b659a7b47',
            'A worker-reported'
          )}{' '}
          {evidence.outcome}{' '}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.2ed0495483',
            'is not semantic acceptance.'
          )}
          {evidence.dispositionReason ? ` ${evidence.dispositionReason}` : ''}
        </p>
      ) : null}
      {superseded ? (
        <p className="text-status-warning break-all">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.95e66904bd',
            'This report is from Dispatch'
          )}{' '}
          {evidence.dispatchId}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.9dfb3730bf',
            '. A newer attempt'
          )}{' '}
          {latestDispatchId}{' '}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.d5b87d69e9',
            'has launched and has no admitted report yet.'
          )}
        </p>
      ) : null}
      <p className="break-all text-muted-foreground">
        {translate(
          'auto.components.automations.AutomationCoordinatedHostStageEvidence.bc6c699b71',
          'Report Dispatch'
        )}{' '}
        {evidence.dispatchId}{' '}
        {translate(
          'auto.components.automations.AutomationCoordinatedHostStageEvidence.7ddf236cbb',
          '· digest'
        )}{' '}
        {evidence.reportDigest}
      </p>
      <CoordinatedReportContent name={stage.name} evidence={evidence} />
    </section>
  )
}

export function CoordinatedHeldReport({
  name,
  held
}: {
  name: string
  held: CoordinatedStagePendingApprovalView
}): React.JSX.Element {
  return (
    <section
      aria-label={translate(
        'auto.components.automations.AutomationCoordinatedHostStageEvidence.8a12a3c52b',
        '{{value0}} held report',
        { value0: name }
      )}
      className="space-y-1 border-t border-border pt-2 min-w-0"
    >
      <Badge variant="outline">
        {translate(
          'auto.components.automations.AutomationCoordinatedHostStageEvidence.d3a3384e2b',
          'Waiting for human approval'
        )}
      </Badge>
      <p className="text-muted-foreground break-words">
        {translate(
          'auto.components.automations.AutomationCoordinatedHostStageEvidence.c59a00bb0f',
          'This report is held for semantic approval. No dependent stage is released by this hold.'
        )}
      </p>
      {held.report.kind === 'available' ? (
        <>
          <p>
            {translate(
              'auto.components.automations.AutomationCoordinatedHostStageEvidence.79b6395ec2',
              'Worker reported:'
            )}{' '}
            {held.report.outcome}
          </p>
          <CoordinatedReportContent name={name} evidence={held.report} />
        </>
      ) : (
        <p className="text-status-warning break-words">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.9ecb4e6b62',
            'Held report'
          )}{' '}
          {held.report.kind}: {held.report.reason}{' '}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.69f14496e9',
            'Approval is unavailable.'
          )}
        </p>
      )}
      <details className="break-all text-muted-foreground">
        <summary>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.a9d867b26e',
            'Approval evidence details'
          )}
        </summary>
        <p>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.f33cfd5d9e',
            'Dispatch'
          )}{' '}
          {held.dispatchId}{' '}
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.7ddf236cbb',
            '· digest'
          )}{' '}
          {held.reportDigest}
        </p>
        <p>
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.cf9039e7a7',
            'Required gates:'
          )}{' '}
          {held.gateIds.join(', ')}
        </p>
      </details>
    </section>
  )
}

function CoordinatedReportContent({
  name,
  evidence
}: {
  name: string
  evidence: Pick<CoordinatedStageReportEvidence, 'summary' | 'artifacts' | 'checks' | 'blockers'>
}): React.JSX.Element {
  return (
    <>
      <p className="whitespace-pre-wrap break-words">{evidence.summary}</p>
      {evidence.artifacts.length ? (
        <ul
          aria-label={translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.58f7f52f22',
            '{{value0}} artifacts',
            { value0: name }
          )}
          className="space-y-0.5"
        >
          {evidence.artifacts.map((artifact) => (
            <li key={`${artifact.kind}:${artifact.uri}`} className="break-all">
              {artifact.kind} · <span className="font-mono">{artifact.uri}</span> ·{' '}
              {artifact.sha256 ? (
                <span className="font-mono">{artifact.sha256}</span>
              ) : (
                translate(
                  'auto.components.automations.AutomationCoordinatedHostStageEvidence.74c386992e',
                  'no content digest reported'
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.503d11623a',
            'The report lists no artifacts.'
          )}
        </p>
      )}
      {evidence.checks.length ? (
        <ul
          aria-label={translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.ed0ca90fb9',
            '{{value0}} checks',
            { value0: name }
          )}
          className="space-y-0.5"
        >
          {evidence.checks.map((check) => (
            <li key={`${check.namespace ?? ''}:${check.id}`} className="break-words">
              {translate(
                'auto.components.automations.AutomationCoordinatedHostStageEvidence.9f12d5b91e',
                'Check'
              )}{' '}
              <span className="font-mono break-all">{check.id}</span> · {check.outcome}
              {check.evidence?.length ? ` · ${check.evidence.join('; ')}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.blockers.length ? (
        <ul
          aria-label={translate(
            'auto.components.automations.AutomationCoordinatedHostStageEvidence.d0089b89d8',
            '{{value0}} blockers',
            { value0: name }
          )}
          className="space-y-0.5 text-status-warning"
        >
          {evidence.blockers.map((blocker) => (
            <li key={`${blocker.code}:${blocker.message}`} className="break-words">
              {translate(
                'auto.components.automations.AutomationCoordinatedHostStageEvidence.6915a2238b',
                'Blocker'
              )}{' '}
              {blocker.code}: {blocker.message}
              {blocker.resolvableBy
                ? translate(
                    'auto.components.automations.AutomationCoordinatedHostStageEvidence.068a18b39e',
                    ' · resolvable by {{value0}}',
                    { value0: blocker.resolvableBy }
                  )
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
