import React from 'react'
import type {
  CoordinatedStageInspection,
  CoordinatedStagePendingApprovalView,
  CoordinatedStageReportEvidence
} from '../../../../shared/coordinated-automation-run-inspection'
import { Badge } from '@/components/ui/badge'

const DISPOSITION_COPY = {
  accepted: 'Accepted by the coordinator',
  rejected: 'Rejected by the coordinator',
  stale: 'Stale: superseded before admission',
  duplicate: 'Duplicate of an earlier report'
} as const

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
        Report evidence {evidence.kind}: {evidence.reason}
      </p>
    )
  }
  const latestDispatchId =
    stage.semantic.kind === 'available' ? stage.semantic.activeDispatchId : null
  const superseded = latestDispatchId !== null && latestDispatchId !== evidence.dispatchId
  return (
    <section
      aria-label={`${stage.name} report evidence`}
      className="space-y-1 border-t border-border pt-2 min-w-0"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={evidence.disposition === 'accepted' ? 'secondary' : 'outline'}>
          {DISPOSITION_COPY[evidence.disposition]}
        </Badge>
        <span className="text-muted-foreground">Worker reported: {evidence.outcome}</span>
      </div>
      {evidence.disposition !== 'accepted' ? (
        <p className="text-status-warning break-words">
          A worker-reported {evidence.outcome} is not semantic acceptance.
          {evidence.dispositionReason ? ` ${evidence.dispositionReason}` : ''}
        </p>
      ) : null}
      {superseded ? (
        <p className="text-status-warning break-all">
          This report is from Dispatch {evidence.dispatchId}. A newer attempt {latestDispatchId} has
          launched and has no admitted report yet.
        </p>
      ) : null}
      <p className="break-all text-muted-foreground">
        Report Dispatch {evidence.dispatchId} · digest {evidence.reportDigest}
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
      aria-label={`${name} held report`}
      className="space-y-1 border-t border-border pt-2 min-w-0"
    >
      <Badge variant="outline">Waiting for human approval</Badge>
      <p className="text-muted-foreground break-words">
        This report is held for semantic approval. No dependent stage is released by this hold.
      </p>
      {held.report.kind === 'available' ? (
        <>
          <p>Worker reported: {held.report.outcome}</p>
          <CoordinatedReportContent name={name} evidence={held.report} />
        </>
      ) : (
        <p className="text-status-warning break-words">
          Held report {held.report.kind}: {held.report.reason} Approval is unavailable.
        </p>
      )}
      <details className="break-all text-muted-foreground">
        <summary>Approval evidence details</summary>
        <p>
          Dispatch {held.dispatchId} · digest {held.reportDigest}
        </p>
        <p>Required gates: {held.gateIds.join(', ')}</p>
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
        <ul aria-label={`${name} artifacts`} className="space-y-0.5">
          {evidence.artifacts.map((artifact) => (
            <li key={`${artifact.kind}:${artifact.uri}`} className="break-all">
              {artifact.kind} · <span className="font-mono">{artifact.uri}</span> ·{' '}
              {artifact.sha256 ? (
                <span className="font-mono">{artifact.sha256}</span>
              ) : (
                'no content digest reported'
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">The report lists no artifacts.</p>
      )}
      {evidence.checks.length ? (
        <ul aria-label={`${name} checks`} className="space-y-0.5">
          {evidence.checks.map((check) => (
            <li key={`${check.namespace ?? ''}:${check.id}`} className="break-words">
              Check <span className="font-mono break-all">{check.id}</span> · {check.outcome}
              {check.evidence?.length ? ` · ${check.evidence.join('; ')}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.blockers.length ? (
        <ul aria-label={`${name} blockers`} className="space-y-0.5 text-status-warning">
          {evidence.blockers.map((blocker) => (
            <li key={`${blocker.code}:${blocker.message}`} className="break-words">
              Blocker {blocker.code}: {blocker.message}
              {blocker.resolvableBy ? ` · resolvable by ${blocker.resolvableBy}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
