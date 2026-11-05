import React from 'react'
import {
  Archive,
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  Plug,
  ScrollText,
  Target,
  TerminalSquare
} from 'lucide-react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { hostStableKey } from '../../../../shared/automation-owner-key'
import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow
} from '../../../../shared/unified-automation-types'

function typeIcon(kind: UnifiedAutomationKind): React.JSX.Element {
  if (kind === 'goal') {
    return <Target className="size-4" />
  }
  if (kind === 'automation') {
    return <CalendarClock className="size-4" />
  }
  if (kind === 'script') {
    return <TerminalSquare className="size-4" />
  }
  return <Plug className="size-4" />
}

function typeLabel(kind: UnifiedAutomationKind): string {
  if (kind === 'goal') {
    return translate('auto.components.automations.unified.type.goal', 'Goal')
  }
  if (kind === 'automation') {
    return translate('auto.components.automations.unified.type.automation', 'Automation')
  }
  if (kind === 'script') {
    return translate('auto.components.automations.unified.type.script', 'Script')
  }
  return translate('auto.components.automations.unified.type.external', 'External')
}

function formatRun(row: UnifiedAutomationRow): string {
  if (!row.runSummary) {
    return translate('auto.components.automations.unified.noRuns', 'No runs')
  }
  const time = row.runSummary.at
    ? new Date(row.runSummary.at).toLocaleString(getIntlLocale())
    : translate('auto.components.automations.unified.timeUnavailable', 'Time unavailable')
  return `${row.runSummary.outcome} · ${time}`
}

function scheduleLabel(row: UnifiedAutomationRow): string {
  const first = row.scheduleChildren[0]
  if (!first) {
    return translate('auto.components.automations.unified.unscheduled', 'Unscheduled')
  }
  return `${first.expression}${row.scheduleChildren.length > 1 ? ` +${row.scheduleChildren.length - 1}` : ''}`
}

export function UnifiedAutomationReadOnlyDetail({
  row,
  onBack
}: {
  row: UnifiedAutomationRow
  onBack: () => void
}): React.JSX.Element {
  return (
    <main className="scrollbar-sleek h-full overflow-y-auto bg-background px-4 pb-10 pt-5 text-foreground md:px-6 md:pt-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {translate('auto.components.automations.unified.goals', 'Goals')}
        </Button>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {typeIcon(row.kind)}
          <Badge variant="outline">{typeLabel(row.kind)}</Badge>
          <Badge variant="secondary">
            {translate('auto.components.automations.unified.readOnly', 'Read-only')}
          </Badge>
        </div>
        <h1 className="text-xl font-semibold">{row.name}</h1>
        <p className="text-sm text-muted-foreground">
          {row.kind === 'script'
            ? translate(
                'auto.components.automations.unified.scriptExecutionUnavailable',
                'Script execution is unavailable until the reviewed runner contract exists.'
              )
            : translate(
                'auto.components.automations.unified.archivedGoalDescription',
                'Archived Goal metadata remains discoverable without creating a schedule.'
              )}
        </p>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            [
              translate('auto.components.automations.unified.lifecycle', 'Lifecycle'),
              `${row.lifecycle.state}${row.lifecycle.stage ? ` · ${row.lifecycle.stage}` : ''}`
            ],
            [
              translate('auto.components.automations.unified.scheduleState', 'Schedule state'),
              row.scheduleState
            ],
            [translate('auto.components.automations.unified.host', 'Host'), row.host],
            [
              translate('auto.components.automations.unified.sourceOwner', 'Source / owner'),
              row.owner
            ]
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs"
            >
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-sm">{value}</p>
            </div>
          ))}
        </section>
        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">
            {translate(
              'auto.components.automations.unified.schedulesAndSources',
              'Schedules and authoritative sources'
            )}
          </h2>
          <div className="mt-3 space-y-3">
            {row.scheduleChildren.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'auto.components.automations.unified.noScheduleAttached',
                  'No schedule is attached.'
                )}
              </p>
            ) : (
              row.scheduleChildren.map((schedule) => (
                <div key={schedule.key} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{schedule.owner}</Badge>
                    <Badge variant="secondary">{schedule.format}</Badge>
                    <span>
                      {schedule.enabled
                        ? translate('auto.components.automations.unified.enabled', 'Enabled')
                        : translate('auto.components.automations.unified.paused', 'Paused')}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs">{schedule.expression}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{schedule.timezoneLabel}</p>
                </div>
              ))
            )}
            {row.sourceRefs.map((source) => (
              <div
                key={`${source.kind}:${hostStableKey(source.authority)}:${source.sourceId}:${source.revision ?? ''}:${source.ownerKey ?? ''}`}
                className="flex flex-wrap gap-2 text-xs text-muted-foreground"
              >
                <span>{source.label}</span>
                <span className="font-mono">{source.sourceId}</span>
                {source.revision ? (
                  <span>
                    {translate('auto.components.automations.unified.revision', 'Revision')}{' '}
                    {source.revision}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export function UnifiedAutomationListRows({
  rows,
  loading,
  onOpen
}: {
  rows: readonly UnifiedAutomationRow[]
  loading: boolean
  onOpen: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto rounded-md border">
      <div className="min-w-[1180px]">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1.6fr)_100px_minmax(180px,1fr)_130px_140px_170px_170px_170px_90px] gap-3 border-b bg-background px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {[
            translate('auto.components.automations.unified.name', 'Name'),
            translate('auto.components.automations.unified.typeHeading', 'Type'),
            translate('auto.components.automations.unified.schedule', 'Schedule'),
            translate('auto.components.automations.unified.lifecycle', 'Lifecycle'),
            translate('auto.components.automations.unified.scheduleState', 'Schedule state'),
            translate('auto.components.automations.unified.latestRun', 'Latest run'),
            translate('auto.components.automations.unified.sourceMigration', 'Source / migration'),
            translate('auto.components.automations.unified.host', 'Host'),
            translate('auto.components.automations.unified.agent', 'Agent')
          ].map((heading) => (
            <span key={heading}>{heading}</span>
          ))}
        </div>
        <div className="divide-y divide-border/50">
          {rows.map((row) => (
            <button
              type="button"
              key={row.key}
              onClick={() => onOpen(row)}
              className="grid w-full grid-cols-[minmax(220px,1.6fr)_100px_minmax(180px,1fr)_130px_140px_170px_170px_170px_90px] gap-3 bg-transparent px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  {row.lifecycle.state === 'archived' ? (
                    <Archive className="size-3.5" />
                  ) : (
                    typeIcon(row.kind)
                  )}
                  <span className="truncate">{row.name}</span>
                  {row.warnings.length > 0 ? (
                    <CircleAlert className="size-3.5 text-destructive" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'mt-0.5 block truncate text-xs',
                    row.warnings.length > 0 ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {row.warnings[0]?.message ??
                    row.project ??
                    translate('auto.components.automations.unified.noProject', 'No project')}
                </span>
              </span>
              <span>
                <Badge variant="outline">{typeLabel(row.kind)}</Badge>
              </span>
              <span className="min-w-0" title={scheduleLabel(row)}>
                <span className="block truncate text-muted-foreground">{scheduleLabel(row)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.scheduleChildren[0]
                    ? `${row.scheduleChildren[0].owner} · ${row.scheduleChildren[0].format} · ${row.scheduleChildren[0].timezoneLabel}`
                    : translate(
                        'auto.components.automations.unified.noScheduleOwner',
                        'No schedule owner'
                      )}
                </span>
              </span>
              <span className="truncate">{row.lifecycle.stage ?? row.lifecycle.state}</span>
              <span className="truncate text-muted-foreground">{row.scheduleState}</span>
              <span className="truncate text-muted-foreground" title={formatRun(row)}>
                {formatRun(row)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-muted-foreground" title={row.owner}>
                  {row.owner}
                </span>
                {row.migrationState !== 'none' ? (
                  <Badge variant={row.migrationState === 'conflict' ? 'destructive' : 'secondary'}>
                    {row.migrationState}
                  </Badge>
                ) : null}
              </span>
              <span className="truncate text-muted-foreground" title={row.host}>
                {row.host}
              </span>
              <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                {row.agentId ? (
                  <>
                    <AgentIcon agent={row.agentId} size={14} />
                    <span className="truncate">{getAgentLabel(row.agentId)}</span>
                  </>
                ) : (
                  <ScrollText className="size-3.5" />
                )}
              </span>
            </button>
          ))}
        </div>
        {!loading && rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {translate(
              'auto.components.automations.unified.noMatchingItems',
              'No items match these filters.'
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}
