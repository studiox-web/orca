import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow,
  UnifiedMigrationState,
  UnifiedRunOutcome,
  UnifiedScheduleState
} from '../../../../shared/unified-automation-types'
import { hostStableKey } from '../../../../shared/automation-owner-key'
import { projectDisplayLabel, unifiedProjectGroupKey } from './unified-automation-grouping'

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

export type UnifiedAutomationFilterOption = { value: string; label: string }

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

export const UNIFIED_AUTOMATION_FILTER_KEYS = [
  'kind',
  'project',
  'host',
  'owner',
  'migration',
  'schedule',
  'run',
  'agent',
  'lifecycle'
] as const satisfies readonly (keyof UnifiedAutomationFilterState)[]

export function isUnifiedKindFilter(value: string): value is UnifiedAutomationFilterState['kind'] {
  return ['all', 'goal', 'automation', 'script', 'external'].includes(value)
}

export function isUnifiedMigrationFilter(
  value: string
): value is UnifiedAutomationFilterState['migration'] {
  return ['all', 'none', 'legacy', 'paired', 'conflict'].includes(value)
}

export function isUnifiedScheduleFilter(
  value: string
): value is UnifiedAutomationFilterState['schedule'] {
  return ['all', 'enabled', 'paused', 'mixed', 'unscheduled'].includes(value)
}

export function isUnifiedRunFilter(value: string): value is UnifiedAutomationFilterState['run'] {
  return [
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
  ].includes(value)
}

export function isUnifiedLifecycleFilter(
  value: string
): value is UnifiedAutomationFilterState['lifecycle'] {
  return ['all', 'current', 'archived'].includes(value)
}

export function humanizeUnifiedAutomationValue(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function unifiedAutomationDistinctOptions(
  rows: readonly UnifiedAutomationRow[],
  read: (row: UnifiedAutomationRow) => string | null,
  label: (value: string) => string = humanizeUnifiedAutomationValue
): UnifiedAutomationFilterOption[] {
  const values = new Set<string>()
  for (const row of rows) {
    const value = read(row)
    if (value) {
      values.add(value)
    }
  }
  return [...values]
    .sort((left, right) => label(left).localeCompare(label(right)))
    .map((value) => ({ value, label: label(value) }))
}

export function unifiedAutomationProjectOptions(
  rows: readonly UnifiedAutomationRow[]
): UnifiedAutomationFilterOption[] {
  const projects = new Map<string, { label: string; host: string; authority: string }>()
  for (const row of rows) {
    const key = unifiedProjectGroupKey(row)
    if (!projects.has(key)) {
      projects.set(key, {
        label: projectDisplayLabel(row),
        host: row.host,
        authority: hostStableKey(row.identity.authority)
      })
    }
  }
  const duplicates = new Map<string, number>()
  for (const project of projects.values()) {
    const key = `${project.label}|${project.host}`
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1)
  }
  return [...projects]
    .map(([value, project]) => {
      const duplicate = (duplicates.get(`${project.label}|${project.host}`) ?? 0) > 1
      return {
        value,
        label: `${project.label} — ${project.host}${duplicate ? ` — ${project.authority}` : ''}`
      }
    })
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) || left.value.localeCompare(right.value)
    )
}

export function countUnifiedAutomationFilters(filters: UnifiedAutomationFilterState): number {
  return UNIFIED_AUTOMATION_FILTER_KEYS.filter(
    (key) => filters[key] !== INITIAL_UNIFIED_AUTOMATION_FILTERS[key]
  ).length
}

export function hasActiveUnifiedAutomationFilters(filters: UnifiedAutomationFilterState): boolean {
  return countUnifiedAutomationFilters(filters) > 0
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
    if (filters.project !== 'all' && unifiedProjectGroupKey(row) !== filters.project) {
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
    return [
      row.name,
      row.project,
      row.projectKey,
      row.area?.title,
      row.area?.id,
      row.host,
      row.owner,
      sourceIds,
      goalSlug
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle)
  })
}
