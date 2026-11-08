import React from 'react'
import { ChevronDown, CircleAlert } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { hostStableKey } from '../../../../shared/automation-owner-key'
import { readOnlyUnifiedScheduleChildCapabilities } from '../../../../shared/unified-automation-capabilities'
import type { UnifiedDetailResolution } from '../../../../shared/unified-automation-detail'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import { UnifiedAutomationDetailScriptEvidence } from './UnifiedAutomationDetailScriptEvidence'
import { unifiedDenialLabel } from './unified-automation-detail-copy'

export function UnifiedAutomationDetailSections({
  row,
  currentRow,
  resolution,
  conflict,
  goalTarget,
  onOpenGoal,
  canOpenNative,
  onOpenNative,
  canOpenExternal,
  onOpenExternal
}: {
  row: UnifiedAutomationRow
  currentRow: UnifiedAutomationRow | null
  resolution: UnifiedDetailResolution
  conflict: boolean
  goalTarget: { projectKey: string; goal: string } | null
  onOpenGoal: (projectKey: string, goal: string) => void
  canOpenNative: (row: UnifiedAutomationRow) => boolean
  onOpenNative: (row: UnifiedAutomationRow) => void
  canOpenExternal: (row: UnifiedAutomationRow) => boolean
  onOpenExternal: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  return (
    <>
      {row.warnings.length > 0 ? (
        <section
          className="space-y-2"
          aria-label={translate(
            'auto.components.automations.unified.detail.warnings',
            'Warnings and conflicts'
          )}
        >
          <h2 className="text-sm font-semibold">
            {translate(
              'auto.components.automations.unified.detail.warnings',
              'Warnings and conflicts'
            )}
          </h2>
          {row.warnings.map((warning) => (
            <div
              key={`${warning.code}:${warning.message}`}
              className="flex gap-2 rounded-md border p-3 text-sm"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium">{warning.code}</p>
                <p className="text-xs text-muted-foreground">{warning.message}</p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-xs">
        <h2 className="text-sm font-semibold">
          {translate(
            'auto.components.automations.unified.detail.scheduleChildren',
            'Schedule children'
          )}
        </h2>
        {row.scheduleChildren.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {translate(
              'auto.components.automations.unified.detail.noSchedule',
              'No schedule is attached.'
            )}
          </p>
        ) : (
          <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
            {row.scheduleChildren.map((schedule) => {
              const scheduleReason = readOnlyUnifiedScheduleChildCapabilities({
                owner: schedule.owner,
                conflict
              }).denied[0]?.reason
              return (
                <article key={schedule.key} className="min-w-0 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{schedule.owner}</Badge>
                    <Badge variant="secondary">{schedule.format}</Badge>
                    <Badge variant={schedule.enabled ? 'secondary' : 'outline'}>
                      {schedule.enabled
                        ? translate('auto.components.automations.unified.detail.enabled', 'Enabled')
                        : translate('auto.components.automations.unified.detail.paused', 'Paused')}
                    </Badge>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs">{schedule.expression}</p>
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="inline font-medium">
                        {translate(
                          'auto.components.automations.unified.detail.timezone',
                          'Timezone'
                        )}
                        :{' '}
                      </dt>
                      <dd className="inline">{schedule.timezoneLabel}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        {translate(
                          'auto.components.automations.unified.detail.nextRun',
                          'Next run'
                        )}
                        :{' '}
                      </dt>
                      <dd className="inline">
                        {schedule.nextRunAt ??
                          translate(
                            'auto.components.automations.unified.detail.unavailable',
                            'Unavailable'
                          )}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        {translate('auto.components.automations.unified.detail.editing', 'Editing')}
                        :{' '}
                      </dt>
                      <dd className="inline">
                        {translate(
                          'auto.components.automations.unified.detail.readOnly',
                          'Read-only'
                        )}
                        {scheduleReason ? ` · ${unifiedDenialLabel(scheduleReason)}` : ''}
                      </dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-xs">
        <h2 className="text-sm font-semibold">
          {translate(
            'auto.components.automations.unified.detail.authoritativeSources',
            'Authoritative sources'
          )}
        </h2>
        <div className="mt-3 space-y-3">
          {row.sourceRefs.map((source) => (
            <article
              key={`${source.kind}:${hostStableKey(source.authority)}:${source.sourceId}:${source.revision ?? ''}:${source.ownerKey ?? ''}`}
              className="rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{source.kind}</Badge>
                <span>{source.label}</span>
              </div>
              <dl className="mt-2 grid gap-1 text-muted-foreground [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
                <div>
                  <dt className="font-medium">
                    {translate('auto.components.automations.unified.detail.sourceId', 'Source ID')}
                  </dt>
                  <dd className="break-all font-mono">{source.sourceId}</dd>
                </div>
                <div>
                  <dt className="font-medium">
                    {translate('auto.components.automations.unified.detail.authority', 'Authority')}
                  </dt>
                  <dd className="break-all font-mono">{hostStableKey(source.authority)}</dd>
                </div>
                <div>
                  <dt className="font-medium">
                    {translate('auto.components.automations.unified.detail.revision', 'Revision')}
                  </dt>
                  <dd className="break-all font-mono">
                    {source.revision ??
                      translate(
                        'auto.components.automations.unified.detail.notRecorded',
                        'Not recorded'
                      )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">
                    {translate('auto.components.automations.unified.detail.ownerKey', 'Owner key')}
                  </dt>
                  <dd className="break-all font-mono">
                    {source.ownerKey ??
                      translate(
                        'auto.components.automations.unified.detail.notRecorded',
                        'Not recorded'
                      )}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {resolution.status === 'resolved' && resolution.target.kind === 'script' ? (
        <UnifiedAutomationDetailScriptEvidence
          evidence={resolution.target.evidence}
          host={row.host}
        />
      ) : null}

      {goalTarget ? (
        row.lifecycle.state === 'archived' ? (
          <section className="rounded-xl border bg-card p-4 text-sm shadow-xs">
            <h2 className="font-semibold">
              {translate(
                'auto.components.automations.unified.detail.archivedGoal',
                'Archived Goal'
              )}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {translate(
                'auto.components.automations.unified.detail.archivedGoalDescription',
                'Archived Goal metadata remains view-only here and does not expose manage actions.'
              )}
            </p>
          </section>
        ) : (
          <section className="rounded-xl border bg-card px-4 shadow-xs">
            <Collapsible>
              <CollapsibleTrigger variant="row">
                <span>
                  {translate(
                    'auto.components.automations.unified.detail.advancedGoalWorkspace',
                    'Advanced Goal workspace'
                  )}
                </span>
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 pb-4 text-xs text-muted-foreground">
                  <p>
                    {translate(
                      'auto.components.automations.unified.detail.advancedGoalDescription',
                      'Open the existing Goal Viewer for files, scheduling, pause/resume, archive, run, and other established manage capabilities. This shell does not duplicate them.'
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenGoal(goalTarget.projectKey, goalTarget.goal)}
                  >
                    {translate(
                      'auto.components.automations.unified.detail.openGoalWorkspace',
                      'Open Goal workspace'
                    )}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>
        )
      ) : null}

      {resolution.status === 'resolved' && resolution.target.kind === 'automation' ? (
        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">
            {translate(
              'auto.components.automations.unified.detail.nativeEditor',
              'Native automation editor'
            )}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.automations.unified.detail.nativeEditorDescription',
              'Continue to the existing native detail and editor for provider, model, destination, schedule, precheck, and setup controls.'
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={!currentRow || !canOpenNative(currentRow)}
            onClick={() => currentRow && onOpenNative(currentRow)}
          >
            {row.agentId ? <AgentIcon agent={row.agentId} size={14} /> : null}
            {translate(
              'auto.components.automations.unified.detail.openNativeAutomation',
              'Open native automation'
            )}
          </Button>
          {!currentRow || !canOpenNative(currentRow) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {translate(
                'auto.components.automations.unified.detail.nativeUnavailable',
                'The exact native row is not available in the current host catalog.'
              )}
            </p>
          ) : null}
        </section>
      ) : null}

      {resolution.status === 'resolved' && resolution.target.kind === 'external' ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-xs">
          <h2 className="font-semibold">
            {translate(
              'auto.components.automations.unified.detail.externalManager',
              'External manager detail'
            )}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.automations.unified.detail.externalManagerDescription',
              'Capability-driven read-only view. Manage this job in its authoritative external manager.'
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={!currentRow || !canOpenExternal(currentRow)}
            onClick={() => currentRow && onOpenExternal(currentRow)}
          >
            {translate(
              'auto.components.automations.unified.detail.openNativeList',
              'Open in native list'
            )}
          </Button>
          {!currentRow || !canOpenExternal(currentRow) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {translate(
                'auto.components.automations.unified.detail.externalUnavailable',
                'The exact external row is not available in the current authority catalog.'
              )}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
