import React from 'react'
import { ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import {
  countUnifiedAutomationFilters,
  INITIAL_UNIFIED_AUTOMATION_FILTERS,
  isUnifiedMigrationFilter,
  isUnifiedRunFilter,
  isUnifiedScheduleFilter,
  unifiedAutomationDistinctOptions,
  type UnifiedAutomationFilterOption,
  type UnifiedAutomationFilterState
} from './unified-automation-filter-model'

export function unifiedAutomationAgentLabel(value: string): string {
  return isTuiAgent(value) ? getAgentLabel(value) : value
}

function AdvancedFilter({
  label,
  value,
  options,
  allLabel,
  onChange
}: {
  label: string
  value: string
  options: readonly UnifiedAutomationFilterOption[]
  allLabel: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div className="scrollbar-sleek max-h-80 overflow-y-auto">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuRadioItem value="all">{allLabel}</DropdownMenuRadioItem>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function UnifiedAutomationAdvancedFilters({
  rows,
  filters,
  onChange
}: {
  rows: readonly UnifiedAutomationRow[]
  filters: UnifiedAutomationFilterState
  onChange: (value: UnifiedAutomationFilterState) => void
}): React.JSX.Element {
  const set = <K extends keyof UnifiedAutomationFilterState>(
    key: K,
    value: UnifiedAutomationFilterState[K]
  ): void => onChange({ ...filters, [key]: value })
  const keys = [
    'host',
    'owner',
    'migration',
    'schedule',
    'run',
    'agent'
  ] as const satisfies readonly (keyof UnifiedAutomationFilterState)[]
  const activeCount = keys.filter((key) => filters[key] !== 'all').length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8">
          <ListFilter className="size-3.5" />
          {translate('auto.components.automations.AutomationListFilterMenu.filters', 'Filters')}
          {activeCount > 0 ? (
            <span className="rounded-full bg-foreground px-1.5 text-3xs font-semibold leading-4 text-background">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <AdvancedFilter
          label={translate('auto.components.automations.unified.filterHost', 'Host')}
          value={filters.host}
          allLabel={translate('auto.components.automations.unified.allHosts', 'All hosts')}
          options={unifiedAutomationDistinctOptions(
            rows,
            (row) => row.host,
            (value) => value
          )}
          onChange={(value) => set('host', value)}
        />
        <AdvancedFilter
          label={translate('auto.components.automations.unified.filterOwner', 'Owner')}
          value={filters.owner}
          allLabel={translate('auto.components.automations.unified.allSources', 'All sources')}
          options={unifiedAutomationDistinctOptions(
            rows,
            (row) => row.owner,
            (value) => value
          )}
          onChange={(value) => set('owner', value)}
        />
        <AdvancedFilter
          label={translate('auto.components.automations.unified.filterMigration', 'Migration')}
          value={filters.migration}
          allLabel={translate(
            'auto.components.automations.unified.allMigrationStates',
            'All states'
          )}
          options={unifiedAutomationDistinctOptions(rows, (row) => row.migrationState)}
          onChange={(value) => {
            if (isUnifiedMigrationFilter(value)) {
              set('migration', value)
            }
          }}
        />
        <AdvancedFilter
          label={translate(
            'auto.components.automations.unified.filterScheduleStatus',
            'Schedule status'
          )}
          value={filters.schedule}
          allLabel={translate(
            'auto.components.automations.unified.allScheduleStates',
            'All states'
          )}
          options={unifiedAutomationDistinctOptions(rows, (row) => row.scheduleState)}
          onChange={(value) => {
            if (isUnifiedScheduleFilter(value)) {
              set('schedule', value)
            }
          }}
        />
        <AdvancedFilter
          label={translate('auto.components.automations.unified.filterLastRun', 'Last run')}
          value={filters.run}
          allLabel={translate('auto.components.automations.unified.allRunOutcomes', 'All outcomes')}
          options={unifiedAutomationDistinctOptions(
            rows,
            (row) => row.runSummary?.outcome ?? 'never'
          )}
          onChange={(value) => {
            if (isUnifiedRunFilter(value)) {
              set('run', value)
            }
          }}
        />
        <AdvancedFilter
          label={translate('auto.components.automations.unified.filterAgent', 'Agent')}
          value={filters.agent}
          allLabel={translate('auto.components.automations.unified.allAgents', 'All agents')}
          options={unifiedAutomationDistinctOptions(
            rows,
            (row) => row.agentId,
            unifiedAutomationAgentLabel
          )}
          onChange={(value) => set('agent', value)}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={countUnifiedAutomationFilters(filters) === 0}
          onSelect={() => onChange(INITIAL_UNIFIED_AUTOMATION_FILTERS)}
        >
          {translate(
            'auto.components.automations.AutomationListFilterMenu.clearAll',
            'Clear all filters'
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
