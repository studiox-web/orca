import React from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import {
  humanizeUnifiedAutomationValue,
  INITIAL_UNIFIED_AUTOMATION_FILTERS,
  isUnifiedKindFilter,
  isUnifiedLifecycleFilter,
  UNIFIED_AUTOMATION_FILTER_KEYS,
  unifiedAutomationProjectOptions,
  type UnifiedAutomationFilterOption,
  type UnifiedAutomationFilterState
} from './unified-automation-filter-model'
import type { UnifiedAutomationGroupMode } from './unified-automation-grouping'
import {
  UnifiedAutomationAdvancedFilters,
  unifiedAutomationAgentLabel
} from './UnifiedAutomationAdvancedFilters'

function kindLabel(value: string): string {
  return value === 'goal'
    ? translate('auto.components.automations.unified.kindGoal', 'Goal')
    : value === 'automation'
      ? translate('auto.components.automations.unified.kindAutomation', 'Automation')
      : value === 'script'
        ? translate('auto.components.automations.unified.kindScript', 'Script')
        : translate('auto.components.automations.unified.kindExternal', 'External')
}

function isGroupMode(value: string): value is UnifiedAutomationGroupMode {
  return value === 'none' || value === 'project' || value === 'project-area'
}

function LabeledSelect({
  label,
  value,
  options,
  allLabel,
  allValue = 'all',
  className,
  onChange
}: {
  label: string
  value: string
  options: readonly UnifiedAutomationFilterOption[]
  allLabel: string
  allValue?: string
  className?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" density="compact" aria-label={label} className={className}>
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allValue}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function filterValueLabel(
  key: keyof UnifiedAutomationFilterState,
  value: string,
  rows: readonly UnifiedAutomationRow[]
): string {
  if (key === 'kind') {
    return kindLabel(value)
  }
  if (key === 'project') {
    return (
      unifiedAutomationProjectOptions(rows).find((option) => option.value === value)?.label ?? value
    )
  }
  if (key === 'agent') {
    return unifiedAutomationAgentLabel(value)
  }
  return humanizeUnifiedAutomationValue(value)
}

function FilterPills({
  rows,
  filters,
  onChange
}: {
  rows: readonly UnifiedAutomationRow[]
  filters: UnifiedAutomationFilterState
  onChange: (value: UnifiedAutomationFilterState) => void
}): React.JSX.Element | null {
  const labels: Record<keyof UnifiedAutomationFilterState, string> = {
    kind: translate('auto.components.automations.unified.filterType', 'Type'),
    project: translate('auto.components.automations.unified.filterProject', 'Project'),
    host: translate('auto.components.automations.unified.filterHost', 'Host'),
    owner: translate('auto.components.automations.unified.filterOwner', 'Owner'),
    migration: translate('auto.components.automations.unified.filterMigration', 'Migration'),
    schedule: translate(
      'auto.components.automations.unified.filterScheduleStatus',
      'Schedule status'
    ),
    run: translate('auto.components.automations.unified.filterLastRun', 'Last run'),
    agent: translate('auto.components.automations.unified.filterAgent', 'Agent'),
    lifecycle: translate('auto.components.automations.unified.filterLifecycle', 'Lifecycle')
  }
  const active = UNIFIED_AUTOMATION_FILTER_KEYS.filter(
    (key) => filters[key] !== INITIAL_UNIFIED_AUTOMATION_FILTERS[key]
  )
  if (active.length === 0) {
    return null
  }
  return (
    <div
      className="flex flex-wrap gap-1.5"
      aria-label={translate('auto.components.automations.unified.activeFilters', 'Active filters')}
    >
      {active.map((key) => (
        <span
          key={key}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-muted/50 pl-2 pr-1 text-2xs"
        >
          <span className="text-muted-foreground">{labels[key]}:</span>
          <span className="max-w-40 truncate font-medium">
            {filterValueLabel(key, filters[key], rows)}
          </span>
          <button
            type="button"
            aria-label={translate(
              'auto.components.automations.AutomationListFilterMenu.removeFilter',
              'Remove {{value0}} filter',
              { value0: labels[key] }
            )}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange({ ...filters, [key]: INITIAL_UNIFIED_AUTOMATION_FILTERS[key] })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

export function UnifiedAutomationListFilters({
  rows,
  query,
  filters,
  groupMode,
  onQueryChange,
  onFiltersChange,
  onGroupModeChange
}: {
  rows: readonly UnifiedAutomationRow[]
  query: string
  filters: UnifiedAutomationFilterState
  groupMode: UnifiedAutomationGroupMode
  onQueryChange: (value: string) => void
  onFiltersChange: (value: UnifiedAutomationFilterState) => void
  onGroupModeChange: (value: UnifiedAutomationGroupMode) => void
}): React.JSX.Element {
  const set = <K extends keyof UnifiedAutomationFilterState>(
    key: K,
    value: UnifiedAutomationFilterState[K]
  ): void => onFiltersChange({ ...filters, [key]: value })
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={translate(
            'auto.components.automations.unified.searchPlaceholderWithArea',
            'Search name, project, area, source ID…'
          )}
          aria-label={translate(
            'auto.components.automations.unified.searchPlaceholder',
            'Search name, project, source ID…'
          )}
          title={translate('auto.components.automations.unified.searchGoals', 'Search Goals')}
          className="h-8 min-w-64 flex-1"
        />
        <LabeledSelect
          label={translate('auto.components.automations.unified.filterType', 'Type')}
          value={filters.kind}
          allLabel={translate('auto.components.automations.unified.allTypes', 'All types')}
          options={['goal', 'automation', 'script', 'external'].map((value) => ({
            value,
            label: kindLabel(value)
          }))}
          className="w-auto min-w-32"
          onChange={(value) => {
            if (isUnifiedKindFilter(value)) {
              set('kind', value)
            }
          }}
        />
        <LabeledSelect
          label={translate('auto.components.automations.unified.filterProject', 'Project')}
          value={filters.project}
          allLabel={translate('auto.components.automations.unified.allProjects', 'All projects')}
          options={unifiedAutomationProjectOptions(rows)}
          className="w-auto min-w-40"
          onChange={(value) => set('project', value)}
        />
        <LabeledSelect
          label={translate('auto.components.automations.unified.filterLifecycle', 'Lifecycle')}
          value={filters.lifecycle}
          allLabel={translate('auto.components.automations.unified.filterAll', 'All')}
          options={[
            {
              value: 'current',
              label: translate('auto.components.automations.unified.lifecycleCurrent', 'Current')
            },
            {
              value: 'archived',
              label: translate('auto.components.automations.unified.lifecycleArchived', 'Archived')
            }
          ]}
          className="w-auto min-w-36"
          onChange={(value) => {
            if (isUnifiedLifecycleFilter(value)) {
              set('lifecycle', value)
            }
          }}
        />
        <LabeledSelect
          label={translate('auto.components.automations.unified.groupBy', 'Group')}
          value={groupMode}
          allLabel={translate('auto.components.automations.unified.noGrouping', 'No grouping')}
          allValue="none"
          options={[
            {
              value: 'project-area',
              label: translate(
                'auto.components.automations.unified.groupProjectArea',
                'Project & area'
              )
            },
            {
              value: 'project',
              label: translate('auto.components.automations.unified.groupProject', 'Project')
            }
          ]}
          className="w-auto min-w-44"
          onChange={(value) => {
            if (isGroupMode(value)) {
              onGroupModeChange(value)
            }
          }}
        />
        <UnifiedAutomationAdvancedFilters
          rows={rows}
          filters={filters}
          onChange={onFiltersChange}
        />
      </div>
      <FilterPills rows={rows} filters={filters} onChange={onFiltersChange} />
    </div>
  )
}
