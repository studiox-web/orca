import { RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { AutomationCoordinatedRunStageCardProps } from './AutomationCoordinatedRunStageCard'
export function AutomationCoordinatedStageActions({
  stage,
  controlsDisabled,
  onRequestControl
}: Pick<
  AutomationCoordinatedRunStageCardProps,
  'stage' | 'controlsDisabled' | 'onRequestControl'
>) {
  const pendingGateId =
    stage.gateResolutionEligibility.pendingGateId ?? stage.approvals[0]?.approvalId ?? null
  const showGateAction =
    stage.stageExecutionStatus === 'waiting_for_approval' || stage.approvals.length > 0
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid={`retry-stage-btn-${stage.childDefinitionId}`}
          disabled={controlsDisabled}
          aria-busy={controlsDisabled}
          title={
            controlsDisabled
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.97dbb6d634',
                  'Another run control request is already being submitted.'
                )
              : (stage.retryEligibility.reason ??
                translate(
                  'auto.components.automations.AutomationCoordinatedRunStageCard.retryStageTitle',
                  'Retry stage {{value0}} by reusing task {{value1}}',
                  { value0: stage.name, value1: stage.taskId }
                ))
          }
          onClick={() => onRequestControl?.({ kind: 'retry', stage })}
        >
          <RefreshCw className="size-3" />
          {translate(
            'auto.components.automations.AutomationCoordinatedRunStageCard.130fce1102',
            'Retry stage'
          )}
        </Button>

        {showGateAction && pendingGateId ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid={`resolve-gate-btn-${stage.childDefinitionId}`}
            disabled={controlsDisabled}
            aria-busy={controlsDisabled}
            title={
              controlsDisabled
                ? translate(
                    'auto.components.automations.AutomationCoordinatedRunStageCard.97dbb6d634',
                    'Another run control request is already being submitted.'
                  )
                : (stage.gateResolutionEligibility.reason ??
                  translate(
                    'auto.components.automations.AutomationCoordinatedRunStageCard.b57526ac0e',
                    'Resolve approval gate {{value0}} for {{value1}}',
                    { value0: pendingGateId, value1: stage.name }
                  ))
            }
            onClick={() =>
              onRequestControl?.({
                kind: 'resolve_gate',
                stage,
                gateId: pendingGateId
              })
            }
          >
            <ShieldCheck className="size-3" />
            {translate(
              'auto.components.automations.AutomationCoordinatedRunStageCard.df2db4f78c',
              'Resolve gate ('
            )}
            {pendingGateId})
          </Button>
        ) : null}
      </div>

      {!stage.retryEligibility.canRetry && stage.retryEligibility.reason ? (
        <span
          className="text-2xs text-muted-foreground"
          data-testid={`retry-stage-reason-${stage.childDefinitionId}`}
        >
          {stage.retryEligibility.reason}
        </span>
      ) : null}
    </div>
  )
}
