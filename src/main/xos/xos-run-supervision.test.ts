// XOS fork: native runs as durable, supervised processes (H8, H9, H10, M1, M2, M7, M8). A fake agent
// on PATH (via BASH_ENV, which `bash -lc` sources) plays claude and codex.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XosNativeJournalEntry } from './xos-run-journal'
import { removeTempDir } from './xos-temp-dir.test-fixture'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const { adoptNativeRuns, liveRunRegistry, startNativeGoalRun, stopNativeGoalRun } =
  await import('./xos-live-runs')
const { readLiveTail } = await import('./xos-live-tail')
const { goalRunsToday, localDay, readReceiptLines } = await import('./xos-native-receipts')
const { listRunJournal, writeRunJournal } = await import('./xos-run-journal')
const { readTransitionEvents } = await import('./xos-item-claims')
const { goalLockFile, isLockFree, laneLockFile, tryLock } = await import('./xos-lane-lock')

const dirs: string[] = []
let savedBashEnv: string | undefined

function makeRepo(frontmatter: string[] = []): { repo: string; goalDir: string } {
  const base = mkdtempSync(join(tmpdir(), 'xos-sup-'))
  dirs.push(base)
  const repo = join(base, 'demo')
  const goalDir = join(repo, 'automations', 'goals', 'writer')
  mkdirSync(join(goalDir, 'inbox'), { recursive: true })
  writeFileSync(
    join(goalDir, 'GOAL.md'),
    ['---', 'title: Writer', 'lock_lane: content', ...frontmatter, '---', '', '# Writer'].join('\n')
  )
  return { repo, goalDir }
}

/** `claude` and `codex` both run `script`; $0 tells them apart. */
function fakeAgents(repo: string, script: string): void {
  const bin = join(repo, '.bin')
  mkdirSync(bin, { recursive: true })
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${script}`)
    chmodSync(join(bin, name), 0o755)
  }
  const env = join(repo, '.bash-env')
  writeFileSync(env, `export PATH="${bin}:$PATH"`)
  process.env.BASH_ENV = env
}

const settled = async (repo: string, count = 1): Promise<void> => {
  await vi.waitFor(
    () => {
      const running = [...liveRunRegistry().values()].some(
        (run) => run.repoRoot === repo && run.finishedAt === null
      )
      if (running || readReceiptLines(repo).length < count) {
        throw new Error('still running')
      }
    },
    { timeout: 10_000, interval: 25 }
  )
}

beforeEach(() => {
  savedBashEnv = process.env.BASH_ENV
  process.env.ORCA_XOS_HOME = mkdtempSync(join(tmpdir(), 'xos-sup-home-'))
  dirs.push(process.env.ORCA_XOS_HOME)
})

afterEach(async () => {
  delete process.env.ORCA_XOS_HOME
  if (savedBashEnv === undefined) {
    delete process.env.BASH_ENV
  } else {
    process.env.BASH_ENV = savedBashEnv
  }
  while (dirs.length > 0) {
    await removeTempDir(dirs.pop()!)
  }
})

describe('launch', () => {
  it('delivers a prompt larger than one argv string over stdin (M2)', async () => {
    const { repo } = makeRepo(['agents: [claude]'])
    fakeAgents(repo, `cat > "${repo}/stdin.txt"\nexit 0`)
    const started = await startNativeGoalRun({
      repoRoot: repo,
      goal: 'writer',
      message: 'x'.repeat(200 * 1024),
      force: true
    })
    expect(started.ok).toBe(true)
    await settled(repo)
    expect(readReceiptLines(repo)[0].status).toBe('success')
    expect(readFileSync(join(repo, 'stdin.txt'), 'utf8').length).toBeGreaterThan(200 * 1024)
  })

  it('records a queue-gate skip instead of running (H2)', async () => {
    const { repo } = makeRepo([
      'agents: [claude]',
      'queues:',
      '  in:',
      '    - path: docs/features/planned'
    ])
    mkdirSync(join(repo, 'docs', 'features', 'planned'), { recursive: true })
    fakeAgents(repo, `touch "${repo}/ran"`)
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'writer' })
    expect(started).toMatchObject({
      ok: false,
      error: expect.stringContaining('input queue empty')
    })
    expect(existsSync(join(repo, 'ran'))).toBe(false)
    expect(readReceiptLines(repo)[0].status).toBe('skipped_precheck')
    expect(goalRunsToday(repo, 'writer', Date.parse(readReceiptLines(repo)[0].started_at!))).toBe(0)
  })

  it('leaves nothing behind when the agent cannot start (M3, M8)', async () => {
    const { repo } = makeRepo([
      'agents: [gemini]',
      'queues:',
      '  in:',
      '    - path: docs/features/planned'
    ])
    const planned = join(repo, 'docs', 'features', 'planned')
    mkdirSync(planned, { recursive: true })
    writeFileSync(join(planned, 'item.md'), '---\ntitle: Item\n---\nBody\n')
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'writer' })
    expect(started).toMatchObject({ ok: false, error: expect.stringContaining('gemini') })
    expect(readFileSync(join(planned, 'item.md'), 'utf8')).not.toContain('claimed_by')
    await vi.waitFor(
      async () => {
        expect(await isLockFree(goalLockFile(repo, 'writer'))).toBe(true)
        expect(await isLockFree(laneLockFile(repo, 'content'))).toBe(true)
      },
      { timeout: 3000, interval: 50 }
    )
    expect(listRunJournal()).toEqual([])
  })

  it('marks an inbox message read only once the run launched (H4)', async () => {
    const { repo, goalDir } = makeRepo(['agents: [claude]'])
    fakeAgents(repo, 'cat > /dev/null')
    const message = join(goalDir, 'inbox', 'one.md')
    writeFileSync(message, '---\nfrom: operator\nstatus: open\n---\nHello\n')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', mode: 'normal', force: true })
    await settled(repo)
    expect(readFileSync(message, 'utf8')).toContain('read_by: writer')
  })
})

describe('work items (H10)', () => {
  function withItem(frontmatter: string[]): { repo: string; item: string; done: string } {
    const { repo } = makeRepo([
      'agents: [claude]',
      'queues:',
      '  in:',
      '    - path: docs/features/planned',
      '  out:',
      '    - path: docs/features/completed',
      ...frontmatter
    ])
    const planned = join(repo, 'docs', 'features', 'planned')
    const done = join(repo, 'docs', 'features', 'completed')
    mkdirSync(planned, { recursive: true })
    mkdirSync(done, { recursive: true })
    const item = join(planned, 'share-buttons.md')
    writeFileSync(item, '---\ntitle: Share buttons\n---\nSpec\n')
    return { repo, item, done }
  }

  it('moves the item on success and records the run on it', async () => {
    const { repo, item, done } = withItem([])
    fakeAgents(repo, 'cat > /dev/null\nexit 0')
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'writer' })
    expect(started.ok).toBe(true)
    await settled(repo)
    expect(existsSync(item)).toBe(false)
    const moved = readFileSync(join(done, 'share-buttons.md'), 'utf8')
    expect(moved).not.toContain('claimed_by')
    expect(moved).toContain(`last_run_id: ${started.ok ? started.runId : ''}`)
    expect(readTransitionEvents(repo)[0]).toMatchObject({
      toStage: 'completed',
      outcome: 'success'
    })
  })

  it('tells the agent not to move the file', async () => {
    const { repo } = withItem([])
    fakeAgents(repo, `cat > "${repo}/stdin.txt"`)
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer' })
    await settled(repo)
    expect(readFileSync(join(repo, 'stdin.txt'), 'utf8')).toContain('do not move it')
  })

  it('puts a failed item back, unclaimed, with the error attached', async () => {
    const { repo, item } = withItem([])
    fakeAgents(repo, 'cat > /dev/null\necho boom\nexit 2')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer' })
    await settled(repo)
    const text = readFileSync(item, 'utf8')
    expect(text).not.toContain('claimed_by')
    expect(text).toContain('last_error: "run_failed"')
  })
})

describe('timeout, stop and fallback (H9)', () => {
  it('stops a run past its timeout and frees the lane', async () => {
    const { repo } = makeRepo(['agents: [claude]', 'timeout_minutes: 0.002'])
    fakeAgents(repo, 'sleep 30')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    await settled(repo)
    expect(readReceiptLines(repo)[0]).toMatchObject({ status: 'failed', failure_reason: 'timeout' })
    await vi.waitFor(async () => expect(await isLockFree(laneLockFile(repo, 'content'))).toBe(true))
  })

  it('stops a run on request', async () => {
    const { repo } = makeRepo(['agents: [claude]'])
    fakeAgents(repo, 'sleep 30')
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    expect(started.ok && stopNativeGoalRun(started.runId).ok).toBe(true)
    await settled(repo)
    expect(readReceiptLines(repo)[0].failure_reason).toBe('stopped')
    expect(stopNativeGoalRun('nope').ok).toBe(false)
  })

  it('retries a limited scheduled run on the next agent, linked to its parent', async () => {
    const { repo } = makeRepo(['agents: [claude, codex]', 'model: opus'])
    fakeAgents(
      repo,
      `cat > /dev/null\nif [ "$(basename "$0")" = claude ]; then echo "You've hit your limit"; exit 1; fi\necho "$@" > "${repo}/codex-args"\nexit 0`
    )
    const first = await startNativeGoalRun({
      repoRoot: repo,
      goal: 'writer',
      trigger: 'scheduled',
      force: true
    })
    await settled(repo, 2)
    const [limited, retried] = readReceiptLines(repo)
    expect(limited).toMatchObject({ runner: 'claude', failure_reason: 'usage_limit' })
    expect(retried).toMatchObject({ runner: 'codex', status: 'success' })
    expect(first.ok && retried.parent_run_id).toBe(first.ok ? first.runId : '')
    expect(readFileSync(join(repo, 'codex-args'), 'utf8')).toContain('gpt-5.5')
  })

  it('does not fall back from a manual run unless the contract opts in', async () => {
    const { repo } = makeRepo(['agents: [claude, codex]'])
    fakeAgents(repo, `cat > /dev/null\necho "You've hit your limit"\nexit 1`)
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    await settled(repo)
    expect(readReceiptLines(repo)).toHaveLength(1)
  })
})

describe('restart (H8)', () => {
  function journalEntry(
    repo: string,
    pid: number | null,
    exit: string | null
  ): XosNativeJournalEntry {
    const logPath = join(repo, 'adopted.log')
    const exitPath = join(repo, 'adopted.exit')
    writeFileSync(logPath, 'finished the post\n')
    if (exit !== null) {
      writeFileSync(exitPath, exit)
    }
    return {
      kind: 'native',
      runId: `writer-adopted-${pid}`,
      repoRoot: repo,
      goal: 'writer',
      agent: 'claude',
      mode: 'normal',
      trigger: 'scheduled',
      parentRunId: null,
      pid,
      startedAt: '2026-11-04T12:00:00.000Z',
      deadlineAtMs: null,
      locks: [],
      leasePath: join(repo, 'lease'),
      logPath,
      exitPath,
      itemPath: null,
      itemTitle: null,
      itemStage: null,
      worktreePath: null,
      branch: null,
      command: '',
      model: null,
      effort: null,
      disableAutoCommit: true,
      disableFallback: true,
      attempt: 0,
      fallbackChain: []
    }
  }

  it('settles a run that finished while Orca was away, from its exit file', async () => {
    const { repo } = makeRepo()
    writeRunJournal(journalEntry(repo, 2 ** 22 + 1, '0'))
    expect(adoptNativeRuns()).toBe(1)
    await settled(repo)
    expect(readReceiptLines(repo)[0]).toMatchObject({ status: 'success', exit_code: 0 })
    expect(listRunJournal()).toEqual([])
  })

  // A real process, stopped through the adoption poll.
  it('keeps a live run in the registry so it can be stopped after a restart', async () => {
    const { repo } = makeRepo()
    const orphan = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    orphan.unref()
    const entry = journalEntry(repo, orphan.pid ?? null, null)
    writeRunJournal(entry)
    adoptNativeRuns()
    expect(liveRunRegistry().get(entry.runId)?.finishedAt).toBeNull()
    expect(stopNativeGoalRun(entry.runId).ok).toBe(true)
    await vi.waitFor(() => expect(liveRunRegistry().get(entry.runId)?.finishedAt).not.toBeNull(), {
      timeout: 12_000,
      interval: 100
    })
    expect(readReceiptLines(repo)[0].failure_reason).toBe('stopped')
  }, 15_000)

  // The lock helper polls its lease every five seconds.
  it('holds a leased lock after the owner is gone, until the agent exits', async () => {
    const { repo } = makeRepo()
    const file = laneLockFile(repo, 'content')
    const lease = join(repo, 'lease')
    const agent = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    agent.unref()
    writeFileSync(lease, String(agent.pid))
    const held = await tryLock(
      file,
      0,
      { path: lease, expiresAtMs: Date.parse('2099-01-01T00:00:00Z') },
      2 ** 22 + 1
    )
    expect(held).not.toBeNull()
    expect(await isLockFree(file)).toBe(false)
    agent.kill('SIGKILL')
    await vi.waitFor(async () => expect(await isLockFree(file)).toBe(true), {
      timeout: 8000,
      interval: 200
    })
  }, 12_000)
})

describe('readLiveTail (M7)', () => {
  it('shows the newest run and the end of a long log', async () => {
    const { repo } = makeRepo(['agents: [claude]'])
    fakeAgents(repo, 'for i in $(seq 1 6000); do echo "line $i"; done\necho FINAL-FAILURE\nexit 1')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    await settled(repo)
    fakeAgents(repo, 'echo second-run\nexit 0')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    await settled(repo, 2)
    expect(readLiveTail(liveRunRegistry(), repo, 'writer')?.lines.join('\n')).toContain(
      'second-run'
    )
  })

  it('reads the end of a finished log from its receipt', async () => {
    const { repo } = makeRepo(['agents: [claude]'])
    fakeAgents(repo, 'for i in $(seq 1 6000); do echo "line $i"; done\necho FINAL-FAILURE\nexit 1')
    await startNativeGoalRun({ repoRoot: repo, goal: 'writer', force: true })
    await settled(repo)
    expect(readLiveTail(new Map(), repo, 'writer')?.lines.join('\n')).toContain('FINAL-FAILURE')
  })
})

describe('daily counts (L5, L9)', () => {
  it('uses the local calendar day', () => {
    const lateEvening = new Date(2026, 3, 15, 23, 30).getTime()
    expect(localDay(lateEvening)).toBe('2026-04-15')
  })
})
