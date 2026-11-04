// XOS fork: Stage D native goal runs (plan §4 row D): prompt assembly + item claim + lane locks +
// streaming child + receipt + live tail, and the takeover/next-item helpers (§3e, §3h.2). A fake
// `claude`/`codex` on PATH (via BASH_ENV, which `bash -lc` sources) plays the agent.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const { startNativeGoalRun, liveRunRegistry } = await import('./xos-live-runs')
const { readLiveTail, nativeRunningFor } = await import('./xos-live-tail')
const { readNativeReceipts, readReceiptLines, runsTodayCount } =
  await import('./xos-native-receipts')
const { buildTakeoverPrompt, nextEligibleItem, recordTakeoverReceipt, resolveItemWorkspace } =
  await import('./xos-takeover')

const tempDirs: string[] = []
let savedHome: string | undefined
let savedBashEnv: string | undefined

function makeRepo(name = 'demo-repo'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-live-'))
  tempDirs.push(base)
  const repo = join(base, name)
  const goalDir = join(repo, 'automations', 'goals', 'content-writer')
  mkdirSync(join(goalDir, 'inbox'), { recursive: true })
  mkdirSync(join(goalDir, 'log'), { recursive: true })
  writeFileSync(
    join(goalDir, 'GOAL.md'),
    [
      '---',
      'title: Content writer',
      'agents: [claude, codex]',
      'model: opus',
      'lock_lane: content',
      'queues:',
      '  in:',
      '    - path: docs/features/planned',
      '      ready_when: "builder.ready: true"',
      '---',
      '',
      '# Content writer',
      'Write posts.'
    ].join('\n'),
    'utf8'
  )
  writeFileSync(join(goalDir, 'STATUS.md'), 'status: drafting\n', 'utf8')
  return repo
}

/** Fake agent binaries; `claude` prints $FAKE_CLAUDE_OUT and exits $FAKE_CLAUDE_EXIT. */
function fakeAgents(base: string, script: string): void {
  const bin = join(base, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const name of ['claude', 'codex']) {
    const path = join(bin, name)
    writeFileSync(path, `#!/bin/sh\n${script}`, 'utf8')
    chmodSync(path, 0o755)
  }
  const bashEnv = join(base, 'bash-env.sh')
  writeFileSync(bashEnv, `export PATH="${bin}:$PATH"`, 'utf8')
  process.env.BASH_ENV = bashEnv
}

const waitFor = async (check: () => boolean, ms = 8000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for a native run to finish')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeEach(() => {
  savedHome = process.env.ORCA_XOS_HOME
  savedBashEnv = process.env.BASH_ENV
  process.env.ORCA_XOS_HOME = mkdtempSync(join(tmpdir(), 'xos-home-'))
  tempDirs.push(process.env.ORCA_XOS_HOME)
})

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env.ORCA_XOS_HOME
  } else {
    process.env.ORCA_XOS_HOME = savedHome
  }
  if (savedBashEnv === undefined) {
    delete process.env.BASH_ENV
  } else {
    process.env.BASH_ENV = savedBashEnv
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('startNativeGoalRun (Stage D native runs)', () => {
  it('runs the agent, writes a receipt, and releases the item claim on success', async () => {
    const repo = makeRepo()
    fakeAgents(repo, 'echo "published three posts"\nexit 0')
    const planned = join(repo, 'docs', 'features', 'planned')
    mkdirSync(planned, { recursive: true })
    const item = join(planned, '2026-11-03-add-share-buttons.md')
    writeFileSync(
      item,
      '---\ntitle: Add share buttons\nbuilder:\n  ready: true\n---\n\n# Spec\n',
      'utf8'
    )

    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'content-writer' })
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    expect(nativeRunningFor(liveRunRegistry(), repo, 'content-writer')?.goal).toBe('content-writer')

    await waitFor(
      () => readLiveTail(liveRunRegistry(), repo, 'content-writer')?.status === 'success'
    )

    const receipts = readReceiptLines(repo)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].status).toBe('success')
    expect(receipts[0].exit_code).toBe(0)
    expect(receipts[0].runner).toBe('claude')
    expect(receipts[0].model).toBe('opus')
    expect(receipts[0].item_path).toBe(item)
    expect(receipts[0].log_path).toContain('content-writer')
    expect(readFileSync(receipts[0].log_path, 'utf8')).toContain('published three posts')

    const tail = readLiveTail(liveRunRegistry(), repo, 'content-writer')
    expect(tail?.status).toBe('success')
    expect(tail?.lines.join('\n')).toContain('published three posts')
    expect(tail?.item?.title).toBe('Add share buttons')
    expect(tail?.item?.stage).toBe('planned')

    const promptFile = receipts[0].log_path.replace(/\.log$/, '.prompt.md')
    expect(readFileSync(promptFile, 'utf8')).toContain('## Claimed Work Item')
    // Claim released on finish so the queue gate sees the item again (§3g.5).
    expect(readFileSync(item, 'utf8')).not.toContain('claimed_by:')
    // Merged board view.
    expect(readNativeReceipts(repo).get('content-writer')).toHaveLength(1)
    expect(runsTodayCount(repo, 'content-writer', Date.now())).toBe(1)
  })

  it('classifies a usage-limit banner as limited/failed with failure_reason usage_limit', async () => {
    const repo = makeRepo()
    fakeAgents(repo, 'echo "You have hit your usage limit for this session." \nexit 0')
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'content-writer' })
    expect(started.ok).toBe(true)
    await waitFor(
      () =>
        readLiveTail(liveRunRegistry(), repo, 'content-writer') !== null &&
        readLiveTail(liveRunRegistry(), repo, 'content-writer')?.status !== 'running'
    )
    const tail = readLiveTail(liveRunRegistry(), repo, 'content-writer')
    expect(tail?.status).toBe('limited')
    const receipt = readReceiptLines(repo)[0]
    expect(receipt.status).toBe('failed')
    expect(receipt.failure_reason).toBe('usage_limit')
  })

  it('maps a non-zero exit to failed without a failure_reason', async () => {
    const repo = makeRepo()
    fakeAgents(repo, 'echo "something broke"\nexit 3')
    const started = await startNativeGoalRun({ repoRoot: repo, goal: 'content-writer' })
    expect(started.ok).toBe(true)
    await waitFor(
      () => readLiveTail(liveRunRegistry(), repo, 'content-writer')?.status === 'failed'
    )
    const receipt = readReceiptLines(repo)[0]
    expect(receipt.status).toBe('failed')
    expect(receipt.failure_reason).toBe('run_failed')
    expect(receipt.exit_code).toBe(3)
  })

  it('refuses when a run is already in flight for the goal (self-recursion lock)', async () => {
    const repo = makeRepo()
    fakeAgents(repo, 'sleep 5\necho done')
    const first = await startNativeGoalRun({ repoRoot: repo, goal: 'content-writer' })
    expect(first.ok).toBe(true)
    const second = await startNativeGoalRun({ repoRoot: repo, goal: 'content-writer' })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error).toContain('busy')
    }
  })
})

describe('buildTakeoverPrompt / nextEligibleItem / resolveItemWorkspace (§3e, §3h.2)', () => {
  it('assembles a takeover prompt with the previous run context and the item', async () => {
    const repo = makeRepo()
    const planned = join(repo, 'docs', 'features', 'planned')
    mkdirSync(planned, { recursive: true })
    const item = join(planned, 'ready-spec.md')
    writeFileSync(
      item,
      '---\ntitle: Ready spec\nbuilder:\n  ready: true\n---\n\nBuild it.\n',
      'utf8'
    )
    recordTakeoverReceipt({
      repoRoot: repo,
      goal: 'content-writer',
      agent: 'claude',
      trigger: 'manual_takeover'
    })

    const prepared = buildTakeoverPrompt({
      repoRoot: repo,
      goal: 'content-writer',
      agent: 'codex',
      itemPath: item,
      fromStartedAt: readReceiptLines(repo)[0].started_at
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    expect(prepared.agent).toBe('codex')
    expect(prepared.prompt).toContain('You Are Taking Over From Run')
    expect(prepared.prompt).toContain('Claimed Work Item')
    expect(prepared.prompt).toContain('Build it.')

    const next = nextEligibleItem(repo, 'content-writer')
    expect(next?.path).toBe(item)
    expect(next?.title).toBe('Ready spec')
    expect(next?.workspace).toBe('new-worktree')
    expect(resolveItemWorkspace(repo, item)).toBe('new-worktree')
  })

  it('returns null from nextEligibleItem when the input queue is empty', () => {
    const repo = makeRepo()
    expect(nextEligibleItem(repo, 'content-writer')).toBeNull()
  })
})
