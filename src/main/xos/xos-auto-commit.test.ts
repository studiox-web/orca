import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const gate = await import('./xos-run-gate')
const { readRunAttempts, writeRunConfig } = await import('./xos-runtime-store')
const { readLegacyCommitPolicies, xosAutoCommit } = await import('./xos-auto-commit')

let home: string
let repo: string

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

function write(path: string, text: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xos-commit-home-'))
  repo = mkdtempSync(join(tmpdir(), 'xos-commit-repo-'))
  process.env.ORCA_XOS_HOME = home
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('automations/goals/writer/STATUS.md', 'old\n')
  write('app/Http/Thing.php', 'old\n')
  write('.gitignore', 'secret.log\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

describe('auto-commit', () => {
  it('commits only the owned paths and leaves other changes and staged work alone', async () => {
    write('automations/goals/writer/STATUS.md', 'new\n')
    write('automations/goals/writer/log/run.md', 'added\n')
    write('automations/goals/writer/secret.log', 'ignored\n')
    write('app/Http/Thing.php', 'outside\n')
    write('notes.md', 'staged by the person\n')
    git('add', 'notes.md')

    const result = await xosAutoCommit({
      cwd: repo,
      repoRoot: repo,
      automationName: 'Writer',
      config: { paths: ['automations/goals/writer', 'docs/missing'], message: null, push: true }
    })

    expect(result).toMatchObject({ status: 'committed', files: 2, pushed: null })
    expect(git('log', '-1', '--format=%s')).toBe('chore(automation): Writer')
    expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').toSorted()).toEqual([
      'automations/goals/writer/STATUS.md',
      'automations/goals/writer/log/run.md'
    ])
    expect(git('diff', '--cached', '--name-only')).toBe('notes.md')
    expect(git('diff', '--name-only')).toBe('app/Http/Thing.php')
  })

  it('records nothing to commit, and skips a detached HEAD', async () => {
    const config = { paths: ['automations'], message: 'chore: x', push: false }
    expect(
      await xosAutoCommit({ cwd: repo, repoRoot: repo, automationName: 'W', config })
    ).toMatchObject({ status: 'nothing' })
    git('checkout', '-q', '--detach')
    write('automations/goals/writer/STATUS.md', 'new\n')
    expect(
      await xosAutoCommit({ cwd: repo, repoRoot: repo, automationName: 'W', config })
    ).toMatchObject({ status: 'skipped' })
  })

  it('commits after a finished run through the gate and records it on the run', async () => {
    writeRunConfig('w', { autoCommit: { paths: ['automations'], message: null, push: false } })
    const runs = new Map<string, AutomationRun>()
    gate.registerXosAutomationHost({
      findRun: (_a, id) => runs.get(id) ?? null,
      findAutomation: () => ({ id: 'w', name: 'Writer' }) as Automation,
      runNow: vi.fn(async () => undefined),
      markDispatchResult: vi.fn(async () => undefined),
      closeRunTerminal: vi.fn(async () => undefined)
    })
    const automation = {
      id: 'w',
      name: 'Writer',
      agentId: 'claude',
      workspaceMode: 'existing'
    } as Automation
    const run = { id: 'w1', automationId: 'w', trigger: 'scheduled', status: 'dispatching' }
    runs.set('w1', run as AutomationRun)
    await gate.xosBeforeLaunch(automation, run as AutomationRun, {
      repoRoot: repo,
      cwd: repo,
      local: true
    })
    write('automations/goals/writer/STATUS.md', 'done\n')
    const finished = { ...run, status: 'completed', sessionKind: 'terminal' } as AutomationRun
    runs.set('w1', finished)
    gate.xosAfterRunFinished(finished)
    gate.xosAfterRunFinished(finished)
    await vi.waitFor(() => expect(gate.xosPendingCommits()).toBe(0), { timeout: 10_000 })

    expect(git('log', '--format=%s')).toBe('chore(automation): Writer\ninit')
    expect(readRunAttempts('w', 5)[0].commit).toMatchObject({ status: 'committed', files: 1 })
  })
})

describe('legacy commit policies', () => {
  it('reads the stage_if_exists lists per goal', () => {
    write(
      'automations/bin/commit-automation-changes.sh',
      [
        'case "$GOAL_NAME" in',
        '  feature-dreamer)',
        '    stage_if_exists automations/goals/feature-dreamer',
        '    stage_if_exists docs/bugs/incoming',
        '    ;;',
        '  special-projects-manager)',
        '    stage_goal_inboxes',
        '    ;;',
        '  *)',
        '    exit 0',
        '    ;;',
        'esac',
        'case "$GOAL_NAME" in',
        '  feature-dreamer)',
        '    COMMIT_MESSAGE="chore: x"',
        '    ;;',
        'esac'
      ].join('\n')
    )
    expect(readLegacyCommitPolicies(repo)).toEqual([
      {
        goal: 'feature-dreamer',
        paths: ['automations/goals/feature-dreamer', 'docs/bugs/incoming']
      },
      { goal: 'special-projects-manager', paths: ['automations/goals/*/inbox'] }
    ])
  })
})
