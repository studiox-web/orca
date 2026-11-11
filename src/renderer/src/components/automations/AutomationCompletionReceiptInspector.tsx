import { receiptStateMetadata } from './coordinated-run-status-metadata'
import React from 'react'
import { AlertTriangle, FileCheck2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  AutomationRunStatus,
  CoordinatedCompletionTrust,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence,
  SemanticCompletionReceipt
} from './coordinated-automation-run-projection'
import { translate } from '@/i18n/i18n'

export type AutomationCompletionReceiptInspectorProps = {
  receipt: SemanticCompletionReceipt | null
  trust: CoordinatedCompletionTrust | null
  retainedEvidence: CoordinatedRunRetainedEvidence | null
  quarantine: CoordinatedRunQuarantineSummary | null
  technicalRunStatus: AutomationRunStatus
  className?: string
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
        aria-label={translate(
          'auto.components.automations.AutomationCompletionReceiptInspector.9c95cc0bec',
          'Semantic completion receipt inspector'
        )}
        data-testid="completion-receipt-quarantined"
        className={cn(
          'rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs',
          className
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <div className="font-semibold text-destructive">
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.47ce4d2871',
                'Completion receipt rejected — Run Quarantined (fail-closed)'
              )}
            </div>
            <p className="text-muted-foreground">{quarantine.reason}</p>
            <div className="font-mono text-3xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.b0265821d3',
                'Payload digest:'
              )}{' '}
              {quarantine.payloadDigest}
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
        aria-label={translate(
          'auto.components.automations.AutomationCompletionReceiptInspector.9c95cc0bec',
          'Semantic completion receipt inspector'
        )}
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
                  ? translate(
                      'auto.components.automations.AutomationCompletionReceiptInspector.3238506fd1',
                      'Unaccepted technical completion — No semantic completion receipt'
                    )
                  : translate(
                      'auto.components.automations.AutomationCompletionReceiptInspector.fad2c407cf',
                      'No semantic completion receipt persisted yet'
                    )}
              </span>
              <Badge variant="outline">
                {translate(
                  'auto.components.automations.AutomationCompletionReceiptInspector.02f92fc970',
                  'technical:'
                )}{' '}
                {technicalRunStatus}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {isTechnicallyCompleted
                ? translate(
                    'auto.components.automations.AutomationCompletionReceiptInspector.b9bca6a06a',
                    'Process exited cleanly, but no host-verified SemanticCompletionReceipt was recorded. Technical exit never implies semantic acceptance.'
                  )
                : translate(
                    'auto.components.automations.AutomationCompletionReceiptInspector.a35c14f7e9',
                    'A coordinated run only achieves semantic acceptance after required stages, acceptance criteria, and approval gates are verified.'
                  )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const stateMeta = receiptStateMetadata()[receipt.finalState]
  const StateIcon = stateMeta.icon

  return (
    <div
      role="region"
      aria-label={translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.9c95cc0bec',
        'Semantic completion receipt inspector'
      )}
      data-testid="completion-receipt-inspector"
      className={cn('space-y-3 rounded-lg border border-border bg-card p-3.5 text-xs', className)}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 max-w-full items-start gap-2">
          <StateIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-foreground">
                {translate(
                  'auto.components.automations.AutomationCompletionReceiptInspector.b13ec23f5c',
                  'Semantic Completion Receipt'
                )}
              </span>
              <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
              <Badge variant="outline">
                {translate(
                  'auto.components.automations.AutomationCompletionReceiptInspector.1d4876873e',
                  'Rev'
                )}{' '}
                {receipt.identityChain.definitionRevision}
              </Badge>
              {receipt.selectedOutcomeItemIdentity ? (
                <Badge variant="secondary" className="max-w-full whitespace-normal break-all">
                  {translate(
                    'auto.components.automations.AutomationCompletionReceiptInspector.787de4e105',
                    'Item:'
                  )}{' '}
                  {receipt.selectedOutcomeItemIdentity}
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.03e41a1449',
                'Run:'
              )}{' '}
              {receipt.identityChain.automationRunId}{' '}
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.d7da9f4911',
                '· Orch:'
              )}{' '}
              {receipt.identityChain.orchestrationRunId}{' '}
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.f53c7098ba',
                '· Authority:'
              )}{' '}
              {receipt.identityChain.targetExecutionAuthority}
            </p>
          </div>
        </div>

        <Badge variant="secondary" className="max-w-full whitespace-normal break-all">
          <ShieldCheck className="size-3" />
          {trust
            ? translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.1d1897bbc4',
                'Host-verified ({{value0}})',
                { value0: trust.authorIdentity }
              )
            : translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.a8ea743e99',
                'Receipt persisted'
              )}
        </Badge>
      </div>

      {/* Identity Chain & Trust Metadata */}
      <div className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2 text-2xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>
            {translate(
              'auto.components.automations.AutomationCompletionReceiptInspector.dda14c19d1',
              'Active Coordinator Attempt:'
            )}{' '}
            <code className="font-mono text-foreground">
              {receipt.identityChain.activeAttempt.taskId} /{' '}
              {receipt.identityChain.activeAttempt.dispatchId}
            </code>
          </span>
          <span>
            {translate(
              'auto.components.automations.AutomationCompletionReceiptInspector.0f9d50cbbf',
              'Frozen Digest:'
            )}{' '}
            <code className="font-mono text-foreground">
              {receipt.frozenConfigDigest.slice(0, 20)}…
            </code>
          </span>
          {trust?.productionDecision ? (
            <span>
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.d1135b6de1',
                'Production decision:'
              )}{' '}
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
            {translate(
              'auto.components.automations.AutomationCompletionReceiptInspector.1f95ccc267',
              'Acceptance Criteria ('
            )}
            {receipt.acceptanceResults.length})
          </div>
          {receipt.acceptanceResults.length === 0 ? (
            <p className="text-2xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.69ff3724d7',
                'No acceptance results recorded.'
              )}
            </p>
          ) : (
            <div className="space-y-1.5">
              {receipt.acceptanceResults.map((res) => (
                <div
                  key={res.criterionId}
                  className="rounded border border-border/50 bg-card px-2 py-1 text-2xs"
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
                    <div className="mt-0.5 text-3xs text-muted-foreground">
                      {translate(
                        'auto.components.automations.AutomationCompletionReceiptInspector.76800c7d40',
                        'Evidence:'
                      )}{' '}
                      {res.evidence.join(', ')}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/70 bg-background/50 p-2.5">
          <div className="mb-1.5 font-medium text-foreground">
            {translate(
              'auto.components.automations.AutomationCompletionReceiptInspector.7842fefbd5',
              'Approvals ('
            )}
            {receipt.approvals.length}
            {translate(
              'auto.components.automations.AutomationCompletionReceiptInspector.eeff093af9',
              ') & Effects ('
            )}
            {receipt.effectReceipts.length})
          </div>
          <div className="space-y-1.5">
            {receipt.approvals.map((app) => (
              <div
                key={app.approvalId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-card px-2 py-1 text-2xs"
              >
                <div>
                  <span className="font-medium text-foreground">{app.role}</span>{' '}
                  <span className="font-mono text-3xs text-muted-foreground">
                    {translate(
                      'auto.components.automations.AutomationCompletionReceiptInspector.07b611b689',
                      'by'
                    )}{' '}
                    {app.approverIdentity}
                  </span>
                </div>
                <Badge variant="secondary">
                  {translate(
                    'auto.components.automations.AutomationCompletionReceiptInspector.0ea1ffd5fb',
                    'approved'
                  )}
                </Badge>
              </div>
            ))}
            {receipt.effectReceipts.map((eff) => (
              <div
                key={`${eff.namespace ?? 'default'}:${eff.kind}:${eff.receipt}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-card px-2 py-1 text-2xs"
              >
                <span className="font-mono text-foreground">
                  {eff.namespace ? `${eff.namespace}:` : ''}
                  {eff.kind}
                </span>
                <Badge variant="outline" className="max-w-full whitespace-normal break-all">
                  {eff.status}: {eff.receipt}
                </Badge>
              </div>
            ))}
            {receipt.approvals.length === 0 && receipt.effectReceipts.length === 0 ? (
              <p className="text-2xs text-muted-foreground">
                {translate(
                  'auto.components.automations.AutomationCompletionReceiptInspector.8152158e73',
                  'No approvals or external effect receipts recorded.'
                )}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {receipt.unresolvedWarnings.length > 0 || retainedEvidence ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-secondary/20 px-2.5 py-1.5 text-2xs text-muted-foreground">
          {receipt.unresolvedWarnings.length > 0 ? (
            <span className="text-status-warning-text">
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.5e6d9f9305',
                'Warnings:'
              )}{' '}
              {receipt.unresolvedWarnings.map((w) => `${w.code}: ${w.message}`).join('; ')}
            </span>
          ) : (
            <span>
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.b9e5e59200',
                'No unresolved warnings'
              )}
            </span>
          )}
          {retainedEvidence ? (
            <span>
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.2d24a935cb',
                'Retained references:'
              )}{' '}
              {retainedEvidence.minimumEvidenceReferences.length}{' '}
              {translate(
                'auto.components.automations.AutomationCompletionReceiptInspector.ec6d837a6d',
                '· Children:'
              )}{' '}
              {retainedEvidence.children.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
