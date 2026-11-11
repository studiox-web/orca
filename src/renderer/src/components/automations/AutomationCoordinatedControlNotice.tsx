import { translate } from '@/i18n/i18n'
import type { CoordinatedRunControlNotice } from './use-coordinated-run-control-lifecycle'
export function AutomationCoordinatedControlNotice({
  notice: controlNotice,
  runId
}: {
  notice: CoordinatedRunControlNotice | null
  runId: string
}) {
  return (
    <>
      {' '}
      {/* Operator Action Lifecycle: honest pending/result/failure, fenced to the selected run */}
      {controlNotice && controlNotice.runId === runId ? (
        controlNotice.state === 'failed' ? (
          <p
            role="alert"
            data-testid="run-control-error"
            className="text-xs text-status-warning break-words"
          >
            {controlNotice.message}
          </p>
        ) : (
          <p
            role="status"
            data-testid={
              controlNotice.state === 'pending' ? 'run-control-pending' : 'run-control-result'
            }
            className="text-xs text-muted-foreground break-words"
          >
            {controlNotice.state === 'pending'
              ? translate(
                  'auto.components.automations.AutomationCoordinatedRunPanel.0c0fced7c6',
                  'Submitting {{value0}} request…',
                  { value0: controlNotice.label.toLowerCase() }
                )
              : controlNotice.message}
          </p>
        )
      ) : null}
    </>
  )
}
