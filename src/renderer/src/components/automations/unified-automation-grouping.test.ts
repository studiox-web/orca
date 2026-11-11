import { describe, expect, it } from 'vitest'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationRow
} from '../../../../shared/unified-automation-types'
import {
  groupUnifiedAutomationRows,
  projectDisplayLabel,
  unifiedProjectGroupKey
} from './unified-automation-grouping'

const local = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}

function row(
  name: string,
  project: string | null,
  projectKey: string | null,
  area: UnifiedAutomationRow['area'] = null,
  identity: UnifiedAutomationIdentity = {
    kind: 'goal',
    authority: local,
    projectKey: projectKey ?? 'unassigned',
    goal: name
  }
): UnifiedAutomationRow {
  return {
    key: `${name}:${projectKey}`,
    identity,
    kind: identity.kind,
    name,
    project,
    projectKey,
    area,
    host: 'This device',
    owner: 'Goal files',
    lifecycle: { state: 'active', stage: null },
    scheduleState: 'unscheduled',
    scheduleChildren: [],
    runSummary: null,
    agentId: null,
    migrationState: 'none',
    sourceRefs: [],
    warnings: [],
    readOnly: true
  }
}

describe('unified automation grouping', () => {
  it('uses authority-qualified exact project keys instead of display names', () => {
    const first = row('Writer', 'Website', '/projects/website-a')
    const second = row('Editor', 'Website', '/projects/website-b')

    expect(unifiedProjectGroupKey(first)).not.toBe(unifiedProjectGroupKey(second))
    expect(groupUnifiedAutomationRows([first, second])).toHaveLength(2)
  })

  it('groups exact project and area identities and keeps project-level jobs separate', () => {
    const rows = [
      row('Writer', 'Website', '/projects/website', { id: 'content', title: 'Content' }),
      row('Editor', 'Website', '/projects/website', { id: 'content', title: 'Content' }),
      row('Backup', 'Website', '/projects/website', null, {
        kind: 'script',
        authority: local,
        sourceId: 'backup'
      })
    ]

    const [project] = groupUnifiedAutomationRows(rows)
    expect(project.rows).toHaveLength(3)
    expect(project.areas.map((area) => [area.label, area.rows.length])).toEqual([
      ['Content', 2],
      ['Project-level automations', 1]
    ])
  })

  it('shows a friendly label for unmatched paths while retaining exact path identity', () => {
    const item = row(
      'Backup',
      '/home/djvibe/projects/djvibe.com',
      '/home/djvibe/projects/djvibe.com'
    )

    expect(projectDisplayLabel(item)).toBe('djvibe.com')
    expect(unifiedProjectGroupKey(item)).toContain('/home/djvibe/projects/djvibe.com')
  })
})
