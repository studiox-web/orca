import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  HelpCircle,
  History,
  Lock,
  ShieldAlert,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  ProjectedCoordinatedAttempt,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-projection'

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
            <div className="font-semibold">Waiting for operator / coordinator answer</div>
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
              Uncertain external effect — mutation lane stopped for reconciliation
            </div>
            <p className="text-2xs">
              Automatic and blind manual retries are blocked. Inspect the durable receipt and
              external state before resolving.
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
                <Badge variant="outline">resolvable by: {blocker.resolvableBy}</Badge>
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
              Artifacts
            </span>
            <span>
              {stage.artifacts.length}
              {stage.requiredArtifacts.length > 0 ? `/${stage.requiredArtifacts.length} req` : ''}
            </span>
          </div>
          {stage.artifacts.length === 0 ? (
            <p className="text-3xs text-muted-foreground">
              {stage.requiredArtifacts.length > 0
                ? `Awaiting ${stage.requiredArtifacts.map((a) => a.kind).join(', ')}`
                : 'No artifacts recorded'}
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
            <span>Checks & Findings</span>
            {stage.reviewIteration !== null ? (
              <span className="font-mono">
                Rev loop {stage.reviewIteration}/{stage.maxReviewIterations ?? '—'}
              </span>
            ) : null}
          </div>
          {stage.checks.length === 0 && stage.unmetCriteria.length === 0 ? (
            <p className="text-3xs text-muted-foreground">No checks or review findings reported.</p>
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
                  Unmet: {unmet}
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
              Approvals
            </span>
            <span>{stage.approvals.length}</span>
          </div>
          {stage.approvals.length === 0 ? (
            <p className="text-3xs text-muted-foreground">No stage-level approval gates.</p>
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
                      Distinct non-author approver required
                    </div>
                  ) : null}
                  {app.approverIdentity ? (
                    <div className="mt-0.5 font-mono text-muted-foreground">
                      By: {app.approverIdentity}
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

      {/* Dispatch Attempts Lineage */}
      {stage.attempts.length > 0 ? (
        <div
          className="space-y-1.5 rounded border border-border/50 bg-muted/15 p-2.5"
          data-testid={`stage-attempts-${stage.childDefinitionId}`}
        >
          <div className="flex items-center justify-between text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="flex items-center gap-1">
              <History className="size-3" aria-hidden="true" />
              Dispatch Attempts ({stage.attempts.length}
              {stage.supersededAttemptsCount > 0
                ? ` · ${stage.supersededAttemptsCount} superseded`
                : ''}
              )
            </span>
            <span className="font-mono">Task: {stage.taskId ?? 'unmapped'}</span>
          </div>
          <div className="space-y-1">
            {stage.attempts.map((attempt) => (
              <div
                key={attempt.dispatchId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-3xs ${
                  attempt.isActive
                    ? 'border-border/70 bg-background'
                    : 'border-border/40 bg-muted/30 opacity-75'
                }`}
                data-testid={`dispatch-attempt-${attempt.dispatchId}`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-mono font-semibold text-foreground">
                    #{attempt.attemptNumber} · {attempt.dispatchId}
                  </span>
                  {attempt.retryOfDispatchId ? (
                    <Badge variant="outline">retry-of: {attempt.retryOfDispatchId}</Badge>
                  ) : null}
                  <Badge variant={attempt.isActive ? 'secondary' : 'outline'}>
                    {attempt.isActive ? 'Active' : 'Superseded'}
                  </Badge>
                  <Badge variant="outline">tech: {attempt.technicalStatus}</Badge>
                  {attempt.workerReportOutcome ? (
                    <Badge variant="outline">report: {attempt.workerReportOutcome}</Badge>
                  ) : null}
                  <Badge variant="outline">{attempt.agentKind}</Badge>
                  {attempt.summary ? (
                    <span className="max-w-[260px] truncate text-muted-foreground">
                      — {attempt.summary}
                    </span>
                  ) : null}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={!attempt.canOpenWorker}
                        onClick={() => onOpenAttempt(attempt)}
                        aria-label={`Open attempt ${attempt.dispatchId}`}
                        data-testid={`open-attempt-${attempt.dispatchId}`}
                      >
                        <ExternalLink className="size-3" />
                        <span>
                          Open{' '}
                          {attempt.crewRow?.openTarget?.kind
                            ? `(${attempt.crewRow.openTarget.kind})`
                            : 'attempt'}
                        </span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!attempt.canOpenWorker && attempt.openWorkerUnavailableReason ? (
                    <TooltipContent side="top" sideOffset={4}>
                      {attempt.openWorkerUnavailableReason}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
