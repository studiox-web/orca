import { hostStableKey } from '../../../../shared/automation-owner-key'
import {
  normalizeRuntimePathForComparison,
  runtimePathDisplayName
} from '../../../../shared/cross-platform-path'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'

export type UnifiedAutomationGroupMode = 'project-area' | 'project' | 'none'

export type UnifiedAutomationAreaGroup = {
  key: string
  label: string
  rows: UnifiedAutomationRow[]
}

export type UnifiedAutomationProjectGroup = {
  key: string
  label: string
  detail: string | null
  host: string
  authority: string
  rows: UnifiedAutomationRow[]
  areas: UnifiedAutomationAreaGroup[]
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\')
}

export function projectDisplayLabel(row: UnifiedAutomationRow): string {
  const label = row.project?.trim()
  if (label && !isPathLike(label)) {
    return label
  }
  const path = label || row.projectKey?.trim()
  if (!path) {
    return 'Unassigned project'
  }
  return runtimePathDisplayName(path) ?? path
}

export function unifiedProjectGroupKey(row: UnifiedAutomationRow): string {
  const authority = hostStableKey(row.identity.authority)
  return row.projectKey
    ? `${authority}|project:${normalizeRuntimePathForComparison(row.projectKey)}`
    : `${authority}|project:unassigned`
}

export function unifiedAreaGroupKey(row: UnifiedAutomationRow): string {
  return `${unifiedProjectGroupKey(row)}|area:${row.area?.id ?? 'unassigned'}`
}

function projectDetail(row: UnifiedAutomationRow): string | null {
  if (!row.projectKey || row.projectKey === row.project || !isPathLike(row.projectKey)) {
    return null
  }
  return row.projectKey
}

function areaLabel(row: UnifiedAutomationRow): string {
  if (row.area) {
    return row.area.title
  }
  return row.kind === 'goal' ? 'Unassigned area' : 'Project-level automations'
}

export function groupUnifiedAutomationRows(
  rows: readonly UnifiedAutomationRow[]
): UnifiedAutomationProjectGroup[] {
  const projects = new Map<string, UnifiedAutomationProjectGroup>()
  for (const row of rows) {
    const projectKey = unifiedProjectGroupKey(row)
    let project = projects.get(projectKey)
    if (!project) {
      project = {
        key: projectKey,
        label: projectDisplayLabel(row),
        detail: projectDetail(row),
        host: row.host,
        authority: hostStableKey(row.identity.authority),
        rows: [],
        areas: []
      }
      projects.set(projectKey, project)
    }
    project.rows.push(row)
  }

  for (const project of projects.values()) {
    const areas = new Map<string, UnifiedAutomationAreaGroup>()
    for (const row of project.rows) {
      const key = unifiedAreaGroupKey(row)
      const existing = areas.get(key)
      if (existing) {
        existing.rows.push(row)
      } else {
        areas.set(key, { key, label: areaLabel(row), rows: [row] })
      }
    }
    project.areas = [...areas.values()].sort(
      (left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key)
    )
    project.rows.sort(
      (left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key)
    )
  }

  return [...projects.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key)
  )
}
