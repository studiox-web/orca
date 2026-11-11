import { ExternalLink, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type {
  ProjectedCoordinatedStage,
  ProjectedCoordinatedAttempt
} from './coordinated-automation-run-projection'
export function AutomationCoordinatedAttemptHistory({
  stage,
  onOpenAttempt
}: {
  stage: ProjectedCoordinatedStage
  onOpenAttempt: (attempt: ProjectedCoordinatedAttempt) => void
}) {
  return (
    <>
      {' '}
      {/* Dispatch Attempts Lineage */}
      {stage.attempts.length > 0 ? (
        <div
          className="space-y-1.5 rounded border border-border/50 bg-muted/15 p-2.5"
          data-testid={`stage-attempts-${stage.childDefinitionId}`}
        >
          <div className="flex items-center justify-between text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="flex items-center gap-1">
              <History className="size-3" aria-hidden="true" />
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.6d0b86da4b',
                'Dispatch Attempts ('
              )}
              {stage.attempts.length}
              {stage.supersededAttemptsCount > 0
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunStageEvidence.fe8e194e12',
                    ' · {{value0}} superseded',
                    { value0: stage.supersededAttemptsCount }
                  )
                : ''}
              )
            </span>
            <span className="font-mono">
              {translate(
                'auto.components.automations.AutomationCoordinatedRunStageEvidence.01326cba8c',
                'Task:'
              )}{' '}
              {stage.taskId ??
                translate(
                  'auto.components.automations.AutomationCoordinatedRunStageEvidence.fbc33e1a60',
                  'unmapped'
                )}
            </span>
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
                    <Badge variant="outline">
                      {translate(
                        'auto.components.automations.AutomationCoordinatedRunStageEvidence.60ee6c8fa5',
                        'retry-of:'
                      )}{' '}
                      {attempt.retryOfDispatchId}
                    </Badge>
                  ) : null}
                  <Badge variant={attempt.isActive ? 'secondary' : 'outline'}>
                    {attempt.isActive
                      ? translate(
                          'auto.components.automations.AutomationCoordinatedRunStageEvidence.3448f7c5d9',
                          'Active'
                        )
                      : translate(
                          'auto.components.automations.AutomationCoordinatedRunStageEvidence.19895cd47d',
                          'Superseded'
                        )}
                  </Badge>
                  <Badge variant="outline">
                    {translate(
                      'auto.components.automations.AutomationCoordinatedRunStageEvidence.b613def44f',
                      'tech:'
                    )}{' '}
                    {attempt.technicalStatus}
                  </Badge>
                  {attempt.workerReportOutcome ? (
                    <Badge variant="outline">
                      {translate(
                        'auto.components.automations.AutomationCoordinatedRunStageEvidence.e5a39a1957',
                        'report:'
                      )}{' '}
                      {attempt.workerReportOutcome}
                    </Badge>
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
                        aria-label={translate(
                          'auto.components.automations.AutomationCoordinatedRunStageEvidence.7d8ae761d3',
                          'Open attempt {{value0}}',
                          { value0: attempt.dispatchId }
                        )}
                        data-testid={`open-attempt-${attempt.dispatchId}`}
                      >
                        <ExternalLink className="size-3" />
                        <span>
                          {translate(
                            'auto.components.automations.AutomationCoordinatedRunStageEvidence.f4a403548c',
                            'Open'
                          )}{' '}
                          {attempt.crewRow?.openTarget?.kind
                            ? `(${attempt.crewRow.openTarget.kind})`
                            : translate(
                                'auto.components.automations.AutomationCoordinatedRunStageEvidence.794267f250',
                                'attempt'
                              )}
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
    </>
  )
}
