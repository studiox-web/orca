import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  AutomationRunStatus,
  CoordinatedCompletionTrust,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence,
  OutcomeFinalState,
  SemanticCompletionReceipt
} from './coordinated-automation-run-projection'

export type AutomationCompletionReceiptInspectorProps = {
  receipt: SemanticCompletionReceipt | null
  trust: CoordinatedCompletionTrust | null
  retainedEvidence: CoordinatedRunRetainedEvidence | null
  quarantine: CoordinatedRunQuarantineSummary | null
  technicalRunStatus: AutomationRunStatus
  className?: string
}

const FINAL_STATE_META: Record<
  OutcomeFinalState,
  {
    label: string
    variant: 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  completed: {
    label: 'Completed',
    variant: 'secondary',
    icon: CheckCircle2
  },
  ready_for_review: {
    label: 'Ready for review',
    variant: 'outline',
    icon: CheckCircle2
  },
  ready_to_publish: {
    label: 'Ready to publish',
    variant: 'secondary',
    icon: CheckCircle2
  },
  published_verified: {
    label: 'Published & verified',
    variant: 'secondary',
    icon: ShieldCheck
  },
  blocked: {
    label: 'Blocked',
    variant: 'outline',
    icon: AlertTriangle
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: XCircle
  },
  outcome_uncertain: {
    label: 'Outcome uncertain',
    variant: 'destructive',
    icon: ShieldAlert
  }
}

export function AutomationCompletionReceiptInspector({
  receipt,
  trust,
  retainedEvidence,
  quarantine,
  technicalRunStatus,
  className
}: AutomationCompletionReceiptInspectorProps): React.JSX.Element {
  if (quarantine) {
    return (
      <div
        role="region"
        aria-label="Semantic completion receipt inspector"
        data-testid="completion-receipt-quarantined"
        className={cn(
          'rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs',
          className
        )}
      >
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <div className="font-semibold text-destructive">
              Completion receipt rejected — Run Quarantined (fail-closed)
            </div>
            <p className="text-muted-foreground">{quarantine.reason}</p>
            <div className="font-mono text-[10px] text-muted-foreground">
              Payload digest: {quarantine.payloadDigest}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!receipt) {
    const isTechnicallyCompleted = technicalRunStatus === 'completed'
    return (
      <div
        role="region"
        aria-label="Semantic completion receipt inspector"
        data-testid="completion-receipt-empty"
        className={cn(
          'rounded-lg border p-3.5 text-xs',
          isTechnicallyCompleted
            ? 'border-status-warning-border bg-status-warning-background'
            : 'border-border bg-card/50',
          className
        )}
      >
        <div className="flex items-start gap-2">
          {isTechnicallyCompleted ? (
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-status-warning"
              aria-hidden="true"
            />
          ) : (
            <FileCheck2
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">
                {isTechnicallyCompleted
                  ? 'Unaccepted technical completion — No semantic completion receipt'
                  : 'No semantic completion receipt persisted yet'}
              </span>
              <Badge variant="outline">technical: {technicalRunStatus}</Badge>
            </div>
            <p className="text-muted-foreground">
              {isTechnicallyCompleted
                ? 'Process exited cleanly, but no host-verified SemanticCompletionReceipt was recorded. Technical exit never implies semantic acceptance.'
                : 'A coordinated run only achieves semantic acceptance after required stages, acceptance criteria, and approval gates are verified.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const stateMeta = FINAL_STATE_META[receipt.finalState]
  const StateIcon = stateMeta.icon

  return (
    <div
      role="region"
      aria-label="Semantic completion receipt inspector"
      data-testid="completion-receipt-inspector"
      className={cn('space-y-3 rounded-lg border border-border bg-card p-3.5 text-xs', className)}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <StateIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-foreground">Semantic Completion Receipt</span>
              <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
              <Badge variant="outline">Rev {receipt.identityChain.definitionRevision}</Badge>
              {receipt.selectedOutcomeItemIdentity ? (
                <Badge variant="secondary">Item: {receipt.selectedOutcomeItemIdentity}</Badge>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              Run: {receipt.identityChain.automationRunId} · Orch:{' '}
              {receipt.identityChain.orchestrationRunId} · Authority:{' '}
              {receipt.identityChain.targetExecutionAuthority}
            </p>
          </div>
        </div>

        <Badge variant="secondary">
          <ShieldCheck className="size-3" />
          {trust ? `Host-verified (${trust.authorIdentity})` : 'Receipt persisted'}
        </Badge>
      </div>

      {/* Identity Chain & Trust Metadata */}
      <div className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>
            Active Coordinator Attempt:{' '}
            <code className="font-mono text-foreground">
              {receipt.identityChain.activeAttempt.taskId} /{' '}
              {receipt.identityChain.activeAttempt.dispatchId}
            </code>
          </span>
          <span>
            Frozen Digest:{' '}
            <code className="font-mono text-foreground">
              {receipt.frozenConfigDigest.slice(0, 20)}…
            </code>
          </span>
          {trust?.productionDecision ? (
            <span>
              Production decision:{' '}
              <strong className="font-medium text-foreground">
                {trust.productionDecision.approverIdentity} ({trust.productionDecision.role})
              </strong>
            </span>
          ) : null}
        </div>
      </div>

      {/* Acceptance Criteria & Approvals Grid */}
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-background/50 p-2.5">
          <div className="mb-1.5 font-medium text-foreground">
            Acceptance Criteria ({receipt.acceptanceResults.length})
          </div>
          {receipt.acceptanceResults.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No acceptance results recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {receipt.acceptanceResults.map((res) => (
                <div
                  key={res.criterionId}
                  className="rounded border border-border/50 bg-card px-2 py-1 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-foreground">{res.criterionId}</span>
                    <Badge
                      variant={
                        res.status === 'satisfied'
                          ? 'secondary'
                          : res.status === 'waived'
                            ? 'outline'
                            : 'destructive'
                      }
                    >
                      {res.status}
                    </Badge>
                  </div>
                  {res.evidence.length > 0 ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      Evidence: {res.evidence.join(', ')}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-background/50 p-2.5">
          <div className="mb-1.5 font-medium text-foreground">
            Approvals ({receipt.approvals.length}) & Effects ({receipt.effectReceipts.length})
          </div>
          <div className="space-y-1.5">
            {receipt.approvals.map((app) => (
              <div
                key={app.approvalId}
                className="flex items-center justify-between gap-2 rounded border border-border/50 bg-card px-2 py-1 text-[11px]"
              >
                <div>
                  <span className="font-medium text-foreground">{app.role}</span>{' '}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    by {app.approverIdentity}
                  </span>
                </div>
                <Badge variant="secondary">approved</Badge>
              </div>
            ))}
            {receipt.effectReceipts.map((eff) => (
              <div
                key={`${eff.namespace ?? 'default'}:${eff.kind}:${eff.receipt}`}
                className="flex items-center justify-between gap-2 rounded border border-border/50 bg-card px-2 py-1 text-[11px]"
              >
                <span className="font-mono text-foreground">
                  {eff.namespace ? `${eff.namespace}:` : ''}
                  {eff.kind}
                </span>
                <Badge variant="outline">
                  {eff.status}: {eff.receipt}
                </Badge>
              </div>
            ))}
            {receipt.approvals.length === 0 && receipt.effectReceipts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No approvals or external effect receipts recorded.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {receipt.unresolvedWarnings.length > 0 || retainedEvidence ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-secondary/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {receipt.unresolvedWarnings.length > 0 ? (
            <span className="text-status-warning-text">
              Warnings:{' '}
              {receipt.unresolvedWarnings.map((w) => `${w.code}: ${w.message}`).join('; ')}
            </span>
          ) : (
            <span>No unresolved warnings</span>
          )}
          {retainedEvidence ? (
            <span>
              Retained references: {retainedEvidence.minimumEvidenceReferences.length} · Children:{' '}
              {retainedEvidence.children.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
