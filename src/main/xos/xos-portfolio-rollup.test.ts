import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as crontabModule from './xos-crontab'
import type * as goalProcessesModule from './xos-goal-processes'
import { buildPortfolioRollup, DECK_PACKS } from './xos-portfolio-rollup'
import { applyPortfolioMutation, readPortfolioConfig } from './xos-portfolio-config'
import { importProjectGoals } from './xos-project-import'

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

function makeTempRepo(name = 'cascade-roll'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-roll-'))
  tempDirs.push(base)
  const repo = join(base, name)
  mkdirSync(repo, { recursive: true })
  return repo
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const dayAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

function makeGoal(repo: string, goal: string, status = 'pass'): void {
  write(
    join(repo, 'automations', 'goals', goal, 'GOAL.md'),
    `---\nid: ${goal}\n---\n# Goal: ${goal}\n`
  )
  write(join(repo, 'automations', 'goals', goal, 'STATUS.md'), `# Status\n\n- result: ${status}\n`)
}

function makeRollupRepo(): string {
  const repo = makeTempRepo()
  makeGoal(repo, 'content-writer')
  makeGoal(repo, 'feature-dreamer', 'blocked')
  write(
    join(repo, 'automations', 'logs', 'automation-runs.jsonl'),
    `${[
      JSON.stringify({
        goal: 'content-writer',
        status: 'failed',
        started_at: dayAgo(1),
        runner: 'claude'
      }),
      JSON.stringify({
        goal: 'content-writer',
        status: 'success',
        started_at: dayAgo(2),
        runner: 'claude'
      }),
      JSON.stringify({
        goal: 'feature-dreamer',
        status: 'success',
        started_at: dayAgo(3),
        runner: 'codex'
      }),
      JSON.stringify({
        goal: 'content-writer',
        status: 'success',
        started_at: dayAgo(40),
        runner: 'claude'
      })
    ].join('\n')}\n`
  )
  write(
    join(repo, 'automations', 'logs', 'token-usage.jsonl'),
    `${[
      JSON.stringify({
        feature: 'content-writer',
        ts: dayAgo(1),
        actual_tokens: 1000,
        estimated_cost_usd: 0.05,
        model: 'opus'
      }),
      JSON.stringify({
        feature: 'feature-dreamer',
        ts: dayAgo(3),
        actual_tokens: 2000,
        estimated_cost_usd: 0.1,
        model: 'gpt-5.5'
      }),
      JSON.stringify({
        feature: 'content-writer',
        ts: dayAgo(40),
        actual_tokens: 9000,
        estimated_cost_usd: 0.9,
        model: 'opus'
      })
    ].join('\n')}\n`
  )
  return repo
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-04-15T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
  rmSync(join(xosHome(), 'projects'), { recursive: true, force: true })
  rmSync(join(xosHome(), 'portfolio.json'), { force: true })
})

describe('xos-portfolio-rollup', () => {
  it('aggregates goals, run success rates, tokens and pack readiness per project', async () => {
    const repo = makeRollupRepo()
    const crontab = `*/10 * * * * cd ${repo} && ./automations/bin/run-goal-cron.sh content-writer claude\n0 * * * * cd ${repo} && ./automations/bin/run-goal-cron.sh feature-dreamer codex\n`
    const mocked = vi.mocked(crontabModule.readCrontabText)
    mocked.mockResolvedValue(crontab)
    await importProjectGoals(repo)

    const rollup = await buildPortfolioRollup({
      getRepos: () => [{ id: '1', path: repo, displayName: 'Cascade Roll' }]
    })

    expect(rollup.projects).toHaveLength(1)
    const project = rollup.projects[0]
    expect(project.name).toBe('Cascade Roll')
    expect(project.goals.total).toBe(2)
    expect(project.goals.active).toBe(2)
    expect(project.goals.queued).toBe(2)
    expect(project.goals.attention).toBe(1)
    expect(project.runs.runs7d).toBe(3)
    expect(project.runs.succeeded7d).toBe(2)
    expect(project.runs.successRate7d).toBeCloseTo(66.7, 1)
    expect(project.runs.runs30d).toBe(3)
    expect(project.runs.succeeded30d).toBe(2)
    expect(project.tokens.tokens7d).toBe(3000)
    expect(project.tokens.cost7d).toBe(0.15)
    expect(project.tokens.tokens30d).toBe(3000)
    expect(project.tokens.cost30d).toBe(0.15)

    expect(project.versioning.imported).toBe(true)
    expect(project.versioning.versionedGoals).toBe(2)
    expect(project.cutover.legacyGoalLines).toBe(2)
    expect(project.cutover.legacyActiveLines).toBe(2)
    expect(project.cutover.state).toBe('pending')
    expect(project.cutover.fingerprint).toMatch(/^[0-9a-f]{64}$/)

    const contentStudio = project.packs.find((pack) => pack.packId === 'content-studio')
    expect(contentStudio?.installed).toBe(1)
    expect(contentStudio?.ready).toBe(false)
    const devShop = project.packs.find((pack) => pack.packId === 'dev-shop')
    expect(devShop?.installed).toBe(1)
    expect(devShop?.missing).not.toContain('feature-dreamer')

    expect(rollup.overall.goals.total).toBe(2)
    expect(rollup.overall.tokens.tokens7d).toBe(3000)
    expect(rollup.packs).toHaveLength(DECK_PACKS.length)
  })

  it('flags a complete cutover when every legacy cron line is paused', async () => {
    const repo = makeRollupRepo()
    const paused = `#orca-xos-paused# */10 * * * * cd ${repo} && ./automations/bin/run-goal-cron.sh content-writer claude\n`
    vi.mocked(crontabModule.readCrontabText).mockResolvedValue(paused)
    await importProjectGoals(repo)

    const rollup = await buildPortfolioRollup({
      getRepos: () => [{ id: '1', path: repo }]
    })
    const project = rollup.projects[0]
    expect(project.cutover.legacyGoalLines).toBe(1)
    expect(project.cutover.legacyActiveLines).toBe(0)
    expect(project.cutover.state).toBe('complete')
    expect(project.goals.active).toBe(1)
    expect(project.goals.paused).toBe(1)
  })

  it('persists modes, sprints and budgets with validation (PF2/PF3/PF4)', () => {
    expect(readPortfolioConfig()).toEqual({ modes: {}, sprint: null, budgets: {} })

    expect(applyPortfolioMutation({ kind: 'set-mode', projectKey: 'k1', mode: 'focus' }).ok).toBe(
      true
    )
    expect(readPortfolioConfig().modes.k1).toBe('focus')
    expect(applyPortfolioMutation({ kind: 'set-mode', projectKey: 'k1', mode: 'active' }).ok).toBe(
      true
    )
    expect(readPortfolioConfig().modes.k1).toBeUndefined()

    const sprint = {
      projectKey: 'k1',
      startedAt: new Date().toISOString(),
      capacity: 'focused' as const,
      reservePercent: 15
    }
    expect(applyPortfolioMutation({ kind: 'set-sprint', sprint }).ok).toBe(true)
    expect(readPortfolioConfig().sprint?.capacity).toBe('focused')

    const badBudget = applyPortfolioMutation({
      kind: 'set-budget',
      projectKey: 'k1',
      budget: { weeklyTokens: null, weeklyCostUsd: null }
    })
    expect(badBudget.ok).toBe(false)
    expect(
      applyPortfolioMutation({
        kind: 'set-budget',
        projectKey: 'k1',
        budget: { weeklyTokens: null, weeklyCostUsd: 25 }
      }).ok
    ).toBe(true)
    expect(readPortfolioConfig().budgets.k1.weeklyCostUsd).toBe(25)
  })

  it('computes budget utilization when a weekly cost budget is set', async () => {
    const repo = makeRollupRepo()
    vi.mocked(crontabModule.readCrontabText).mockResolvedValue('')
    await importProjectGoals(repo)
    applyPortfolioMutation({
      kind: 'set-budget',
      projectKey: repo,
      budget: { weeklyTokens: null, weeklyCostUsd: 0.3 }
    })

    const rollup = await buildPortfolioRollup({
      getRepos: () => [{ id: '1', path: repo }]
    })
    expect(rollup.projects[0].budget.utilization7d).toBeCloseTo(50, 1)
  })
})
