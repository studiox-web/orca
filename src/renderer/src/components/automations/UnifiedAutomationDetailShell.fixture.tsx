import type React from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { unifiedDetailSelection } from '../../../../shared/unified-automation-detail'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import { UnifiedAutomationDetailShell } from './UnifiedAutomationDetailShell'

const authority = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}
const goalSource = {
  kind: 'goal' as const,
  authority,
  sourceId: '/projects/orca:review',
  revision: 'goal-revision',
  ownerKey: null,
  label: 'Goal files'
}
const cronSource = {
  kind: 'legacy-cron' as const,
  authority,
  sourceId: 'goal:/projects/orca:review:0',
  revision: 'cron-revision',
  ownerKey: null,
  label: 'Legacy cron'
}
const nativeSource = {
  kind: 'native-automation' as const,
  authority,
  sourceId: 'automation-1',
  revision: '42',
  ownerKey: 'owner:desktop:self',
  label: 'Orca'
}
const row: UnifiedAutomationRow = {
  key: 'goal-key',
  identity: { kind: 'goal', authority, projectKey: '/projects/orca', goal: 'review' },
  kind: 'goal',
  name: 'Nightly review',
  project: 'Orca',
  projectKey: '/projects/orca',
  host: 'This device',
  owner: 'Goal files + legacy cron + Orca',
  lifecycle: { state: 'active', stage: 'Ready' },
  scheduleState: 'mixed',
  scheduleChildren: [
    {
      key: 'cron',
      owner: 'legacy-cron',
      format: 'cron',
      expression: '0 5 * * *',
      timezone: null,
      timezoneLabel: 'Host/crontab timezone',
      enabled: false,
      nextRunAt: null,
      sourceRef: cronSource
    },
    {
      key: 'native',
      owner: 'orca',
      format: 'rrule',
      expression: 'FREQ=DAILY;BYHOUR=6',
      timezone: 'America/Vancouver',
      timezoneLabel: 'America/Vancouver',
      enabled: true,
      nextRunAt: '2026-11-09T14:00:00.000Z',
      sourceRef: nativeSource
    }
  ],
  runSummary: {
    source: 'native',
    sourceId: 'run-1',
    identity: 'stable',
    outcome: 'succeeded',
    sourceStatus: 'completed',
    at: '2026-11-08T12:00:00.000Z',
    authorityAttribution: { authority, evidence: 'run-context' }
  },
  agentId: 'codex',
  migrationState: 'paired',
  sourceRefs: [goalSource, cronSource, nativeSource],
  warnings: [
    {
      code: 'legacy-source-identity',
      message: 'Legacy cron remains revision-scoped and read-only.'
    }
  ],
  readOnly: true
}

function renderDetail(): React.JSX.Element {
  return (
    <div className="h-[900px]">
      <UnifiedAutomationDetailShell
        selection={unifiedDetailSelection(row)}
        rows={[row]}
        lastKnownRow={row}
        onBack={() => undefined}
        onOpenGoal={() => undefined}
        canOpenNative={() => false}
        onOpenNative={() => undefined}
      />
    </div>
  )
}

export const mobile = defineFixture({ width: 390, render: renderDetail })
export const desktop = defineFixture({ width: 1180, render: renderDetail })
