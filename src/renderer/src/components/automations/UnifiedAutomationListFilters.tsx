import React from 'react'
import { getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow,
  UnifiedMigrationState,
  UnifiedRunOutcome,
  UnifiedScheduleState
} from '../../../../shared/unified-automation-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'

const KIND_FILTER_VALUES = ['all', 'goal', 'automation', 'script', 'external'] as const
const MIGRATION_FILTER_VALUES = ['all', 'none', 'legacy', 'paired', 'conflict'] as const
const SCHEDULE_FILTER_VALUES = ['all', 'enabled', 'paused', 'mixed', 'unscheduled'] as const
const RUN_FILTER_VALUES = [
  'all',
  'never',
  'running',
  'succeeded',
  'failed',
  'limited',
  'skipped',
  'timed-out',
  'cancelled',
  'unknown'
] as const
const LIFECYCLE_FILTER_VALUES = ['all', 'current', 'archived'] as const

export type UnifiedAutomationFilterState = {
  kind: 'all' | UnifiedAutomationKind
  project: string
  host: string
  owner: string
  migration: 'all' | UnifiedMigrationState
  schedule: 'all' | UnifiedScheduleState
  run: 'all' | UnifiedRunOutcome | 'never'
  agent: string
  lifecycle: 'current' | 'archived' | 'all'
}

export const INITIAL_UNIFIED_AUTOMATION_FILTERS: UnifiedAutomationFilterState = {
  kind: 'all',
  project: 'all',
  host: 'all',
  owner: 'all',
  migration: 'all',
  schedule: 'all',
  run: 'all',
  agent: 'all',
  lifecycle: 'current'
}

const identityLabel = (value: string): string => value

function isFilterValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((candidate) => candidate === value)
}

function kindLabel(value: string): string {
  if (value === 'goal') {
    return translate('auto.components.automations.unified.kindGoal', 'Goal')
  }
  if (value === 'automation') {
    return translate('auto.components.automations.unified.kindAutomation', 'Automation')
  }
  if (value === 'script') {
    return translate('auto.components.automations.unified.kindScript', 'Script')
  }
  return translate('auto.components.automations.unified.kindExternal', 'External')
}

function agentLabel(value: string): string {
  return isTuiAgent(value) ? getAgentLabel(value) : value
}

function selectValues(
  rows: readonly UnifiedAutomationRow[],
  field: 'project' | 'host' | 'owner'
): string[] {
  return [
    ...new Set(rows.map((row) => row[field]).filter((value): value is string => Boolean(value)))
  ].sort((a, b) => a.localeCompare(b))
}

function FilterSelect({
  label,
  value,
  values,
  formatLabel = identityLabel,
  onChange
}: {
  label: string
  value: string
  values: readonly string[]
  formatLabel?: (value: string) => string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" density="compact" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {translate('auto.components.automations.unified.filterAll', 'All')}
        </SelectItem>
        {values.map((entry) => (
          <SelectItem key={entry} value={entry}>
            {formatLabel(entry)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function UnifiedAutomationListFilters({
  rows,
  query,
  filters,
  onQueryChange,
  onFiltersChange
}: {
  rows: readonly UnifiedAutomationRow[]
  query: string
  filters: UnifiedAutomationFilterState
  onQueryChange: (value: string) => void
  onFiltersChange: (value: UnifiedAutomationFilterState) => void
}): React.JSX.Element {
  const set = <K extends keyof UnifiedAutomationFilterState>(
    key: K,
    value: UnifiedAutomationFilterState[K]
  ): void => onFiltersChange({ ...filters, [key]: value })
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={translate(
          'auto.components.automations.unified.searchPlaceholder',
          'Search name, project, source ID…'
        )}
        aria-label={translate('auto.components.automations.unified.searchGoals', 'Search Goals')}
        className="h-8 min-w-56 max-w-sm"
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterType', 'Type')}
        value={filters.kind}
        values={['goal', 'automation', 'script', 'external']}
        formatLabel={kindLabel}
        onChange={(value) => {
          if (isFilterValue(KIND_FILTER_VALUES, value)) {
            set('kind', value)
          }
        }}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterProject', 'Project')}
        value={filters.project}
        values={selectValues(rows, 'project')}
        onChange={(value) => set('project', value)}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterHost', 'Host')}
        value={filters.host}
        values={selectValues(rows, 'host')}
        onChange={(value) => set('host', value)}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterOwner', 'Owner')}
        value={filters.owner}
        values={selectValues(rows, 'owner')}
        onChange={(value) => set('owner', value)}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterMigration', 'Migration')}
        value={filters.migration}
        values={[...new Set(rows.map((row) => row.migrationState))].sort()}
        onChange={(value) => {
          if (isFilterValue(MIGRATION_FILTER_VALUES, value)) {
            set('migration', value)
          }
        }}
      />
      <FilterSelect
        label={translate(
          'auto.components.automations.unified.filterScheduleStatus',
          'Schedule status'
        )}
        value={filters.schedule}
        values={[...new Set(rows.map((row) => row.scheduleState))].sort()}
        onChange={(value) => {
          if (isFilterValue(SCHEDULE_FILTER_VALUES, value)) {
            set('schedule', value)
          }
        }}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterLastRun', 'Last run')}
        value={filters.run}
        values={[...new Set(rows.map((row) => row.runSummary?.outcome ?? 'never'))].sort()}
        onChange={(value) => {
          if (isFilterValue(RUN_FILTER_VALUES, value)) {
            set('run', value)
          }
        }}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterAgent', 'Agent')}
        value={filters.agent}
        values={[...new Set(rows.flatMap((row) => (row.agentId ? [row.agentId] : [])))].sort()}
        formatLabel={agentLabel}
        onChange={(value) => set('agent', value)}
      />
      <FilterSelect
        label={translate('auto.components.automations.unified.filterLifecycle', 'Lifecycle')}
        value={filters.lifecycle}
        values={['current', 'archived']}
        onChange={(value) => {
          if (isFilterValue(LIFECYCLE_FILTER_VALUES, value)) {
            set('lifecycle', value)
          }
        }}
      />
    </div>
  )
}

export function filterUnifiedAutomationRows(
  rows: readonly UnifiedAutomationRow[],
  query: string,
  filters: UnifiedAutomationFilterState
): UnifiedAutomationRow[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filters.kind !== 'all' && row.kind !== filters.kind) {
      return false
    }
    if (filters.project !== 'all' && row.project !== filters.project) {
      return false
    }
    if (filters.host !== 'all' && row.host !== filters.host) {
      return false
    }
    if (filters.owner !== 'all' && row.owner !== filters.owner) {
      return false
    }
    if (filters.migration !== 'all' && row.migrationState !== filters.migration) {
      return false
    }
    if (filters.schedule !== 'all' && row.scheduleState !== filters.schedule) {
      return false
    }
    if (filters.run === 'never' && row.runSummary !== null) {
      return false
    }
    if (
      filters.run !== 'all' &&
      filters.run !== 'never' &&
      row.runSummary?.outcome !== filters.run
    ) {
      return false
    }
    if (filters.agent !== 'all' && row.agentId !== filters.agent) {
      return false
    }
    if (filters.lifecycle === 'current' && row.lifecycle.state === 'archived') {
      return false
    }
    if (filters.lifecycle === 'archived' && row.lifecycle.state !== 'archived') {
      return false
    }
    if (!needle) {
      return true
    }
    const sourceIds = row.sourceRefs.map((source) => source.sourceId).join(' ')
    const goalSlug = row.identity.kind === 'goal' ? row.identity.goal : ''
    return [row.name, row.project, row.host, row.owner, sourceIds, goalSlug]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle)
  })
}
