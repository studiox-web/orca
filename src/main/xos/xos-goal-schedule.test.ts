// XOS fork: replacements are created disabled and never touch the crontab (C1, C2).
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '../../shared/automations-types'
import { replaceCronJob, scheduleGoal } from './xos-goal-schedule'
import { parseCrontabWithPaused } from './xos-crontab'
import { readRunConfig } from './xos-runtime-store'

let base: string
let repo: string
let savedPath: string | undefined
const created: Record<string, unknown>[] = []
const host = {
  createAutomation: vi.fn(async (input: Record<string, unknown>) => {
    created.push(input)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tests read id only.
    return { id: `auto-${created.length}` } as Automation
  })
}

const MARK = '# PAUSED FOR ORCA MIGRATION 2026-11-04: '

function table(): string {
  return [
    `${MARK}CRON_TZ=America/Vancouver`,
    `${MARK}25 10 * * * cd ${repo} && ./automations/bin/run-goal-cron.sh writer codex`,
    `${MARK}15 2 * * * cd ${repo} && bash scripts/backup.sh`,
    ''
  ].join('\n')
}

beforeEach(() => {
  created.length = 0
  base = mkdtempSync(join(tmpdir(), 'xos-schedule-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
  repo = join(base, 'site')
  mkdirSync(join(repo, 'automations', 'goals', 'writer'), { recursive: true })
  writeFileSync(
    join(repo, 'automations', 'goals', 'writer', 'GOAL.md'),
    '---\nagents: [claude]\n---\n# W\n'
  )
  const bin = join(base, 'bin')
  mkdirSync(bin)
  writeFileSync(join(base, 'table'), table())
  // Any write attempt fails the test: the fake only answers `crontab -l`.
  writeFileSync(
    join(bin, 'crontab'),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${join(base, 'table')}"; else touch "${join(base, 'written')}"; fi\n`
  )
  chmodSync(join(bin, 'crontab'), 0o755)
  savedPath = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${savedPath}`
})

afterEach(() => {
  process.env.PATH = savedPath
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('scheduleGoal', () => {
  it('creates the automation disabled and binds it to the goal', async () => {
    const result = await scheduleGoal(host, {
      repoRoot: repo,
      goal: 'writer',
      schedule: '25 10 * * *'
    })
    expect(result).toMatchObject({ ok: true, automationId: 'auto-1' })
    expect(created[0]).toMatchObject({
      enabled: false,
      agentId: 'claude',
      rrule: '25 10 * * *',
      workspaceMode: 'existing',
      workspace: `path:${repo}`
    })
    expect(readRunConfig('auto-1').goal).toEqual({ repoRoot: repo, goal: 'writer' })
  })

  it('refuses a second binding for the same goal', async () => {
    await scheduleGoal(host, { repoRoot: repo, goal: 'writer', schedule: '25 10 * * *' })
    const again = await scheduleGoal(host, {
      repoRoot: repo,
      goal: 'writer',
      schedule: '0 1 * * *'
    })
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining('auto-1') })
  })
})

describe('replaceCronJob', () => {
  const idOf = (needle: string): string =>
    parseCrontabWithPaused(table()).find((line) => line.command.includes(needle))!.id

  it('turns a goal line into a goal binding, keeping its schedule and timezone', async () => {
    const result = await replaceCronJob(host, { jobId: idOf('run-goal-cron') })
    expect(result.ok).toBe(true)
    expect(created[0]).toMatchObject({
      enabled: false,
      rrule: '25 10 * * *',
      timezone: 'America/Vancouver',
      agentId: 'codex'
    })
  })

  it('turns any other line into a script automation that names what it replaces', async () => {
    await replaceCronJob(host, { jobId: idOf('backup.sh') })
    const command = `cd ${repo} && bash scripts/backup.sh`
    expect(readRunConfig('auto-1').script).toEqual({
      command,
      cwd: repo,
      replacesCronCommand: command
    })
    expect(created[0]).toMatchObject({ enabled: false })
  })

  it('never writes the crontab', async () => {
    await replaceCronJob(host, { jobId: idOf('backup.sh') })
    expect(() => readFileSync(join(base, 'written'))).toThrow()
  })

  it('refuses an unknown job and a job already replaced', async () => {
    expect(await replaceCronJob(host, { jobId: 'nope' })).toMatchObject({ ok: false })
    await replaceCronJob(host, { jobId: idOf('backup.sh') })
    expect(await replaceCronJob(host, { jobId: idOf('backup.sh') })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Already replaced')
    })
  })
})
