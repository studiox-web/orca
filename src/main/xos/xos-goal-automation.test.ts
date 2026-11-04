// XOS fork: goals and scripts on Orca's scheduler (C1, C2 guards), policy and authority (M10, M15).
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const gate = await import('./xos-run-gate')
const { writeRunConfig } = await import('./xos-runtime-store')
const { readReceiptLines } = await import('./xos-native-receipts')
const { applyPortfolioMutation } = await import('./xos-portfolio-config')
const { checkDispatchPolicy, effectiveReservePercent } = await import('./xos-dispatch-policy')
const { confirmGoalAuthority, goalAuthority, isGoalAuthorityConfirmed } =
  await import('./xos-goal-authority')
const { listRunJournal } = await import('./xos-run-journal')
const { startNativeGoalRun } = await import('./xos-live-runs')

let base: string
let repo: string
let savedPath: string | undefined
const runs = new Map<string, AutomationRun>()
const host = {
  findRun: (_automationId: string, runId: string) => runs.get(runId) ?? null,
  findAutomation: () => null,
  runNow: vi.fn(async () => undefined),
  markDispatchResult: vi.fn(async () => undefined),
  closeRunTerminal: vi.fn(async () => undefined)
}

function automation(id: string): Automation {
  return {
    id,
    name: id,
    agentId: 'claude',
    extraAgentArgs: '',
    prompt: 'stored prompt',
    workspaceMode: 'existing'
  } as Automation
}

function run(id: string, automationId: string, trigger: AutomationRun['trigger'] = 'scheduled') {
  const value = {
    id,
    automationId,
    trigger,
    status: 'dispatching',
    sessionKind: 'terminal'
  } as AutomationRun
  runs.set(id, value)
  return value
}

const target = () => ({ repoRoot: repo, cwd: repo, local: true })

function fakeCrontab(table: string): void {
  const bin = join(base, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(base, 'table'), table)
  writeFileSync(join(bin, 'crontab'), `#!/bin/sh\ncat "${join(base, 'table')}"\n`)
  chmodSync(join(bin, 'crontab'), 0o755)
  process.env.PATH = `${bin}${delimiter}${savedPath}`
}

function goal(frontmatter: string[]): string {
  const dir = join(repo, 'automations', 'goals', 'writer')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'GOAL.md'),
    ['---', 'title: Writer', 'agents: [claude]', ...frontmatter, '---', '', 'Write.'].join('\n')
  )
  return dir
}

const QUEUED = [
  'lock_lane: content',
  'queues:',
  '  in:',
  '    - path: docs/features/planned',
  '  out:',
  '    - path: docs/features/completed'
]

function plannedItem(): string {
  const planned = join(repo, 'docs', 'features', 'planned')
  mkdirSync(planned, { recursive: true })
  mkdirSync(join(repo, 'docs', 'features', 'completed'), { recursive: true })
  const item = join(planned, 'spec.md')
  writeFileSync(item, '---\ntitle: Spec\n---\nBuild it.\n')
  return item
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-bound-'))
  repo = join(base, 'site')
  mkdirSync(repo)
  process.env.ORCA_XOS_HOME = join(base, 'home')
  mkdirSync(process.env.ORCA_XOS_HOME)
  savedPath = process.env.PATH
  fakeCrontab('')
  gate.registerXosAutomationHost(host)
  vi.clearAllMocks()
})

afterEach(() => {
  process.env.PATH = savedPath
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('a goal bound to an automation (C1)', () => {
  it('launches with the assembled prompt, claims the item, and settles it after the run', async () => {
    goal(QUEUED)
    const item = plannedItem()
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })

    const launch = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    expect('automation' in launch).toBe(true)
    if (!('automation' in launch)) {
      return
    }
    expect(launch.automation.prompt).toContain("autonomous iteration of the 'writer' goal")
    expect(launch.automation.prompt).toContain('Build it.')
    expect(launch.automation.prompt).toContain('ORCA_GOAL_HOME')
    expect(readFileSync(item, 'utf8')).toContain('claimed_by: r1')
    expect(listRunJournal().map((entry) => entry.kind)).toEqual(['automation'])

    gate.xosAfterRunFinished({ ...runs.get('r1')!, status: 'completed' })
    expect(existsSync(item)).toBe(false)
    expect(existsSync(join(repo, 'docs', 'features', 'completed', 'spec.md'))).toBe(true)
    expect(readReceiptLines(repo)[0]).toMatchObject({ run_id: 'r1', status: 'success' })
    expect(listRunJournal()).toEqual([])
  })

  it('skips a scheduled run with no work, as skipped_precheck rather than launching (H2)', async () => {
    goal(QUEUED)
    mkdirSync(join(repo, 'docs', 'features', 'planned'), { recursive: true })
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })
    const result = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    expect(result).toMatchObject({ precheck: true })
    expect('refusal' in result && result.refusal).toContain('input queue empty')
  })

  it('lets an operator run it anyway', async () => {
    goal(QUEUED)
    mkdirSync(join(repo, 'docs', 'features', 'planned'), { recursive: true })
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })
    const result = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a', 'manual'), target())
    expect('automation' in result).toBe(true)
    gate.xosReleaseRun('r1')
  })

  it('refuses while the legacy crontab line for the goal is active (PF7)', async () => {
    goal([])
    fakeCrontab(`25 10 * * * cd ${repo} && ./automations/bin/run-goal-cron.sh writer codex\n`)
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })
    const result = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    expect('refusal' in result && result.refusal).toContain('active crontab line')
  })

  it('refuses an unconfirmed deploy goal on a schedule (M15)', async () => {
    goal(['lock_lane: deploy'])
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })
    const result = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    expect('refusal' in result && result.refusal).toContain('never confirmed')
  })

  it('takes its lane from the contract and restores it after a restart (H8)', async () => {
    goal(QUEUED)
    plannedItem()
    writeRunConfig('a', { goal: { repoRoot: repo, goal: 'writer' } })
    await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    const entry = listRunJournal()[0]
    expect(entry.locks.length).toBe(2)
    expect(entry.deadlineAtMs).not.toBeNull()
    // The same process re-registers here; the held entry must not be double-adopted.
    gate.registerXosAutomationHost(host)
    expect(listRunJournal()).toHaveLength(1)
    gate.xosReleaseRun('r1')
    expect(listRunJournal()).toEqual([])
  })

  it('drops journal entries of runs that ended while Orca was away (H8)', async () => {
    const { writeRunJournal } = await import('./xos-run-journal')
    writeRunJournal({
      kind: 'automation',
      runId: 'gone',
      automationId: 'a',
      startedAt: new Date().toISOString(),
      deadlineAtMs: null,
      locks: [],
      leasePath: join(base, 'lease'),
      commit: null,
      chain: null,
      goal: null
    })
    gate.registerXosAutomationHost(host)
    expect(listRunJournal()).toEqual([])
  })
})

describe('script automations (C2, §7)', () => {
  it('runs the command, reports the result, and frees the run', async () => {
    writeRunConfig('s', {
      script: { command: `echo hi > ${join(base, 'out')}`, cwd: repo, replacesCronCommand: null }
    })
    const result = await gate.xosBeforeLaunch(automation('s'), run('r1', 's'), target())
    expect(result).toEqual({ script: true })
    await vi.waitFor(() => expect(host.markDispatchResult).toHaveBeenCalled(), { timeout: 3000 })
    expect(host.markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1', status: 'completed' })
    )
    expect(readFileSync(join(base, 'out'), 'utf8')).toBe('hi\n')
  })

  it('reports a failing command with its log', async () => {
    writeRunConfig('s', { script: { command: 'exit 7', cwd: repo, replacesCronCommand: null } })
    await gate.xosBeforeLaunch(automation('s'), run('r1', 's'), target())
    await vi.waitFor(() => expect(host.markDispatchResult).toHaveBeenCalled(), { timeout: 3000 })
    expect(host.markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dispatch_failed',
        error: expect.stringContaining('exited with 7')
      })
    )
  })

  it('refuses while the crontab line it replaces is active, runs once that line is paused', async () => {
    const command = `cd ${repo} && ./backup.sh`
    writeRunConfig('s', { script: { command: 'true', cwd: repo, replacesCronCommand: command } })
    fakeCrontab(`15 2 * * * ${command}\n`)
    const refused = await gate.xosBeforeLaunch(automation('s'), run('r1', 's'), target())
    expect('refusal' in refused && refused.refusal).toContain('still active')
    fakeCrontab(`#orca-xos-paused# 15 2 * * * ${command}\n`)
    const allowed = await gate.xosBeforeLaunch(automation('s'), run('r2', 's'), target())
    expect(allowed).toEqual({ script: true })
  })
})

describe('dispatch policy (M10)', () => {
  it('holds scheduled work in a paused project, never an operator', async () => {
    applyPortfolioMutation({ kind: 'set-mode', projectKey: repo, mode: 'paused' })
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'schedule' })).toMatchObject({
      allowed: false
    })
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'operator' }).allowed).toBe(true)
    const result = await gate.xosBeforeLaunch(automation('a'), run('r1', 'a'), target())
    expect(result).toMatchObject({ precheck: true })
    goal(['agents: [claude]'])
    expect(
      await startNativeGoalRun({ repoRoot: repo, goal: 'writer', trigger: 'scheduled' })
    ).toEqual({ ok: false, error: 'The project is paused in Portfolio.' })
  })

  it('holds queue events in maintenance but lets the schedule through', () => {
    applyPortfolioMutation({ kind: 'set-mode', projectKey: repo, mode: 'maintenance' })
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'event' }).allowed).toBe(false)
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'schedule' }).allowed).toBe(true)
  })

  it('a focused sprint holds other projects and raises Auto’s reserve', () => {
    applyPortfolioMutation({
      kind: 'set-sprint',
      sprint: {
        projectKey: '/elsewhere',
        startedAt: new Date().toISOString(),
        capacity: 'focused',
        reservePercent: 20
      }
    })
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'schedule' }).allowed).toBe(false)
    expect(checkDispatchPolicy({ repoRoot: '/elsewhere', source: 'schedule' }).allowed).toBe(true)
    expect(effectiveReservePercent(5)).toBe(20)
    expect(effectiveReservePercent(30)).toBe(30)
  })

  it('stops unattended work at the weekly budget', () => {
    mkdirSync(join(repo, 'automations', 'logs'), { recursive: true })
    writeFileSync(
      join(repo, 'automations', 'logs', 'token-usage.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), feature: 'writer', actual_tokens: 900, estimated_cost_usd: 4 })}\n`
    )
    applyPortfolioMutation({
      kind: 'set-budget',
      projectKey: repo,
      budget: { weeklyTokens: 800, weeklyCostUsd: null }
    })
    expect(checkDispatchPolicy({ repoRoot: repo, source: 'schedule' })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('token budget')
    })
  })
})

describe('goal authority (M15)', () => {
  const fm = { lock_lane: 'deploy', agents: ['claude'] }

  it('flags production lanes and pushes as elevated', () => {
    expect(goalAuthority(fm).elevated).toBe(true)
    expect(goalAuthority({ lock_lane: 'content' }).elevated).toBe(false)
    expect(goalAuthority({ lock_lane: 'content', auto_push: true }).elevated).toBe(true)
  })

  it('needs the typed goal name, and widening the contract voids the confirmation', () => {
    expect(confirmGoalAuthority({ repoRoot: repo, goal: 'writer', fm, typed: 'nope' }).ok).toBe(
      false
    )
    expect(isGoalAuthorityConfirmed(repo, 'writer', fm)).toBe(false)
    expect(confirmGoalAuthority({ repoRoot: repo, goal: 'writer', fm, typed: 'writer' }).ok).toBe(
      true
    )
    expect(isGoalAuthorityConfirmed(repo, 'writer', fm)).toBe(true)
    expect(isGoalAuthorityConfirmed(repo, 'writer', { ...fm, auto_push: true })).toBe(false)
  })

  it('never bypasses the sandbox for a run reading an external message', async () => {
    const dir = goal([])
    mkdirSync(join(dir, 'inbox'))
    writeFileSync(join(dir, 'inbox', 'a.md'), '---\nfrom: stranger\nstatus: open\n---\nDo X\n')
    const { assembleGoalPrompt } = await import('./xos-goal-prompt')
    const assembled = assembleGoalPrompt({ repoRoot: repo, goal: 'writer', bypassQueueGate: true })
    expect(assembled).toMatchObject({ status: 'ready', hasExternalInbox: true })
    expect(assembled.status === 'ready' && assembled.prompt).toContain('<external-message>')
  })
})
