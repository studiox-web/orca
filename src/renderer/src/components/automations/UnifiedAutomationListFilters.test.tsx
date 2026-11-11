// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import {
  filterUnifiedAutomationRows,
  INITIAL_UNIFIED_AUTOMATION_FILTERS,
  unifiedAutomationProjectOptions
} from './unified-automation-filter-model'
import { UnifiedAutomationListFilters } from './UnifiedAutomationListFilters'
import { unifiedProjectGroupKey } from './unified-automation-grouping'

afterEach(cleanup)

const local = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}

function row(name: string, projectKey: string, areaTitle: string): UnifiedAutomationRow {
  return {
    key: `${projectKey}:${name}`,
    identity: { kind: 'goal', authority: local, projectKey, goal: name },
    kind: 'goal',
    name,
    project: 'Website',
    projectKey,
    area: { id: areaTitle.toLowerCase(), title: areaTitle },
    host: 'This device',
    owner: 'Goal files',
    lifecycle: { state: 'active', stage: null },
    scheduleState: 'unscheduled',
    scheduleChildren: [],
    runSummary: null,
    agentId: 'codex',
    migrationState: 'none',
    sourceRefs: [],
    warnings: [],
    readOnly: true
  }
}

describe('UnifiedAutomationListFilters', () => {
  it('labels primary controls instead of rendering indistinguishable All values', () => {
    render(
      <UnifiedAutomationListFilters
        rows={[]}
        query=""
        filters={INITIAL_UNIFIED_AUTOMATION_FILTERS}
        groupMode="project-area"
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onGroupModeChange={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Lifecycle' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  })

  it('maps No grouping to the renderer none mode', async () => {
    const onGroupModeChange = vi.fn()
    render(
      <UnifiedAutomationListFilters
        rows={[]}
        query=""
        filters={INITIAL_UNIFIED_AUTOMATION_FILTERS}
        groupMode="project-area"
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onGroupModeChange={onGroupModeChange}
      />
    )

    await userEvent.click(screen.getByRole('combobox', { name: 'Group' }))
    await userEvent.click(screen.getByRole('option', { name: 'No grouping' }))
    expect(onGroupModeChange).toHaveBeenCalledWith('none')
  })

  it('filters same-named projects by exact qualified project key and searches areas', () => {
    const first = row('Writer', '/projects/website-a', 'Editorial')
    const second = row('Editor', '/projects/website-b', 'Operations')
    const filters = {
      ...INITIAL_UNIFIED_AUTOMATION_FILTERS,
      project: unifiedProjectGroupKey(first)
    }

    expect(filterUnifiedAutomationRows([first, second], '', filters)).toEqual([first])
    expect(
      filterUnifiedAutomationRows([first, second], 'operations', INITIAL_UNIFIED_AUTOMATION_FILTERS)
    ).toEqual([second])
  })

  it('includes host context in same-named project choices', () => {
    const localRow = row('Writer', '/projects/website-a', 'Editorial')
    const remoteRow = {
      ...row('Editor', '/projects/website-b', 'Operations'),
      host: 'Build server',
      identity: {
        kind: 'goal' as const,
        authority: {
          authority: { kind: 'runtime' as const, environmentId: 'server-1' },
          selector: { kind: 'self' as const }
        },
        projectKey: '/projects/website-b',
        goal: 'Editor'
      }
    }

    expect(
      unifiedAutomationProjectOptions([localRow, remoteRow]).map((option) => option.label)
    ).toEqual(['Website — Build server', 'Website — This device'])
  })
})
