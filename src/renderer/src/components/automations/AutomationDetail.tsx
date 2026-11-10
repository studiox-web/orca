import React from 'react'
import { Pencil, Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import {
  isCoordinatedAutomation,
  type Automation,
  type AutomationRun
} from '../../../../shared/automations-types'
import { useAppStore } from '@/store'
import { AutomationCoordinatedRunPanel } from './AutomationCoordinatedRunPanel'
import { AutomationWorkersSection } from './AutomationWorkersSection'
import { formatUiAutomationSchedule } from './automation-schedule-label'
import { formatUiNarrowDuration } from '@/i18n/relative-time-format'
import {
  AutomationRunErrorNotice,
  formatAutomationDateTimeWithRelative
} from './automation-page-parts'
import { indexLatestAutomationRuns } from './automation-list-last-run'
import {
  formatAutomationCost,
  formatAutomationTokens,
  summarizeAutomationRunUsage
} from './automation-usage-model'
import type { AutomationTargetAvailability } from './automation-target-availability'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import { getAutomationHostDetailDisplay } from './automation-host-detail-display'
import { getAutomationSourceDisplay } from './automation-source-display'
import { translate } from '@/i18n/i18n'
import { AutomationPromptDisclosure } from './AutomationPromptDisclosure'
import { automationRunErrorText } from './automation-run-error-copy'
import {
  DetailMetric,
  focusConfiguredWorkerCard,
  formatGrace,
  getAutomationToolbarLabels,
  ToolbarIconButton,
  CoordinatedFlagOffBanner
} from './automation-detail-components'

type AutomationDetailProps = {
  automation: Automation | null
  runs: AutomationRun[]
  projectName: string
  workspaceName: string
  projectDefaultBaseRef: string | null
  /** The catalog entry the selected row was listed from; absent for legacy unscoped rows. */
  hostEntry?: AutomationHostCatalogEntry | null
  hostLabelById?: ReadonlyMap<string, string>
  runNowAvailability: AutomationTargetAvailability | null
  now: number
  onRunNow: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onToggle: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}

export function AutomationDetail({
  automation,
  runs,
  projectName,
  workspaceName,
  projectDefaultBaseRef,
  hostEntry,
  hostLabelById,
  runNowAvailability,
  now,
  onRunNow,
  onEdit,
  onToggle,
  onDelete
}: AutomationDetailProps): React.JSX.Element {
  const isCoordinatedFeatureEnabled = useAppStore(
    (s) => s.settings?.experimentalCoordinatedAutomations === true
  )

  if (!automation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {translate(
          'auto.components.automations.AutomationDetail.221916d93c',
          'Create an automation to start scheduling agent work.'
        )}
      </div>
    )
  }
  const usageSummary = summarizeAutomationRunUsage(runs)
  const usageCoverage =
    usageSummary.knownRuns > 0
      ? translate(
          'auto.components.automations.AutomationDetail.usageCoverageRuns',
          '{{known}}/{{count}} runs',
          {
            known: usageSummary.knownRuns,
            count: runs.length,
            defaultValue_one: '{{known}}/{{count}} run'
          }
        )
      : usageSummary.unavailableRuns > 0
        ? translate('auto.components.automations.AutomationDetail.usageUnavailable', 'Unavailable')
        : translate('auto.components.automations.AutomationDetail.noRuns', 'No runs')
  const agentLabel =
    getAgentCatalog().find((agent) => agent.id === automation.agentId)?.label ?? automation.agentId
  const runLocationLabel =
    automation.workspaceMode === 'new_per_run'
      ? (automation.baseBranch ??
        projectDefaultBaseRef ??
        translate('auto.components.automations.AutomationDetail.projectDefault', 'Project default'))
      : workspaceName
  const sourceDisplay = getAutomationSourceDisplay(automation.sourceContext, hostLabelById)
  const hostDisplay = getAutomationHostDetailDisplay({
    automation,
    entry: hostEntry,
    hostLabelById
  })
  const isCoordinated = isCoordinatedAutomation(automation)
  const isFlagOffCoordinated = isCoordinated && !isCoordinatedFeatureEnabled
  const showWorkers = isCoordinated
  const activeRun = isCoordinated
    ? runs.find(
        (r) =>
          (r.status === 'pending' || r.status === 'dispatching' || r.status === 'dispatched') &&
          (r.automationDefinitionRevision != null ||
            r.resolvedSnapshot != null ||
            r.orchestrationRunId != null)
      )
    : null
  const snapshotRun = runs.find((r) => r.resolvedSnapshot)
  const historicalSnapshot = snapshotRun?.resolvedSnapshot ?? null
  const snapshotRunId = snapshotRun?.id ?? null
  const runNowDisabled = isCoordinated || runNowAvailability?.canRunNow === false
  const runNowMessage = isCoordinated
    ? translate(
        'auto.components.automations.workers.runDisabled',
        'Execution controls disabled during definition preview'
      )
    : runNowAvailability?.message
  const latestRun = indexLatestAutomationRuns(runs).get(automation.id)
  const latestRunError =
    latestRun?.status === 'dispatch_failed' ? automationRunErrorText(latestRun) : null
  const toolbarLabels = getAutomationToolbarLabels({
    isFlagOffCoordinated,
    enabled: automation.enabled
  })

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{automation.name}</h2>
            <Badge variant={automation.enabled ? 'secondary' : 'outline'}>
              {automation.enabled
                ? translate('auto.components.automations.AutomationDetail.eaa02014f8', 'Enabled')
                : translate('auto.components.automations.enablement.paused', 'Paused')}
            </Badge>
            {isCoordinated ? (
              <Badge
                variant="outline"
                className="border-primary/50 font-mono text-3xs text-primary"
              >
                Coordinated (Rev {automation.definitionRevision ?? 1})
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {projectName} / {workspaceName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRunNow(automation)}
                  disabled={runNowDisabled}
                >
                  <Play className="size-4" />
                  {translate('auto.components.automations.AutomationDetail.2fb1605beb', 'Run Now')}
                </Button>
              </span>
            </TooltipTrigger>
            {runNowDisabled && runNowMessage ? (
              <TooltipContent side="bottom" sideOffset={6}>
                {runNowMessage}
              </TooltipContent>
            ) : null}
          </Tooltip>
          <ToolbarIconButton
            label={toolbarLabels.editLabel}
            onClick={isFlagOffCoordinated ? undefined : () => onEdit(automation)}
            disabled={isFlagOffCoordinated}
            className={isFlagOffCoordinated ? 'opacity-40 cursor-not-allowed' : undefined}
          >
            <Pencil className="size-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={toolbarLabels.toggleLabel}
            onClick={isFlagOffCoordinated ? undefined : () => onToggle(automation)}
            disabled={isFlagOffCoordinated}
            className={isFlagOffCoordinated ? 'opacity-40 cursor-not-allowed' : undefined}
          >
            {automation.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
          </ToolbarIconButton>
          <ToolbarIconButton
            label={translate(
              'auto.components.automations.AutomationDetail.1f6026358e',
              'Delete automation'
            )}
            onClick={() => onDelete(automation)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </ToolbarIconButton>
        </div>
      </div>

      {isFlagOffCoordinated ? <CoordinatedFlagOffBanner /> : null}

      {automation.executionTargetType === 'ssh' ? (
        <div className="rounded-md border border-border/50 bg-muted/50 p-3 text-sm text-muted-foreground shadow-sm">
          {translate(
            'auto.components.automations.AutomationDetail.dbef8dc110',
            'This SSH automation runs only while Orca can reach the SSH host. If reconnect needs interactive credentials or the host is unavailable, the run is recorded as skipped.'
          )}
        </div>
      ) : null}

      {runNowAvailability?.canRunNow === false ? (
        <div className="rounded-md border border-border/50 bg-muted/40 p-3 text-sm text-muted-foreground shadow-sm">
          {runNowAvailability.message}
        </div>
      ) : null}

      {latestRunError ? (
        <AutomationRunErrorNotice
          label={translate(
            'auto.components.automations.AutomationDetail.lastRunFailed',
            'Last run failed.'
          )}
          error={latestRunError}
        />
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-5 rounded-md border border-border/50 bg-muted/30 px-4 py-3 shadow-sm">
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.18763ded26', 'Schedule')}
          value={formatUiAutomationSchedule(automation.rrule)}
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.578ff46987', 'Next run')}
          value={
            automation.enabled
              ? formatAutomationDateTimeWithRelative(automation.nextRunAt, now)
              : translate('auto.components.automations.AutomationsPage.paused', 'Paused')
          }
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.host', 'Host')}
          value={hostDisplay.label}
          title={hostDisplay.title}
        />
        <DetailMetric
          label={
            automation.workspaceMode === 'new_per_run'
              ? translate('auto.components.automations.AutomationDetail.2f8baf5360', 'Create from')
              : translate('auto.components.automations.AutomationDetail.5405a09b1f', 'Run location')
          }
          value={runLocationLabel}
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.15ea446b93', 'Session')}
          value={
            automation.reuseSession
              ? translate(
                  'auto.components.automations.AutomationDetail.reuseLiveSession',
                  'Reuse live session'
                )
              : translate(
                  'auto.components.automations.AutomationDetail.freshEachRun',
                  'Fresh each run'
                )
          }
        />
        {sourceDisplay ? (
          <DetailMetric
            label={translate('auto.components.automations.AutomationDetail.29baf8f4c2', 'Source')}
            value={sourceDisplay.label}
            title={sourceDisplay.title}
          />
        ) : null}
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.620b22145e', 'Grace')}
          value={formatGrace(automation.missedRunGraceMinutes)}
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.e353ab9516', 'Precheck')}
          value={
            automation.precheck
              ? translate(
                  'auto.components.automations.AutomationDetail.precheckEnabled',
                  'Enabled, {{timeout}}',
                  { timeout: formatUiNarrowDuration(automation.precheck.timeoutSeconds, 'second') }
                )
              : translate('auto.components.automations.AutomationDetail.precheckNone', 'None')
          }
        />
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">
            {translate('auto.components.automations.AutomationDetail.2df8970cd5', 'Agent')}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-medium">
            <AgentIcon agent={automation.agentId} size={16} />
            <span className="truncate">{agentLabel}</span>
          </div>
        </div>
        {automation.extraAgentArgs ? (
          <DetailMetric
            label={translate(
              'auto.components.automations.extraAgentArgs.detailLabel',
              'Extra arguments'
            )}
            value={automation.extraAgentArgs}
            title={automation.extraAgentArgs}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-5 rounded-md border border-border/50 bg-muted/20 px-4 py-3 shadow-sm">
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.a7c312430d', 'Last run')}
          value={formatAutomationDateTimeWithRelative(automation.lastRunAt, now)}
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.401f40ae79', 'Est. spend')}
          value={formatAutomationCost(usageSummary.estimatedCostUsd)}
        />
        <DetailMetric
          label={translate('auto.components.automations.AutomationDetail.449fc83bf7', 'Tokens')}
          value={formatAutomationTokens(usageSummary.totalTokens)}
        />
        <DetailMetric
          label={translate(
            'auto.components.automations.AutomationDetail.a1d52c2189',
            'Usage coverage'
          )}
          value={usageCoverage}
        />
      </div>

      {showWorkers ? (
        <>
          <AutomationWorkersSection
            workers={automation.children ?? []}
            definitionRevision={automation.definitionRevision ?? 1}
            outcomeContract={automation.outcomeContract}
            inheritedDefaults={automation.inheritedDefaults}
            globalCeilings={automation.globalCeilings}
            publicationPolicy={automation.publicationPolicy}
            retentionPolicy={automation.retentionPolicy}
            isEditing={false}
            activeRunId={activeRun?.id ?? null}
            activeRunRevision={activeRun?.automationDefinitionRevision}
            activeRunStatus={activeRun?.status ?? null}
            snapshotRunId={snapshotRunId}
            historicalSnapshot={historicalSnapshot}
          />
          {runs.length > 0 ? (
            <AutomationCoordinatedRunPanel
              automation={automation}
              runs={runs}
              hostLabel={hostDisplay.label}
              workspaceLabel={runLocationLabel}
              isFeatureFlagEnabled={isCoordinatedFeatureEnabled}
              now={now}
              onInspectChildDefinition={focusConfiguredWorkerCard}
            />
          ) : null}
        </>
      ) : (
        <AutomationPromptDisclosure
          key={`${automation.id}:${automation.prompt}`}
          prompt={automation.prompt}
        />
      )}
    </div>
  )
}
