import React from 'react'
import { Eye, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  isCoordinatedAutomation,
  type Automation,
  type AutomationRun
} from '../../../../shared/automations-types'
import { AutomationCoordinatedHostRunPanel } from './AutomationCoordinatedHostRunPanel'
import { AutomationCoordinatedRunPanel } from './AutomationCoordinatedRunPanel'
import type { AutomationCapturedOwner } from './automation-captured-owner'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import type { CoordinatedRunOperatorActions } from './coordinated-automation-run-projection'
import type { CoordinatedRunRequests } from './coordinated-run-api-client'

/** The owning-host identity the route needs before any run control can be bound. */
export type AutomationRunDetailsCoordinatedHost = {
  capturedOwner?: AutomationCapturedOwner
  hostEntry?: AutomationHostCatalogEntry | null
  historyUnavailable?: string | null
  requests: CoordinatedRunRequests
}

// Why: the saved-history projection guesses eligibility from the renderer; only the host-checked controls may submit.
const HOST_CHECKED_CONTROLS = {
  supported: false,
  reason: translate(
    'auto.components.automations.AutomationRunDetailsPage.b2bd1d7d32',
    'Run controls use host-checked eligibility. Use “Host-observed run and controls” below.'
  )
}
const SAVED_PROJECTION_ACTIONS: CoordinatedRunOperatorActions = {
  stopRun: { availability: HOST_CHECKED_CONTROLS },
  retryStage: { availability: HOST_CHECKED_CONTROLS },
  resolveGate: { availability: HOST_CHECKED_CONTROLS }
}
import { AutomationRunPageFrame } from './AutomationRunPageFrame'
import { getAutomationRunContent } from './automation-run-content'
import { automationRunErrorText } from './automation-run-error-copy'
import type { AutomationRunViewState } from './automation-run-view-state'
import type { AutomationRunWorkspaceDisplay } from './automation-run-workspace-display'
import {
  AutomationRunErrorNotice,
  formatAutomationDateTimeWithRelative,
  getAutomationRunStatusLabel,
  getAutomationRunStatusVariant
} from './automation-page-parts'

export function AutomationRunDetailsPage({
  automation,
  run,
  relativeNow,
  workspaceDisplay,
  viewState,
  coordinatedHost,
  canRerun,
  isRerunPending,
  onRerun,
  onOpenWorkspace,
  onBack
}: {
  automation: Automation | null
  run: AutomationRun
  relativeNow: number
  workspaceDisplay: AutomationRunWorkspaceDisplay | null
  viewState: AutomationRunViewState | null
  coordinatedHost?: AutomationRunDetailsCoordinatedHost
  canRerun: boolean
  isRerunPending: boolean
  onRerun: () => void
  onOpenWorkspace: () => void
  onBack: () => void
}): React.JSX.Element {
  const isCoordinatedFeatureEnabled = useAppStore(
    (s) => s.settings?.experimentalCoordinatedAutomations === true
  )
  const content = getAutomationRunContent(run)
  const errorText = automationRunErrorText(run)
  const showCoordinatedRunPanel = Boolean(
    automation &&
    (isCoordinatedAutomation(automation) ||
      run.resolvedSnapshot ||
      run.completionReceipt ||
      run.materializationPhase ||
      run.coordinatedQuarantine)
  )
  return (
    <section className="flex min-h-0 flex-1 p-5">
      <AutomationRunPageFrame
        title={automation?.name ?? run.title}
        breadcrumbs={[
          formatAutomationDateTimeWithRelative(run.scheduledFor, relativeNow),
          'Orca',
          workspaceDisplay?.detailLabel ??
            translate('auto.components.automations.AutomationsPage.noWorkspace', 'No workspace')
        ]}
        detail={
          run.outputSnapshot?.truncated
            ? translate(
                'auto.components.automations.AutomationsPage.latestSavedOutput',
                'Latest saved output'
              )
            : null
        }
        statusLabel={getAutomationRunStatusLabel(run.status)}
        statusVariant={getAutomationRunStatusVariant(run.status)}
        actions={
          <>
            {canRerun && automation ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRerunPending}
                onClick={onRerun}
              >
                <RefreshCw className={cn('size-3.5', isRerunPending && 'animate-spin')} />
                {translate('auto.components.automations.AutomationsPage.295698292f', 'Rerun')}
              </Button>
            ) : null}
            {/* Why: a disabled button with nothing to open reads as broken; status and content explain the run. */}
            {viewState?.canOpen ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenWorkspace}>
                <Eye className="size-3.5" />
                {viewState.actionLabel}
              </Button>
            ) : null}
          </>
        }
        onBack={onBack}
      >
        {/* Why: saved terminal output otherwise hides why the run failed. */}
        {run.status === 'dispatch_failed' && errorText && content !== errorText ? (
          <AutomationRunErrorNotice
            className="mb-4"
            label={translate('auto.components.automations.AutomationsPage.runError', 'Error:')}
            error={errorText}
          />
        ) : null}
        {showCoordinatedRunPanel && automation ? (
          <div className="mb-4">
            <AutomationCoordinatedRunPanel
              automation={automation}
              run={run}
              workspaceLabel={workspaceDisplay?.detailLabel ?? null}
              isFeatureFlagEnabled={isCoordinatedFeatureEnabled}
              operatorActions={coordinatedHost ? SAVED_PROJECTION_ACTIONS : null}
              now={relativeNow}
            />
          </div>
        ) : null}
        {showCoordinatedRunPanel && automation && coordinatedHost ? (
          <div className="mb-4">
            <AutomationCoordinatedHostRunPanel
              key={run.id}
              automation={automation}
              runs={[run]}
              pinnedRun={run}
              capturedOwner={coordinatedHost.capturedOwner}
              hostEntry={coordinatedHost.hostEntry}
              historyUnavailable={coordinatedHost.historyUnavailable}
              requests={coordinatedHost.requests}
              enabled={isCoordinatedFeatureEnabled}
            />
          </div>
        ) : null}
        <CommentMarkdown
          variant="document"
          content={content}
          className="text-sm leading-relaxed text-foreground"
        />
      </AutomationRunPageFrame>
    </section>
  )
}
