import React from 'react'
import {
  Archive,
  CalendarClock,
  CircleAlert,
  Plug,
  ScrollText,
  Target,
  TerminalSquare
} from 'lucide-react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
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
