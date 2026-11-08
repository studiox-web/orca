import { defineFixture } from '../../component-fixtures/component-fixture'
import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow
} from '../../../../shared/unified-automation-types'
import { UnifiedAutomationListRows } from './UnifiedAutomationListRows'

const authority = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}

function row(
  name: string,
  project: string,
  projectKey: string,
  area: UnifiedAutomationRow['area'],
  kind: UnifiedAutomationKind,
  scheduleState: UnifiedAutomationRow['scheduleState']
): UnifiedAutomationRow {
  const identity =
    kind === 'goal'
      ? ({ kind, authority, projectKey, goal: name } as const)
      : kind === 'automation'
        ? ({ kind, authority, automationId: name } as const)
        : kind === 'script'
          ? ({ kind, authority, sourceId: name } as const)
          : ({ kind, authority, managerId: 'manager', jobId: name } as const)
  return {
    key: `${projectKey}:${name}`,
    identity,
    kind,
    name,
    project,
    projectKey,
    area,
    host: 'Local Linux',
    owner: kind === 'goal' ? 'Goal files' : kind === 'script' ? 'Legacy cron' : 'Orca',
    lifecycle: { state: kind === 'goal' ? 'active' : 'present', stage: 'Ready' },
    scheduleState,
    scheduleChildren: [],
    runSummary: name.includes('Audit')
      ? {
          source: 'native',
          sourceId: 'run-1',
          identity: 'stable',
          outcome: 'succeeded',
          sourceStatus: 'completed',
          at: '2026-11-08T18:00:00.000Z',
          authorityAttribution: { authority, evidence: 'source' }
        }
      : null,
    agentId: kind === 'script' ? null : 'codex',
    migrationState: kind === 'script' ? 'legacy' : 'none',
    sourceRefs: [],
    warnings:
      kind === 'script'
        ? [{ code: 'legacy-source-identity', message: 'Revision-scoped legacy source.' }]
        : [],
    readOnly: true
  }
}

const rows = [
  row(
    'Content Editor',
    'djvibe.com',
    '/projects/djvibe.com',
    { id: 'content', title: 'Content' },
    'goal',
    'paused'
  ),
  row(
    'Content Audit',
    'djvibe.com',
    '/projects/djvibe.com',
    { id: 'content', title: 'Content' },
    'goal',
    'enabled'
  ),
  row(
    'Campaign Planner',
    'djvibe.com',
    '/projects/djvibe.com',
    { id: 'marketing', title: 'Marketing' },
    'goal',
    'unscheduled'
  ),
  row('Database backup', 'djvibe.com', '/projects/djvibe.com', null, 'script', 'paused'),
  row(
    'Release Audit',
    'orca-fork',
    '/projects/orca-fork',
    { id: 'engineering', title: 'Engineering' },
    'goal',
    'enabled'
  ),
  row('Upstream update', 'orca-fork', '/projects/orca-fork', null, 'automation', 'enabled')
]

function List({ forceExpanded }: { forceExpanded: boolean }): React.JSX.Element {
  return (
    <div className="flex h-[720px] flex-col bg-background p-4">
      <UnifiedAutomationListRows
        rows={rows}
        loading={false}
        groupMode="project-area"
        forceExpanded={forceExpanded}
        onOpen={() => undefined}
      />
    </div>
  )
}

export const grouped = defineFixture({ width: 1400, render: () => <List forceExpanded={false} /> })
export const groupedExpanded = defineFixture({
  width: 1400,
  render: () => <List forceExpanded />
})
export const mobileExpanded = defineFixture({ width: 390, render: () => <List forceExpanded /> })
