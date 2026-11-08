import { describe, expect, it } from 'vitest'
import type { Automation, AutomationRun } from './automations-types'
import { toRuntimeExecutionHostId } from './execution-host'
import type { XosAutomationRunConfig } from './xos-runtime-types'
import type { XosCronJob, XosGoal, XosGoalBoard, XosProject } from './xos-goals-types'
import {
  decodeUnifiedAutomationKey,
  encodeUnifiedAutomationKey,
  isUnifiedSourceRef
} from './unified-automation-identity'
import { buildUnifiedAutomationSnapshot } from './unified-automation-read-model'

const local = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}

function cron(overrides: Partial<XosCronJob> = {}): XosCronJob {
  return {
    id: 'cron-1',
    schedule: '0 9 * * *',
    command: './run-goal writer',
    name: 'Writer schedule',
    workdir: '/repo',
    logPath: null,
    goal: 'writer',
    runner: 'codex',
    paused: false,
    nextRunAt: '2026-11-05T17:00:00.000Z',
    ...overrides
  }
}

function goal(overrides: Partial<XosGoal> = {}): XosGoal {
  const job = cron()
  return {
    goal: 'writer',
    title: 'Writer',
    area: { id: 'editorial', title: 'Editorial', description: '', manager: 'writer' },
    status: { status: 'active' },
    lastRun: null,
    nextRun: job.nextRunAt,
    result: 'success',
    detail: '',
    adminSummary: null,
    paused: false,
    running: null,
    viewer: {
      slug: 'writer',
      goalPath: '/repo/goals/writer/GOAL.md',
      statusPath: '/repo/goals/writer/STATUS.md',
      logDirectory: '/repo/goals/writer/log',
      configuredModel: null,
      configuredReasoning: null,
      agents: ['codex'],
      lockLane: null,
      estimatedRuntime: null,
      contractStatus: 'active',
      statusUpdatedAt: '2026-11-04T10:00:00.000Z',
      latestRun: {
        run_id: 'goal-run-1',
        goal: 'writer',
        runner: 'codex',
        status: 'success',
        started_at: '2026-11-04T09:00:00.000Z',
        finished_at: '2026-11-04T09:10:00.000Z',
        duration_seconds: 600,
        log_path: '/repo/run.log'
      },
      recentRuns: [],
      latestUsage: null,
      usage7d: { runs: 0, tokens: 0, maxRunTokens: 0, maxRunCost: 0, maxRunModel: null },
      usage30d: { runs: 0, tokens: 0, cost: 0, models: [] },
      subagents: {
        configured: false,
        heavy: false,
        mode: null,
        names: [],
        expectedCount: 0,
        tokens7d: 0,
        maxRunTokens7d: 0
      },
      cron: { configured: true, schedules: [job.schedule], jobs: [job] },
      statusFields: [{ key: 'status', label: 'Status', value: 'active' }]
    },
    logs: [],
    messages: { inboxOpen: 0 },
    queues: { in: [], out: [] },
    ...overrides
  }
}

function project(overrides: Partial<XosProject> = {}): XosProject {
  return {
    key: '/repo',
    name: 'Repo',
    root: '/repo',
    goalsDir: '/repo/goals',
    worktreeSelector: 'path:/repo',
    orgSource: 'default',
    areas: [],
    goals: [goal()],
    archived: [],
    scripts: [],
    ...overrides
  }
}

function board(overrides: Partial<XosGoalBoard> = {}): XosGoalBoard {
  return {
    generatedAt: '2026-11-04T12:00:00.000Z',
    crontabHash: 'cron-revision-1',
    projects: [project()],
    otherJobs: [],
    warnings: [],
    ...overrides
  }
}

function automation(id: string, overrides: Partial<Automation> = {}): Automation {
  return {
    id,
    name: `Automation ${id}`,
    prompt: 'do work',
    precheck: null,
    agentId: 'codex',
    projectId: 'repo-id',
    runContext: {
      kind: 'workspace-run',
      projectId: 'repo-id',
      projectHostSetupId: 'repo-id',
      repoId: 'repo-id',
      path: '/repo',
      hostId: 'local'
    },
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: null,
    baseBranch: null,
    reuseSession: false,
    timezone: 'America/Vancouver',
    rrule: 'FREQ=DAILY;BYHOUR=9',
    dtstart: Date.parse('2026-11-01T16:00:00.000Z'),
    enabled: true,
    nextRunAt: Date.parse('2026-11-05T17:00:00.000Z'),
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 60,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

const emptyConfig = (): XosAutomationRunConfig => ({
  fallbacks: [],
  fallbackOnManualRuns: false,
  lockLane: null,
  lockWaitMinutes: 0,
  timeoutMinutes: null,
  autoCommit: null,
  auto: null,
  goal: null,
  script: null
})

function snapshot(
  args: {
    board?: XosGoalBoard
    automations?: Automation[]
    runs?: AutomationRun[]
    runConfigs?: Record<string, XosAutomationRunConfig>
  } = {}
) {
  return buildUnifiedAutomationSnapshot({
    board: args.board ?? board(),
    automations: args.automations ?? [],
    runs: args.runs ?? [],
    runConfigs: args.runConfigs ?? {},
    generatedAt: '2026-11-04T12:00:00.000Z'
  })
}

describe('unified automation identity', () => {
  it('round-trips escaped authority-qualified identities and rejects aliases', () => {
    const identities = [
      { kind: 'goal' as const, authority: local, projectKey: '/repo:a|b', goal: 'write|docs' },
      {
        kind: 'automation' as const,
        authority: {
          authority: { kind: 'runtime' as const, environmentId: 'server:1' },
          selector: { kind: 'ssh' as const, targetId: 'prod|west' }
        },
        automationId: 'same:id'
      },
      { kind: 'script' as const, authority: local, sourceId: 'cron:rev:0' },
      { kind: 'external' as const, authority: local, managerId: 'cron', jobId: 'job:1' }
    ]
    for (const identity of identities) {
      const key = encodeUnifiedAutomationKey(identity)
      expect(decodeUnifiedAutomationKey(key)).toEqual(identity)
      expect(decodeUnifiedAutomationKey(`${key}|extra`)).toBeNull()
    }
  })

  it('validates authority-qualified source references without accepting partial identities', () => {
    expect(
      isUnifiedSourceRef({
        kind: 'native-automation',
        authority: local,
        sourceId: 'automation-1',
        revision: '4',
        ownerKey: null,
        label: 'Orca'
      })
    ).toBe(true)
    expect(
      isUnifiedSourceRef({
        kind: 'native-automation',
        authority: { authority: { kind: 'runtime' }, selector: { kind: 'ssh' } },
        sourceId: 'automation-1',
        revision: null,
        ownerKey: null,
        label: 'Orca'
      })
    ).toBe(false)
  })
})

describe('unified automation read model', () => {
  it('folds only an exact Goal binding and stays deterministic after source reordering', () => {
    const bound = automation('bound', { name: 'Writer native' })
    const sameName = automation('same-name', { name: 'Writer' })
    const config = { ...emptyConfig(), goal: { repoRoot: '/repo', goal: 'writer' } }
    const first = snapshot({ automations: [bound, sameName], runConfigs: { bound: config } })
    const reordered = snapshot({ automations: [sameName, bound], runConfigs: { bound: config } })

    expect(reordered).toEqual(first)
    expect(first.rows.filter((row) => row.kind === 'goal')).toHaveLength(1)
    expect(first.rows.filter((row) => row.kind === 'automation')).toHaveLength(1)
    const folded = first.rows.find((row) => row.kind === 'goal')!
    expect(folded.scheduleChildren.map((child) => child.owner)).toEqual(['legacy-cron', 'orca'])
    expect(folded.migrationState).toBe('paired')
    expect(folded.sourceRefs.map((ref) => ref.sourceId)).toContain('bound')
  })

  it('canonicalizes equivalent project roots without fuzzy Goal matching', () => {
    const config = (repoRoot: string) => ({
      ...emptyConfig(),
      goal: { repoRoot, goal: 'writer' }
    })
    const posix = snapshot({
      board: board({ projects: [project({ key: '/repo/', root: '/repo/' })] }),
      automations: [automation('posix-root')],
      runConfigs: { 'posix-root': config('/repo') }
    })
    const posixTrailing = snapshot({
      board: board({ projects: [project({ key: '/repo/', root: '/repo/' })] }),
      automations: [automation('posix-root')],
      runConfigs: { 'posix-root': config('/repo/') }
    })
    const windows = snapshot({
      board: board({ projects: [project({ key: 'C:\\Repo\\', root: 'C:\\Repo\\' })] }),
      automations: [automation('windows-root')],
      runConfigs: { 'windows-root': config('c:/repo') }
    })
    const caseMismatch = snapshot({
      board: board({ projects: [project({ key: '/repo/', root: '/repo/' })] }),
      automations: [automation('case-mismatch')],
      runConfigs: { 'case-mismatch': config('/Repo') }
    })

    expect(posix.rows.filter((row) => row.kind === 'automation')).toHaveLength(0)
    expect(posixTrailing).toEqual(posix)
    expect(windows.rows.filter((row) => row.kind === 'automation')).toHaveLength(0)
    expect(caseMismatch.rows.filter((row) => row.kind === 'automation')).toHaveLength(1)
    expect(caseMismatch.warnings.map((warning) => warning.code)).toContain('binding-target-missing')
  })

  it('keeps multiple schedules and lifecycle, schedule state, and run outcome separate', () => {
    const active = goal({
      status: { status: 'completed' },
      viewer: {
        ...goal().viewer,
        latestRun: { ...goal().viewer.latestRun!, status: 'failed' },
        cron: {
          configured: true,
          schedules: ['0 9 * * *', '0 17 * * *'],
          jobs: [cron(), cron({ id: 'cron-2', schedule: '0 17 * * *', paused: true })]
        }
      }
    })
    const row = snapshot({ board: board({ projects: [project({ goals: [active] })] }) }).rows[0]

    expect(row.scheduleChildren).toHaveLength(2)
    expect(row.lifecycle).toEqual({ state: 'active', stage: 'completed' })
    expect(row.scheduleState).toBe('mixed')
    expect(row.runSummary?.outcome).toBe('failed')
  })

  it('leaves Goal stage unknown when only result and latest-run outcome exist', () => {
    const current = goal({
      status: { result: 'failed' },
      result: 'failed',
      viewer: {
        ...goal().viewer,
        contractStatus: 'failed',
        latestRun: { ...goal().viewer.latestRun!, status: 'failed' }
      }
    })
    const row = snapshot({ board: board({ projects: [project({ goals: [current] })] }) }).rows[0]

    expect(row.lifecycle).toEqual({ state: 'active', stage: null })
    expect(row.runSummary?.outcome).toBe('failed')
  })

  it('shows unscheduled and archived Goals without inventing schedule or run state', () => {
    const unscheduled = goal({
      status: {},
      result: 'failed',
      viewer: {
        ...goal().viewer,
        contractStatus: 'failed',
        latestRun: null,
        cron: {
          configured: false,
          schedules: [],
          jobs: []
        }
      }
    })
    const rows = snapshot({
      board: board({
        projects: [
          project({
            goals: [unscheduled],
            archived: [
              {
                goal: 'old-goal',
                title: 'Old Goal',
                path: '/repo/goals/_archive/old-goal',
                archivedAt: '2026-10-01T00:00:00.000Z'
              }
            ]
          })
        ]
      })
    }).rows

    const active = rows.find(
      (row) => row.identity.kind === 'goal' && row.identity.goal === 'writer'
    )!
    const archived = rows.find(
      (row) => row.identity.kind === 'goal' && row.identity.goal === 'old-goal'
    )!
    expect(active.lifecycle.stage).toBeNull()
    expect(active.scheduleState).toBe('unscheduled')
    expect(active.runSummary).toBeNull()
    expect(archived.lifecycle.state).toBe('archived')
    expect(archived.scheduleChildren).toEqual([])
    expect(archived.runSummary).toBeNull()
  })

  it('preserves missing, stale, conflicting, and duplicate native source evidence', () => {
    const missingTarget = automation('missing-target')
    const conflicted = automation('conflicted')
    const duplicateA = automation('duplicate', { name: 'A', updatedAt: 1 })
    const duplicateB = automation('duplicate', { name: 'B', updatedAt: 2 })
    const result = snapshot({
      automations: [missingTarget, conflicted, duplicateB, duplicateA],
      runConfigs: {
        'missing-target': { ...emptyConfig(), goal: { repoRoot: '/missing', goal: 'writer' } },
        conflicted: {
          ...emptyConfig(),
          goal: { repoRoot: '/repo', goal: 'writer' },
          script: { command: 'echo hi', cwd: '/repo', replacesCronCommand: null }
        },
        stale: { ...emptyConfig(), goal: { repoRoot: '/repo', goal: 'writer' } }
      }
    })

    expect(
      result.rows
        .find(
          (row) =>
            row.identity.kind === 'automation' && row.identity.automationId === 'missing-target'
        )
        ?.warnings.map((warning) => warning.code)
    ).toContain('binding-target-missing')
    expect(
      result.rows
        .find(
          (row) => row.identity.kind === 'automation' && row.identity.automationId === 'conflicted'
        )
        ?.warnings.map((warning) => warning.code)
    ).toContain('binding-conflict')
    expect(
      result.rows
        .find(
          (row) => row.identity.kind === 'automation' && row.identity.automationId === 'duplicate'
        )
        ?.warnings.map((warning) => warning.code)
    ).toContain('duplicate-native-identity')
    expect(
      result.rows.find((row) => row.kind === 'goal')?.warnings.map((warning) => warning.code)
    ).toContain('stale-source')
  })

  it('refuses to fold an ID-only binding that collides across authorities', () => {
    const result = snapshot({
      automations: [
        automation('authority-collision'),
        automation('authority-collision', {
          executionTargetType: 'ssh',
          executionTargetId: 'build-host',
          executionTargetGeneration: 2
        })
      ],
      runConfigs: {
        'authority-collision': {
          ...emptyConfig(),
          goal: { repoRoot: '/repo', goal: 'writer' }
        }
      }
    })

    const goalRow = result.rows.find((row) => row.kind === 'goal')!
    const nativeRows = result.rows.filter((row) => row.kind === 'automation')
    expect(goalRow.scheduleChildren.map((child) => child.owner)).toEqual(['legacy-cron'])
    expect(nativeRows).toHaveLength(2)
    expect(nativeRows.every((row) => row.warnings[0]?.code === 'binding-conflict')).toBe(true)
    expect(new Set(nativeRows.map((row) => row.key)).size).toBe(2)
  })

  it.each([
    [
      'SSH',
      {
        executionTargetType: 'ssh' as const,
        executionTargetId: 'build-host',
        executionTargetGeneration: 2
      }
    ],
    [
      'runtime',
      {
        schedulerOwner: 'remote_host_service' as const,
        runContext: {
          ...automation('runtime').runContext!,
          hostId: toRuntimeExecutionHostId('server-1')
        }
      }
    ]
  ])('keeps a %s-targeted Goal binding separate from the local Goal', (_, overrides) => {
    const remote = automation('remote-bound', overrides)
    const result = snapshot({
      automations: [remote],
      runConfigs: {
        'remote-bound': {
          ...emptyConfig(),
          goal: { repoRoot: '/repo/', goal: 'writer' }
        }
      }
    })

    const goalRow = result.rows.find((row) => row.kind === 'goal')!
    const nativeRow = result.rows.find((row) => row.kind === 'automation')!
    expect(goalRow.scheduleChildren.map((child) => child.owner)).toEqual(['legacy-cron'])
    expect(goalRow.warnings.map((warning) => warning.code)).toContain('binding-conflict')
    expect(nativeRow.warnings.map((warning) => warning.code)).toContain('binding-conflict')
    expect(nativeRow.migrationState).toBe('conflict')
    expect(result.warnings.map((warning) => warning.code)).toContain('binding-conflict')
  })

  it('marks legacy Goal receipts without IDs and never collides duplicate cron lines', () => {
    const legacyRun = { ...goal().viewer.latestRun! }
    delete legacyRun.run_id
    const duplicate = cron()
    const currentGoal = goal({
      viewer: {
        ...goal().viewer,
        latestRun: legacyRun,
        cron: {
          configured: true,
          schedules: [duplicate.schedule, duplicate.schedule],
          jobs: [duplicate, duplicate]
        }
      }
    })
    const result = snapshot({ board: board({ projects: [project({ goals: [currentGoal] })] }) })
    const row = result.rows[0]

    expect(row.runSummary).toMatchObject({ sourceId: null, identity: 'legacy-without-run-id' })
    expect(new Set(row.scheduleChildren.map((child) => child.key)).size).toBe(2)
    expect(row.warnings.map((warning) => warning.code)).toContain('legacy-run-without-id')
  })

  it('folds bound Scripts without matching their command or cwd to cron records', () => {
    const native = automation('script-bound', { name: 'Backup' })
    const scriptCron = cron({
      id: 'cron-script',
      goal: null,
      name: 'Backup',
      command: 'backup --all'
    })
    const result = snapshot({
      board: board({ projects: [project({ scripts: [scriptCron] })] }),
      automations: [native],
      runConfigs: {
        'script-bound': {
          ...emptyConfig(),
          script: { command: 'backup --all', cwd: '/repo', replacesCronCommand: 'backup --all' }
        }
      }
    })

    const scripts = result.rows.filter((row) => row.kind === 'script')
    expect(scripts).toHaveLength(2)
    expect(scripts.map((row) => row.scheduleChildren[0].owner).sort()).toEqual([
      'legacy-cron',
      'orca'
    ])
  })
})
