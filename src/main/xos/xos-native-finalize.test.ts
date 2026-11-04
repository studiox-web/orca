import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XosLiveRun } from './xos-live-runs-types'

const order: string[] = []
vi.mock('./xos-auto-commit', () => ({
  readLegacyCommitPolicies: () => [
    { goal: 'writer', paths: ['automations/goals/writer', 'public/feed.xml'] }
  ],
  xosAutoCommit: vi.fn(async () => {
    order.push('commit')
    return { status: 'committed', sha: 'abc1234', files: 1, pushed: null, detail: null, at: '' }
  })
}))

const { finalizeNativeRun, goalCommitPaths } = await import('./xos-native-finalize')
const { xosAutoCommit } = await import('./xos-auto-commit')

let base: string
let repo: string

function liveRun(overrides: Partial<XosLiveRun> = {}): XosLiveRun {
  const logPath = join(base, 'run.log')
  writeFileSync(logPath, 'done\n')
  return {
    runId: 'writer-1',
    repoRoot: repo,
    goal: 'writer',
    agent: 'claude',
    mode: 'normal',
    trigger: 'manual',
    parentRunId: null,
    pid: 1,
    startedAt: new Date().toISOString(),
    deadlineAtMs: null,
    leasePath: join(base, 'lease'),
    itemPath: null,
    itemTitle: null,
    itemStage: null,
    worktreePath: null,
    branch: null,
    logPath,
    exitPath: join(base, 'exit'),
    command: '',
    model: null,
    effort: null,
    disableAutoCommit: false,
    disableFallback: false,
    attempt: 0,
    fallbackChain: [],
    locks: [{ file: 'lane', pid: null, release: () => order.push('release') }],
    finishedAt: null,
    exitCode: null,
    outcome: null,
    failureReason: null,
    stopReason: null,
    finalizing: false,
    timer: null,
    ...overrides
  }
}

beforeEach(() => {
  order.length = 0
  vi.clearAllMocks()
  base = mkdtempSync(join(tmpdir(), 'xos-finalize-'))
  repo = join(base, 'repo')
  mkdirSync(join(repo, 'automations', 'goals', 'writer'), { recursive: true })
  writeFileSync(join(repo, 'automations', 'goals', 'writer', 'GOAL.md'), '---\ntitle: W\n---\n')
  process.env.ORCA_XOS_HOME = join(base, 'home')
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('finalizeNativeRun', () => {
  it('commits while the lane is still held (M5)', async () => {
    await finalizeNativeRun(liveRun(), 0, async () => false)
    expect(order).toEqual(['commit', 'release'])
  })

  it('commits everything in a Build now worktree on its branch (M5)', async () => {
    await finalizeNativeRun(
      liveRun({ worktreePath: '/wt', branch: 'xos-writer', itemTitle: 'Share buttons' }),
      0,
      async () => false
    )
    expect(vi.mocked(xosAutoCommit).mock.calls[0][0]).toMatchObject({
      cwd: '/wt',
      config: { paths: ['.'], push: false }
    })
    expect(vi.mocked(xosAutoCommit).mock.calls[0][0].config.message).toContain(
      'Item: Share buttons'
    )
  })

  it('never commits a stopped run, and settles once', async () => {
    const run = liveRun({ stopReason: 'timeout' })
    await Promise.all([
      finalizeNativeRun(run, null, async () => false),
      finalizeNativeRun(run, null, async () => false)
    ])
    expect(xosAutoCommit).not.toHaveBeenCalled()
    expect(run.failureReason).toBe('timeout')
    expect(order).toEqual(['release'])
  })
})

describe('goalCommitPaths', () => {
  it('prefers owned_paths and drops the repo goal folder once the goal moved (M5)', () => {
    expect(goalCommitPaths(repo, 'writer')).toEqual(['automations/goals/writer', 'public/feed.xml'])
    const central = join(base, 'home', 'projects', 'repo', 'goals', 'writer')
    mkdirSync(central, { recursive: true })
    writeFileSync(join(central, 'GOAL.md'), '---\ntitle: W\n---\n')
    expect(goalCommitPaths(repo, 'writer')).toEqual(['public/feed.xml'])
    writeFileSync(join(central, 'GOAL.md'), '---\nowned_paths: [content/posts]\n---\n')
    expect(goalCommitPaths(repo, 'writer')).toEqual(['content/posts'])
  })
})
