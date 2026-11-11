// XOS fork: the agent-facing CLI: runs reach the runtime and refuse honestly (H4), and project
// discovery, status and cutover reads work from anywhere (M12, C2, §2.3a).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandHandler, HandlerContext } from '../../cli/dispatch'
import { XOS_GOALS_HANDLERS } from '../../cli/handlers/xos-goals'
import { buildXosGoalBoard } from './xos-goal-board'
import { cliRepoSource } from './xos-goal-cli'
import { applyGoalMutation } from './xos-goal-crud'
import { resolveGoalDir } from './xos-project-home'
import { importProjectGoals } from './xos-project-import'
import { rememberProjects } from './xos-project-registry'
import { readTriggerProjects } from './xos-trigger-projects'
import { writeRunConfig } from './xos-runtime-store'
import { removeTempDir } from './xos-temp-dir.test-fixture'

const runtimeCall = vi.fn()
let base: string
let repo: string
let elsewhere: string
let savedPath: string | undefined

function ctx(cwd: string, flags: Record<string, string | boolean>): HandlerContext {
  return {
    cwd,
    json: true,
    flags: new Map(Object.entries(flags)),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers only use call().
    client: { call: runtimeCall } as unknown as HandlerContext['client']
  }
}

async function run<T>(
  handler: CommandHandler,
  cwd: string,
  flags: Record<string, string | boolean> = {}
): Promise<T> {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
  try {
    await handler(ctx(cwd, flags))
  } finally {
    spy.mockRestore()
  }
  const parsed: T = JSON.parse(logs.at(-1) ?? 'null')
  return parsed
}

function fakeCrontab(table: string): void {
  const bin = join(base, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(base, 'table'), table)
  writeFileSync(join(bin, 'crontab'), `#!/bin/sh\ncat "${join(base, 'table')}"\n`)
  chmodSync(join(bin, 'crontab'), 0o755)
  process.env.PATH = `${bin}${delimiter}${savedPath}`
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-ops-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
  repo = join(base, 'djvibe.com')
  elsewhere = join(base, 'somewhere-else')
  mkdirSync(elsewhere)
  mkdirSync(join(repo, 'automations', 'goals', 'writer', 'inbox'), { recursive: true })
  writeFileSync(
    join(repo, 'automations', 'goals', 'writer', 'GOAL.md'),
    '---\ntitle: Writer\nagents: [claude]\n---\n# Writer\n'
  )
  rememberProjects([{ root: repo, name: 'djvibe.com' }])
  savedPath = process.env.PATH
  fakeCrontab('')
  runtimeCall.mockReset()
})

afterEach(async () => {
  process.env.PATH = savedPath
  delete process.env.ORCA_XOS_HOME
  await removeTempDir(base)
})

describe('run commands (H4)', () => {
  it('fails, without consuming the inbox, when the runtime refuses', async () => {
    const message = join(repo, 'automations', 'goals', 'writer', 'inbox', 'a.md')
    writeFileSync(message, '---\nfrom: operator\nstatus: open\n---\nHello\n')
    runtimeCall.mockResolvedValue({ result: { ok: false, error: 'Lane busy.' } })
    await expect(
      run(XOS_GOALS_HANDLERS['goals reply'], elsewhere, { goal: 'writer', project: 'djvibe.com' })
    ).rejects.toThrow('Lane busy.')
    expect(readFileSync(message, 'utf8')).not.toContain('read_by')
  })

  it('surfaces an unreachable runtime instead of reporting success', async () => {
    runtimeCall.mockRejectedValue(new Error('Orca is not running'))
    await expect(
      run(XOS_GOALS_HANDLERS['goals run'], elsewhere, { goal: 'writer', project: 'djvibe.com' })
    ).rejects.toThrow('Orca is not running')
  })

  it('forwards the parent lane of a nested run (M9)', async () => {
    runtimeCall.mockResolvedValue({ result: { ok: true, message: 'ok' } })
    process.env.CASCADE_ACTIVE_LOCK_LANE = 'content'
    try {
      await run(XOS_GOALS_HANDLERS['goals run'], repo, { goal: 'writer' })
    } finally {
      delete process.env.CASCADE_ACTIVE_LOCK_LANE
    }
    expect(runtimeCall).toHaveBeenCalledWith(
      'xos.goal.run',
      expect.objectContaining({ inheritedLane: 'content' })
    )
  })
})

describe('project discovery (M12)', () => {
  it('lists every known project from any folder, and finds one by name', async () => {
    const all = await run<{ goals: { goal: string }[] }>(
      XOS_GOALS_HANDLERS['goals list'],
      elsewhere
    )
    expect(all.goals.map((goal) => goal.goal)).toEqual(['writer'])
    const named = await run<{ goals: unknown[] }>(XOS_GOALS_HANDLERS['goals list'], elsewhere, {
      project: 'djvibe.com'
    })
    expect(named.goals).toHaveLength(1)
  })

  it('refuses to guess between projects for a write', async () => {
    const other = join(base, 'studiox')
    mkdirSync(join(other, 'automations', 'goals', 'writer'), { recursive: true })
    writeFileSync(join(other, 'automations', 'goals', 'writer', 'GOAL.md'), '---\ntitle: W\n---\n')
    rememberProjects([{ root: other, name: 'studiox' }])
    await expect(
      run(XOS_GOALS_HANDLERS['goals stop'], elsewhere, { goal: 'writer' })
    ).rejects.toThrow(/several projects/)
    await expect(
      run(XOS_GOALS_HANDLERS['goals triggers'], elsewhere, { enable: true })
    ).rejects.toThrow(/--project/)
  })
})

describe('operations (§2.3a)', () => {
  it('reports status and messages, and queues notifications for the bot', async () => {
    writeFileSync(
      join(repo, 'automations', 'goals', 'writer', 'inbox', 'a.md'),
      '---\nfrom: operator\nstatus: open\nsubject: Hi\n---\nHello\n'
    )
    const status = await run<{ projects: { project: string; goals: number }[] }>(
      XOS_GOALS_HANDLERS['goals status'],
      elsewhere
    )
    expect(status.projects[0]).toMatchObject({ project: 'djvibe.com', goals: 1 })
    const messages = await run<{ messages: { subject: string }[] }>(
      XOS_GOALS_HANDLERS['goals messages'],
      elsewhere,
      { goal: 'writer' }
    )
    expect(messages.messages[0].subject).toBe('Hi')

    await run(XOS_GOALS_HANDLERS['goals notify'], elsewhere, {
      goal: 'writer',
      text: 'Draft ready'
    })
    const queue = await run<{ notifications: { text: string }[] }>(
      XOS_GOALS_HANDLERS['goals notifications'],
      elsewhere
    )
    expect(queue.notifications[0].text).toBe('Draft ready')
  })

  it('needs the typed name to authorize, and toggles triggers per project', async () => {
    await expect(
      run(XOS_GOALS_HANDLERS['goals authorize'], elsewhere, { goal: 'writer', confirm: 'nope' })
    ).rejects.toThrow(/Type writer/)
    await run(XOS_GOALS_HANDLERS['goals authorize'], elsewhere, {
      goal: 'writer',
      confirm: 'writer'
    })

    expect(readTriggerProjects()).toEqual([])
    await run(XOS_GOALS_HANDLERS['goals triggers'], elsewhere, {
      project: 'djvibe.com',
      enable: true
    })
    expect(readTriggerProjects()).toEqual([repo])
    await run(XOS_GOALS_HANDLERS['goals triggers'], repo, { disable: true })
    expect(readTriggerProjects()).toEqual([])
  })
})

describe('archive after a partial import (H5)', () => {
  it('restores and deletes a central goal from the home it lives in', async () => {
    const editor = join(repo, 'automations', 'goals', 'editor')
    mkdirSync(editor)
    writeFileSync(join(editor, 'GOAL.md'), '---\ntitle: Editor\n---\n# Editor\n')
    await importProjectGoals(repo, { goals: ['writer'] })
    const central = resolveGoalDir(repo, 'writer')
    const board = () => buildXosGoalBoard(cliRepoSource(repo))
    const key = (await board()).projects[0].key
    const crontabHash = (await board()).crontabHash

    const archived = await applyGoalMutation(await board(), {
      kind: 'archive',
      projectKey: key,
      goal: 'writer',
      crontabHash
    })
    expect(archived.ok).toBe(true)
    expect((await board()).projects[0].archived.map((entry) => entry.goal)).toEqual(['writer'])

    const restored = await applyGoalMutation(await board(), {
      kind: 'restore',
      projectKey: key,
      archived: 'writer'
    })
    expect(restored.ok).toBe(true)
    expect(existsSync(join(central, 'GOAL.md'))).toBe(true)
    expect(resolveGoalDir(repo, 'writer')).toBe(central)

    await applyGoalMutation(await board(), {
      kind: 'archive',
      projectKey: key,
      goal: 'writer',
      crontabHash
    })
    const deleted = await applyGoalMutation(await board(), {
      kind: 'delete',
      projectKey: key,
      archived: 'writer',
      confirm: 'writer',
      crontabHash
    })
    expect(deleted.ok).toBe(true)
    expect((await board()).projects[0].archived).toEqual([])
  })
})

describe('the migration plan (C2)', () => {
  const MARK = '# PAUSED FOR ORCA MIGRATION 2026-11-04: '

  it('maps every job, and says which are running nowhere', async () => {
    fakeCrontab(
      [
        `${MARK}CRON_TZ=America/Vancouver`,
        `${MARK}25 10 * * * cd ${repo} && ./automations/bin/run-goal-cron.sh writer codex`,
        `${MARK}15 2 * * * cd ${repo} && bash scripts/backup.sh`,
        `0 1 * * * cd ${repo} && ./still-running.sh`,
        ''
      ].join('\n')
    )
    writeRunConfig('auto-1', {
      script: {
        command: `cd ${repo} && bash scripts/backup.sh`,
        cwd: repo,
        replacesCronCommand: `cd ${repo} && bash scripts/backup.sh`
      }
    })
    const plan = await run<{
      entries: {
        kind: string
        goal: string | null
        state: string
        replacementAutomationId: string | null
      }[]
      timezone: string
      pausedDirectives: string[]
    }>(XOS_GOALS_HANDLERS['goals migrate plan'], elsewhere)
    expect(plan.timezone).toBe('America/Vancouver')
    expect(plan.pausedDirectives).toEqual(['CRON_TZ=America/Vancouver'])
    expect(plan.entries.map((entry) => [entry.kind, entry.state])).toEqual([
      ['goal', 'not-running'],
      ['script', 'replacement-ready'],
      ['script', 'legacy-active']
    ])
    expect(plan.entries[0].goal).toBe('writer')
    expect(plan.entries[1].replacementAutomationId).toBe('auto-1')

    const briefing = await run<{ lines: string[] }>(XOS_GOALS_HANDLERS['goals briefing'], elsewhere)
    expect(briefing.lines[0]).toContain('1 paused crontab job(s) have no replacement')
  })
})
