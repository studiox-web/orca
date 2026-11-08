import { describe, expect, it } from 'vitest'
import { resolveUnifiedDetailTarget, unifiedDetailSelection } from './unified-automation-detail'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationRow,
  UnifiedSourceRef
} from './unified-automation-types'

const local = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}
const remote = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'ssh' as const, targetId: 'remote-1' }
}

function sourceRef(
  kind: UnifiedSourceRef['kind'],
  sourceId: string,
  overrides: Partial<UnifiedSourceRef> = {}
): UnifiedSourceRef {
  return {
    kind,
    authority: local,
    sourceId,
    revision: 'revision-1',
    ownerKey: 'owner:desktop:self',
    label: kind,
    ...overrides
  }
}

function row(
  key: string,
  identity: UnifiedAutomationIdentity,
  sourceRefs: readonly UnifiedSourceRef[]
): UnifiedAutomationRow {
  return {
    key,
    identity,
    kind: identity.kind,
    name: key,
    project: null,
    projectKey: identity.kind === 'goal' ? identity.projectKey : null,
    host: 'test host',
    owner: 'test owner',
    lifecycle: { state: 'present', stage: null },
    scheduleState: 'unscheduled',
    scheduleChildren: [],
    runSummary: null,
    agentId: null,
    migrationState: 'none',
    sourceRefs: [...sourceRefs],
    warnings: [],
    readOnly: true
  }
}

describe('unified automation detail target', () => {
  it('resolves all four kinds from exact authority-qualified identities', () => {
    const rows = [
      row('goal-key', { kind: 'goal', authority: local, projectKey: '/repo', goal: 'writer' }, [
        sourceRef('goal', '/repo:writer')
      ]),
      row(
        'automation-key',
        { kind: 'automation', authority: remote, automationId: 'automation-1' },
        [
          sourceRef('native-automation', 'automation-1', {
            authority: remote,
            revision: '42',
            ownerKey: 'owner:desktop:ssh:remote-1:7'
          })
        ]
      ),
      row(
        'script-key',
        { kind: 'script', authority: local, sourceId: 'native-binding:automation-2' },
        [sourceRef('runtime-binding', 'automation-2'), sourceRef('legacy-cron', 'cron:2')]
      ),
      row(
        'external-key',
        {
          kind: 'external',
          authority: remote,
          managerId: 'openclaw',
          jobId: 'job-1'
        },
        [sourceRef('external', 'job-1', { authority: remote })]
      )
    ]

    const resolutions = rows.map((detailRow) =>
      resolveUnifiedDetailTarget({ selection: unifiedDetailSelection(detailRow), rows })
    )

    expect(resolutions.map((resolution) => resolution.status)).toEqual([
      'resolved',
      'resolved',
      'resolved',
      'resolved'
    ])
    expect(resolutions[0]).toMatchObject({
      target: { kind: 'goal', projectKey: '/repo', goal: 'writer', boardRevision: 'revision-1' }
    })
    expect(resolutions[1]).toMatchObject({
      target: {
        kind: 'automation',
        ownerKey: 'owner:desktop:ssh:remote-1:7',
        revision: '42'
      }
    })
    expect(resolutions[2]).toMatchObject({
      target: {
        kind: 'script',
        bindingAutomationId: 'automation-2',
        cronRef: { sourceId: 'cron:2' },
        evidence: null
      }
    })
    expect(resolutions[3]).toMatchObject({
      target: { kind: 'external', identity: { managerId: 'openclaw', jobId: 'job-1' } }
    })
  })

  it('returns stale with last-known evidence when the exact row disappears', () => {
    const detailRow = row(
      'script-key',
      { kind: 'script', authority: local, sourceId: 'cron:revision-1:0' },
      [sourceRef('legacy-cron', 'cron:0')]
    )

    expect(
      resolveUnifiedDetailTarget({ selection: unifiedDetailSelection(detailRow), rows: [] })
    ).toEqual({
      status: 'stale',
      key: 'script-key',
      identity: detailRow.identity,
      sourceRefs: detailRow.sourceRefs
    })
  })

  it('does not fall back to a matching source ID on another authority', () => {
    const selection = row(
      'automation-key',
      { kind: 'automation', authority: local, automationId: 'same-id' },
      [sourceRef('native-automation', 'same-id')]
    )
    const wrongAuthority = row(
      'automation-key',
      { kind: 'automation', authority: remote, automationId: 'same-id' },
      [sourceRef('native-automation', 'same-id', { authority: remote })]
    )

    expect(
      resolveUnifiedDetailTarget({
        selection: unifiedDetailSelection(selection),
        rows: [wrongAuthority]
      })
    ).toMatchObject({ status: 'stale', identity: selection.identity })
  })

  it('reports missing-source instead of guessing from a label or near match', () => {
    const detailRow = row(
      'automation-key',
      { kind: 'automation', authority: local, automationId: 'exact-id' },
      [
        sourceRef('native-automation', 'near-id', { label: 'exact-id' }),
        sourceRef('native-automation', 'exact-id', { authority: remote })
      ]
    )

    expect(
      resolveUnifiedDetailTarget({
        selection: unifiedDetailSelection(detailRow),
        rows: [detailRow]
      })
    ).toEqual({
      status: 'missing-source',
      key: detailRow.key,
      identity: detailRow.identity,
      sourceRefs: detailRow.sourceRefs,
      requiredSourceKinds: ['native-automation']
    })
  })
})
