import { AutomationCoordinatedAttemptHistory } from './AutomationCoordinatedAttemptHistory'
import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  HelpCircle,
  Lock,
  ShieldAlert,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type {
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'
import { translate } from '@/i18n/i18n'

type AutomationCoordinatedRunStageEvidenceProps = {
  stage: ProjectedCoordinatedStage
  onOpenAttempt: (attempt: ProjectedCoordinatedAttempt) => void
}

export function AutomationCoordinatedRunStageEvidence({
  stage,
  onOpenAttempt
}: AutomationCoordinatedRunStageEvidenceProps): React.JSX.Element {
  return (
    <div className="mt-3 space-y-2.5 text-2xs">
      {/* Pending Question Callout */}
      {stage.pendingQuestion ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-background p-2.5 text-status-warning-text"
          data-testid={`stage-pending-question-${stage.childDefinitionId}`}
        >
          <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.43ea7a1618',
                'Waiting for operator / coordinator answer'
              )}
            </div>
            <p className="mt-0.5 text-xs break-words">{stage.pendingQuestion.preview}</p>
          </div>
        </div>
      ) : null}

      {/* Uncertain External Effect Alert */}
      {stage.hasUncertainEffect ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-destructive"
          data-testid={`stage-uncertain-effect-${stage.childDefinitionId}`}
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-semibold">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.7ee0d3f453',
                'Uncertain external effect — mutation lane stopped for reconciliation'
              )}
            </div>
            <p className="text-2xs">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.bacb568c80',
                'Automatic and blind manual retries are blocked. Inspect the durable receipt and external state before resolving.'
              )}
            </p>
            {stage.effects
              .filter((e) => e.status === 'uncertain' || e.status === 'denied')
              .map((eff) => (
                <div
                  key={`${eff.namespace ?? 'default'}:${eff.kind}:${eff.status}`}
                  className="font-mono text-3xs"
                >
                  {eff.namespace ? `${eff.namespace}:` : ''}
                  {eff.kind} ({eff.status}){eff.error ? ` — ${eff.error}` : ''}
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {/* Blockers */}
      {stage.blockers.length > 0 ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive"
          data-testid={`stage-blockers-${stage.childDefinitionId}`}
        >
          {stage.blockers.map((blocker) => (
            <div
              key={`${blocker.code}:${blocker.message}`}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="font-mono font-semibold">{blocker.code}:</span>
                <span className="break-words">{blocker.message}</span>
              </div>
              {blocker.resolvableBy ? (
                <Badge variant="outline">
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.5e2d04b233',
                    'resolvable by:'
                  )}{' '}
                  {blocker.resolvableBy}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Artifacts, Checks/Findings, and Approvals Grid */}
      <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-3">
        {/* Artifacts */}
        <div
          className="min-w-0 space-y-1.5 rounded border border-border/50 bg-muted/20 p-2.5"
          data-testid={`stage-artifacts-${stage.childDefinitionId}`}
        >
          <div className="flex items-center justify-between gap-1 text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="flex items-center gap-1">
              <FileCode2 className="size-3" aria-hidden="true" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.7d29b198f0',
                'Artifacts'
              )}
            </span>
            <span>
              {stage.artifacts.length}
              {stage.requiredArtifacts.length > 0
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.7d7087e4c9',
                    '/{{value0}} req',
                    { value0: stage.requiredArtifacts.length }
                  )
                : ''}
            </span>
          </div>
          {stage.artifacts.length === 0 ? (
            <p className="text-3xs text-muted-foreground">
              {stage.requiredArtifacts.length > 0
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.f2e202f93a',
                    'Awaiting {{value0}}',
                    { value0: stage.requiredArtifacts.map((a) => a.kind).join(', ') }
                  )
                : translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.e29ce06e31',
                    'No artifacts recorded'
                  )}
            </p>
          ) : (
            <div className="space-y-1">
              {stage.artifacts.map((art) => (
                <div
                  key={`${art.kind}:${art.uri}`}
                  className="min-w-0 rounded border border-border/40 bg-background/70 px-2 py-1 text-3xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-semibold text-foreground">{art.kind}</span>
                    {art.retentionClass ? (
                      <Badge variant="outline">{art.retentionClass}</Badge>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-muted-foreground" title={art.uri}>
                    {art.uri}
                  </div>
                  {art.sha256 ? (
                    <div className="truncate font-mono text-muted-foreground" title={art.sha256}>
                      {art.sha256.slice(0, 18)}…
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Checks & Review Findings */}
        <div
          className="min-w-0 space-y-1.5 rounded border border-border/50 bg-muted/20 p-2.5"
          data-testid={`stage-checks-${stage.childDefinitionId}`}
        >
          <div className="flex items-center justify-between gap-1 text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
            <span>
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.0ab139f325',
                'Checks & Findings'
              )}
            </span>
            {stage.reviewIteration !== null ? (
              <span className="font-mono">
                {translate(
                  'auto.components.automations.AutomationCoordinatedRunStageEvidence.10feb532dd',
                  'Rev loop'
                )}{' '}
                {stage.reviewIteration}/{stage.maxReviewIterations ?? '—'}
              </span>
            ) : null}
          </div>
          {stage.checks.length === 0 && stage.unmetCriteria.length === 0 ? (
            <p className="text-3xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.b31b34dfb1',
                'No checks or review findings reported.'
              )}
            </p>
          ) : (
            <div className="space-y-1">
              {stage.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="rounded border border-border/40 bg-background/70 px-2 py-1 text-3xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 font-mono font-medium text-foreground">
                      {chk.outcome === 'passed' ? (
                        <CheckCircle2 className="size-3 text-status-success" aria-hidden="true" />
                      ) : chk.outcome === 'warning' ? (
                        <AlertTriangle className="size-3 text-status-warning" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-3 text-destructive" aria-hidden="true" />
                      )}
                      {chk.id}
                    </span>
                    <Badge
                      variant={
                        chk.outcome === 'passed'
                          ? 'secondary'
                          : chk.outcome === 'warning'
                            ? 'outline'
                            : 'destructive'
                      }
                    >
                      {chk.outcome}
                    </Badge>
                  </div>
                  {chk.evidence?.map((ev) => (
                    <div key={ev} className="mt-0.5 break-words text-muted-foreground">
                      {ev}
                    </div>
                  ))}
                </div>
              ))}
              {stage.unmetCriteria.map((unmet) => (
                <div
                  key={unmet}
                  className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-3xs text-destructive"
                >
                  {translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.621e9c57df',
                    'Unmet:'
                  )}{' '}
                  {unmet}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approvals */}
        <div
          className="min-w-0 space-y-1.5 rounded border border-border/50 bg-muted/20 p-2.5"
          data-testid={`stage-approvals-${stage.childDefinitionId}`}
        >
          <div className="flex items-center justify-between gap-1 text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="flex items-center gap-1">
              <Lock className="size-3" aria-hidden="true" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.cef20f5734',
                'Approvals'
              )}
            </span>
            <span>{stage.approvals.length}</span>
          </div>
          {stage.approvals.length === 0 ? (
            <p className="text-3xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.10ee31095b',
                'No stage-level approval gates.'
              )}
            </p>
          ) : (
            <div className="space-y-1">
              {stage.approvals.map((app) => (
                <div
                  key={app.approvalId}
                  className="rounded border border-border/40 bg-background/70 px-2 py-1 text-3xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-medium text-foreground">{app.role}</span>
                    <Badge
                      variant={
                        app.status === 'approved'
                          ? 'secondary'
                          : app.status === 'rejected'
                            ? 'destructive'
                            : 'outline'
                      }
                    >
                      {app.status}
                    </Badge>
                  </div>
                  {app.disallowAuthorApproval ? (
                    <div className="mt-0.5 text-status-warning-text">
                      {translate(
                        'auto.components.automations.AutomationCoordinatedRunStageEvidence.0df6124070',
                        'Distinct non-author approver required'
                      )}
                    </div>
                  ) : null}
                  {app.approverIdentity ? (
                    <div className="mt-0.5 font-mono text-muted-foreground">
                      {translate(
                        'auto.components.automations.AutomationCoordinatedRunStageEvidence.310a4fe20d',
                        'By:'
                      )}{' '}
                      {app.approverIdentity}
                    </div>
                  ) : null}
                  {app.rejectionReason ? (
                    <div className="mt-0.5 text-destructive">{app.rejectionReason}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AutomationCoordinatedAttemptHistory stage={stage} onOpenAttempt={onOpenAttempt} />
    </div>
  )
}
