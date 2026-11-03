import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../cli/index'
import * as crontabModule from './xos-crontab'
import { buildXosGoalBoard } from './xos-goal-board'
import type * as goalProcessesModule from './xos-goal-processes'
import {
  hasImportedGoals,
  hasProjectGoals,
  importProjectGoals,
  projectHomeDir,
  readProjectMeta,
  resolveAgentsMdPath,
  resolveProjectGoalsDir,
  resolveSharedDirs
} from './xos-project-home'
import { scanProjectQueues } from './xos-work-items'

vi.mock('./xos-crontab', async (importOriginal) => {
  const actual = await importOriginal<typeof crontabModule>()
  return {
    ...actual,
    readCrontabText: vi.fn(async () => '')
  }
})

vi.mock('./xos-goal-processes', async (importOriginal) => {
  const actual = await importOriginal<typeof goalProcessesModule>()
  return {
    ...actual,
    runningGoalJobs: vi.fn(async () => [])
  }
})

const { xosHome } = crontabModule

const tempDirs: string[] = []

function makeTempRepo(name = 'sample-app'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-import-'))
  tempDirs.push(base)
  const repo = join(base, name)
  mkdirSync(repo, { recursive: true })
  return repo
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
  rmSync(join(xosHome(), 'projects'), { recursive: true, force: true })
})

describe('xos-project-home & orca goals import', () => {
  it('falls back to legacy in-repo paths before import and switches to ~/.orca-xos/projects/<slug> after import', async () => {
    const repo = makeTempRepo('cascade-demo')
    const goalDir = join(repo, 'automations', 'goals', 'fix-qa-bugs')
    mkdirSync(join(goalDir, 'log'), { recursive: true })
    mkdirSync(join(goalDir, 'sidecars'), { recursive: true })
    writeFileSync(
      join(goalDir, 'GOAL.md'),
      [
        '---',
        'id: fix-qa-bugs',
        'agents: [codex, claude]',
        'lock_lane: repo-mutating',
        '---',
        '# Goal: Fix QA Bugs',
        '@shared/safety.md'
      ].join('\n')
    )
    writeFileSync(join(goalDir, 'STATUS.md'), '# Status\n\n- result: pass\n')
    writeFileSync(join(goalDir, 'MEMORY.md'), '# Memory\n')
    writeFileSync(join(goalDir, 'SOUL.md'), '# Soul\n')
    writeFileSync(join(goalDir, 'sidecars', 'triage.md'), '# Sidecar triage\n')

    mkdirSync(join(repo, 'automations', 'shared'), { recursive: true })
    writeFileSync(join(repo, 'automations', 'shared', 'safety.md'), 'Shared safety rules.\n')
    writeFileSync(join(repo, 'automations', 'AGENTS.md'), '# Automation Agents\n')

    mkdirSync(join(repo, 'docs', 'features', 'planned'), { recursive: true })
    writeFileSync(
      join(repo, 'docs', 'features', 'planned', '2026-04-01-fast-search.md'),
      '---\ntitle: Fast Search\nbuilder:\n  ready: true\n---\n# Fast Search\n'
    )
    mkdirSync(join(repo, 'docs', 'bugs', 'incoming'), { recursive: true })
    writeFileSync(
      join(repo, 'docs', 'bugs', 'incoming', '2026-04-02-login-glitch.md'),
      '---\ntitle: Login Glitch\nseverity: high\n---\n# Login Glitch\n'
    )

    expect(hasImportedGoals(repo)).toBe(false)
    expect(hasProjectGoals(repo)).toBe(true)
    expect(resolveProjectGoalsDir(repo)).toBe(join(repo, 'automations', 'goals'))

    const imported = await importProjectGoals(repo)
    expect(imported.ok).toBe(true)
    expect(imported.meta.slug).toBe('cascade-demo')
    expect(imported.meta.goalsImported).toBe(1)
    expect(imported.meta.itemsImported).toBe(2)
    expect(imported.meta.sharedFilesImported).toBe(1)
    expect(imported.meta.commitSha).toMatch(/^[0-9a-f]{7,}$/)
    expect(existsSync(join(imported.homeDir, '.git'))).toBe(true)
    expect(readProjectMeta(repo)?.goalsImported).toBe(1)

    // Remove the legacy repo folders to prove board & queues read from centralized project home.
    rmSync(join(repo, 'automations'), { recursive: true, force: true })
    rmSync(join(repo, 'docs'), { recursive: true, force: true })

    expect(hasImportedGoals(repo)).toBe(true)
    expect(resolveProjectGoalsDir(repo)).toBe(join(projectHomeDir(repo), 'goals'))
    expect(resolveAgentsMdPath(repo)).toBe(join(projectHomeDir(repo), 'AGENTS.md'))
    expect(resolveSharedDirs(repo)).toEqual([join(projectHomeDir(repo), 'shared')])

    const queues = scanProjectQueues(repo, { activeOnly: true })
    const featurePlanned = queues
      .find((q) => q.type.id === 'feature')
      ?.stages.find((s) => s.stage.id === 'planned')
    expect(featurePlanned?.files).toHaveLength(1)
    expect(featurePlanned?.readyCount).toBe(1)

    const board = await buildXosGoalBoard({
      getRepos: () => [{ id: '1', path: repo, displayName: 'Cascade Demo' }]
    })
    expect(board.projects).toHaveLength(1)
    const goal = board.projects[0].goals[0]
    expect(goal.goal).toBe('fix-qa-bugs')
    expect(goal.viewer.goalPath).toBe(join(projectHomeDir(repo), 'goals', 'fix-qa-bugs', 'GOAL.md'))
    expect(goal.viewer.memoryPath).toBe(
      join(projectHomeDir(repo), 'goals', 'fix-qa-bugs', 'MEMORY.md')
    )
    expect(goal.viewer.soulPath).toBe(join(projectHomeDir(repo), 'goals', 'fix-qa-bugs', 'SOUL.md'))
    expect(goal.viewer.sidecars).toEqual(['triage'])
  })

  it('runs `orca goals import <repo> --json` from the CLI', async () => {
    const repo = makeTempRepo('cli-import-repo')
    const goalDir = join(repo, 'automations', 'goals', 'daily-digest')
    mkdirSync(goalDir, { recursive: true })
    writeFileSync(join(goalDir, 'GOAL.md'), '---\nid: daily-digest\n---\n# Goal: Daily Digest\n')

    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(String(msg))
    })
    try {
      await main(['goals', 'import', repo, '--json'])
    } finally {
      spy.mockRestore()
    }

    expect(logs).toHaveLength(1)
    const parsed: { ok: boolean; meta: { goalsImported: number } } = JSON.parse(logs[0])
    expect(parsed.ok).toBe(true)
    expect(parsed.meta.goalsImported).toBe(1)
  })
})
