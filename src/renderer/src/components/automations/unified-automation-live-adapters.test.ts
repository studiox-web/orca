import { describe, expect, it } from 'vitest'
import type { AutomationListRow } from './automation-list-row-identity'
import {
  adaptLiveAutomationRow,
  withUnifiedAutomationHostWarnings
} from './unified-automation-live-adapters'

function remoteRow(): AutomationListRow {
  return {
    key: 'remote-row',
    catalogRef: {
      authority: { kind: 'runtime', environmentId: 'server-1' },
      selector: { kind: 'ssh', targetId: 'build-1' }
    },
    hostLabel: 'build-1',
    usageSummary: {
      knownRuns: 1,
      unavailableRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      lastRunAt: 20,
      lastRunStatus: 'dispatching'
    },
    automation: {
      id: 'same-id',
      name: 'Remote nightly',
      prompt: 'run nightly work',
      precheck: null,
      agentId: 'codex',
      projectId: 'project-1',
      executionTargetType: 'ssh',
      executionTargetId: 'build-1',
      schedulerOwner: 'remote_host_service',
      workspaceMode: 'existing',
      workspaceId: null,
      baseBranch: null,
      reuseSession: false,
      timezone: 'America/Vancouver',
      rrule: 'FREQ=DAILY',
      dtstart: 1,
      enabled: false,
      nextRunAt: 10,
      missedRunPolicy: 'run_once_within_grace',
      missedRunGraceMinutes: 60,
      createdAt: 1,
      updatedAt: 4
    }
  }
}

describe('unified live automation adapters', () => {
  it('keeps remote authority, captured owner, paused state, and running outcome separate', () => {
    const row = adaptLiveAutomationRow(
      remoteRow(),
      'Project',
      'owner:runtime:server-1:4:ssh:build-1:2'
    )

    expect(row.identity).toMatchObject({
      kind: 'automation',
      authority: {
        authority: { kind: 'runtime', environmentId: 'server-1' },
        selector: { kind: 'ssh', targetId: 'build-1' }
      },
      automationId: 'same-id'
    })
    expect(row.sourceRefs[0].ownerKey).toBe('owner:runtime:server-1:4:ssh:build-1:2')
    expect(row.scheduleState).toBe('paused')
    expect(row.runSummary?.outcome).toBe('running')
  })

  it('labels stale storage and disconnected execution independently without changing state', () => {
    const base = adaptLiveAutomationRow(remoteRow(), 'Project')
    const row = withUnifiedAutomationHostWarnings(base, {
      catalogState: 'authoritative',
      authorityHealth: 'stale-error',
      executionHealth: 'disconnected'
    })

    expect(row.warnings.map((warning) => warning.code)).toEqual([
      'stale-source',
      'source-unavailable'
    ])
    expect(row.scheduleState).toBe('paused')
    expect(row.warnings[1].message).toContain('does not reconnect')
  })
})
