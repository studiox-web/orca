import React from 'react'
import {
  Archive,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Folder,
  Plug,
  ScrollText,
  Target,
  TerminalSquare
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow,
  UnifiedAutomationWarning
} from '../../../../shared/unified-automation-types'
import {
  groupUnifiedAutomationRows,
  projectDisplayLabel,
  type UnifiedAutomationGroupMode
} from './unified-automation-grouping'

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

function humanize(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatRun(row: UnifiedAutomationRow): string {
  if (!row.runSummary) {
    return translate('auto.components.automations.unified.noRuns', 'No runs')
  }
  const time = row.runSummary.at
    ? new Date(row.runSummary.at).toLocaleString(getIntlLocale())
    : translate('auto.components.automations.unified.timeUnavailable', 'Time unavailable')
  return `${humanize(row.runSummary.outcome)} · ${time}`
}

function scheduleLabel(row: UnifiedAutomationRow): string {
  const first = row.scheduleChildren[0]
  if (!first) {
    return translate('auto.components.automations.unified.unscheduled', 'Unscheduled')
  }
  return `${first.expression}${row.scheduleChildren.length > 1 ? ` +${row.scheduleChildren.length - 1}` : ''}`
}

function warningTone(warnings: readonly UnifiedAutomationWarning[]): 'error' | 'warning' | 'info' {
  if (
    warnings.some((warning) =>
      [
        'binding-conflict',
        'config-attribution-conflict',
        'duplicate-native-identity',
        'run-attribution-conflict'
      ].includes(warning.code)
    )
  ) {
    return 'error'
  }
  if (
    warnings.some((warning) =>
      ['binding-target-missing', 'source-unavailable', 'stale-source'].includes(warning.code)
    )
  ) {
    return 'warning'
  }
  return 'info'
}

function RowIdentity({ row }: { row: UnifiedAutomationRow }): React.JSX.Element {
  const tone = warningTone(row.warnings)
  const context = [projectDisplayLabel(row), row.area?.title].filter(Boolean).join(' · ')
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-2 font-medium">
        {row.lifecycle.state === 'archived' ? (
          <Archive className="size-3.5 shrink-0" />
        ) : (
          <span className="shrink-0">{typeIcon(row.kind)}</span>
        )}
        <span className="truncate">{row.name}</span>
        {row.warnings.length > 0 ? (
          <CircleAlert
            aria-label={translate(
              'auto.components.automations.unified.sourceNotices',
              '{{count}} source notices',
              { count: row.warnings.length }
            )}
            className={cn(
              'size-3.5 shrink-0',
              tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            <title>{row.warnings.map((warning) => warning.message).join('\n')}</title>
          </CircleAlert>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {context || translate('auto.components.automations.unified.noProject', 'No project')}
      </span>
    </span>
  )
}

function DesktopRow({
  row,
  onOpen
}: {
  row: UnifiedAutomationRow
  onOpen: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-row-key={row.key}
      aria-label={`${row.name}, ${typeLabel(row.kind)}, ${projectDisplayLabel(row)}, ${humanize(row.scheduleState)}, ${formatRun(row)}`}
      onClick={() => onOpen(row)}
      className="grid w-full grid-cols-[minmax(220px,1.6fr)_90px_minmax(170px,1fr)_120px_170px_150px_140px_100px] gap-3 border-b border-border/50 bg-transparent px-3 py-2.5 text-left text-[13px] transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RowIdentity row={row} />
      <span>
        <Badge variant="outline">{typeLabel(row.kind)}</Badge>
      </span>
      <span className="min-w-0" title={scheduleLabel(row)}>
        <span className="block truncate text-muted-foreground">{scheduleLabel(row)}</span>
        <span
          className="block truncate text-xs text-muted-foreground"
          title={translate('auto.components.automations.unified.scheduleState', 'Schedule state')}
        >
          {row.scheduleChildren.length > 0
            ? humanize(row.scheduleState)
            : translate('auto.components.automations.unified.noScheduleOwner', 'No schedule owner')}
        </span>
      </span>
      <span className="truncate">{row.lifecycle.stage ?? humanize(row.lifecycle.state)}</span>
      <span className="truncate text-muted-foreground" title={formatRun(row)}>
        {formatRun(row)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-muted-foreground" title={row.owner}>
          {row.owner}
        </span>
        {row.migrationState !== 'none' ? (
          <Badge variant={row.migrationState === 'conflict' ? 'destructive' : 'secondary'}>
            {humanize(row.migrationState)}
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
  )
}

function CompactRow({
  row,
  onOpen
}: {
  row: UnifiedAutomationRow
  onOpen: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-row-key={row.key}
      aria-label={`${row.name}, ${typeLabel(row.kind)}, ${projectDisplayLabel(row)}, ${humanize(row.scheduleState)}, ${formatRun(row)}`}
      onClick={() => onOpen(row)}
      className="w-full border-b border-border/50 bg-transparent px-3 py-3 text-left text-[13px] transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <RowIdentity row={row} />
        <Badge variant="outline">{typeLabel(row.kind)}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{humanize(row.scheduleState)}</span>
        <span className="max-w-72 truncate">{formatRun(row)}</span>
        <span className="max-w-56 truncate">{row.host}</span>
        {row.agentId ? (
          <span className="flex items-center gap-1">
            <AgentIcon agent={row.agentId} size={12} /> {getAgentLabel(row.agentId)}
          </span>
        ) : null}
      </div>
    </button>
  )
}

function GroupedRows({
  rows,
  groupMode,
  forceExpanded,
  openGroups,
  setGroupOpen,
  renderRow
}: {
  rows: readonly UnifiedAutomationRow[]
  groupMode: UnifiedAutomationGroupMode
  forceExpanded: boolean
  openGroups: Readonly<Record<string, boolean>>
  setGroupOpen: (key: string, open: boolean) => void
  renderRow: (row: UnifiedAutomationRow) => React.ReactNode
}): React.JSX.Element {
  if (groupMode === 'none') {
    return <>{rows.map(renderRow)}</>
  }
  const projects = groupUnifiedAutomationRows(rows)
  return (
    <>
      {projects.map((project) => {
        const projectOpen = forceExpanded || (openGroups[project.key] ?? true)
        return (
          <Collapsible
            key={project.key}
            open={projectOpen}
            onOpenChange={(open) => setGroupOpen(project.key, open)}
          >
            <div className="border-b bg-muted/40 px-3">
              <CollapsibleTrigger variant="row">
                <ChevronRight
                  className={cn(
                    'size-4 shrink-0 transition-transform motion-reduce:transition-none',
                    projectOpen && 'rotate-90'
                  )}
                />
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{project.label}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {project.detail ? <span className="font-mono">{project.detail} · </span> : null}
                    {project.host} · <span className="font-mono">{project.authority}</span>
                  </span>
                </span>
                <Badge variant="secondary">{project.rows.length}</Badge>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent animation="height">
              {groupMode === 'project-area'
                ? project.areas.map((area) => {
                    const areaOpen = forceExpanded || (openGroups[area.key] ?? false)
                    return (
                      <Collapsible
                        key={area.key}
                        open={areaOpen}
                        onOpenChange={(open) => setGroupOpen(area.key, open)}
                      >
                        <div className="border-b bg-muted/20 pl-6 pr-3">
                          <CollapsibleTrigger variant="row">
                            <ChevronRight
                              className={cn(
                                'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                                areaOpen && 'rotate-90'
                              )}
                            />
                            <Building2 className="size-3.5 text-muted-foreground" />
                            <span className="flex-1 text-xs font-medium">{area.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {area.rows.length}
                            </span>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent animation="height">
                          <div>{area.rows.map(renderRow)}</div>
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })
                : project.rows.map(renderRow)}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </>
  )
}

export function UnifiedAutomationListRows({
  rows,
  loading,
  groupMode,
  forceExpanded,
  onOpen
}: {
  rows: readonly UnifiedAutomationRow[]
  loading: boolean
  groupMode: UnifiedAutomationGroupMode
  forceExpanded: boolean
  onOpen: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  const setGroupOpen = React.useCallback(
    (key: string, open: boolean) => setOpenGroups((current) => ({ ...current, [key]: open })),
    []
  )
  const empty = !loading && rows.length === 0
  return (
    <div className="scrollbar-sleek @container min-h-0 flex-1 overflow-auto rounded-md border">
      <div className="hidden min-w-[1268px] @[80rem]:block">
        <div
          aria-hidden
          className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1.6fr)_90px_minmax(170px,1fr)_120px_170px_150px_140px_100px] gap-3 border-b bg-background px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {[
            translate('auto.components.automations.unified.name', 'Name'),
            translate('auto.components.automations.unified.typeHeading', 'Type'),
            translate('auto.components.automations.unified.schedule', 'Schedule'),
            translate('auto.components.automations.unified.lifecycle', 'Lifecycle'),
            translate('auto.components.automations.unified.latestRun', 'Latest run'),
            translate('auto.components.automations.unified.sourceMigration', 'Source / migration'),
            translate('auto.components.automations.unified.host', 'Host'),
            translate('auto.components.automations.unified.agent', 'Agent')
          ].map((heading) => (
            <span key={heading}>{heading}</span>
          ))}
        </div>
        <GroupedRows
          rows={rows}
          groupMode={groupMode}
          forceExpanded={forceExpanded}
          openGroups={openGroups}
          setGroupOpen={setGroupOpen}
          renderRow={(row) => <DesktopRow key={row.key} row={row} onOpen={onOpen} />}
        />
      </div>
      <div className="@[80rem]:hidden">
        <GroupedRows
          rows={rows}
          groupMode={groupMode}
          forceExpanded={forceExpanded}
          openGroups={openGroups}
          setGroupOpen={setGroupOpen}
          renderRow={(row) => <CompactRow key={row.key} row={row} onOpen={onOpen} />}
        />
      </div>
      {empty ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {translate(
            'auto.components.automations.unified.noMatchingItems',
            'No items match these filters.'
          )}
        </p>
      ) : null}
    </div>
  )
}
