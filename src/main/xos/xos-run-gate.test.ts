import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Automation,
  AutomationRun,
  AutomationRunOutputSnapshot
} from '../../shared/automations-types'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const gate = await import('./xos-run-gate')
const { writeRunConfig } = await import('./xos-runtime-store')
const { laneLockFile } = await import('./xos-lane-lock')

let home: string
let repo: string
const runs = new Map<string, AutomationRun>()
const host = {
  findRun: (_automationId: string, runId: string) => runs.get(runId) ?? null,
  findAutomation: () => null,
  runNow: vi.fn(async () => undefined),
  markDispatchResult: vi.fn(async () => undefined),
  closeRunTerminal: vi.fn(async () => undefined)
}

function automation(id: string): Automation {
  return { id, name: id, agentId: 'claude', extraAgentArgs: '' } as Automation
}

function run(
  id: string,
  automationId: string,
  status: AutomationRun['status'] = 'dispatching'
): AutomationRun {
  const value = {
    id,
    automationId,
    trigger: 'scheduled',
    status,
    sessionKind: 'terminal'
  } as AutomationRun
  runs.set(id, value)
  return value
}

const target = (): { repoRoot: string; cwd: string; local: boolean } => ({
  repoRoot: repo,
  cwd: repo,
  local: true
})

// ast-grep-ignore: test-no-real-time-wait -- waits for OS flock child process release
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300))

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xos-gate-home-'))
  repo = mkdtempSync(join(tmpdir(), 'xos-gate-repo-'))
  process.env.ORCA_XOS_HOME = home
  gate.registerXosAutomationHost(host)
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

describe('lane locks', () => {
  it('lets one run hold a lane, skips or queues the next, and starts the queued one on release', async () => {
    writeRunConfig('a', { lockLane: 'content' })
    writeRunConfig('b', { lockLane: 'content' })
    writeRunConfig('c', { lockLane: 'content', lockWaitMinutes: 10 })

    const first = await gate.xosBeforeLaunch(automation('a'), run('a1', 'a'), target())
    expect('automation' in first).toBe(true)
    const skipped = await gate.xosBeforeLaunch(automation('b'), run('b1', 'b'), target())
    expect(skipped).toEqual({ refusal: 'Lane "content" is busy with another run; skipped.' })
    const queued = await gate.xosBeforeLaunch(automation('c'), run('c1', 'c'), target())
    expect('refusal' in queued && queued.refusal).toMatch(/Queued/)

    gate.xosAfterRunFinished(run('a1', 'a', 'completed'))
    await vi.waitFor(() => expect(host.runNow).toHaveBeenCalledWith('c', 'scheduled'), {
      timeout: 3000,
      interval: 50
    })
    expect(
      'automation' in (await gate.xosBeforeLaunch(automation('b'), run('b2', 'b'), target()))
    ).toBe(true)
    gate.xosReleaseRun('b2')
  })

  it('respects a lock held by the legacy crontab runner (same flock file)', async () => {
    writeRunConfig('a', { lockLane: 'repo-mutating' })
    const file = laneLockFile(repo, 'repo-mutating')
    mkdirSync(dirname(file), { recursive: true })
    const legacy: ChildProcess = spawn('flock', [file, 'sleep', '30'], {
      stdio: 'ignore',
      detached: true
    })
    await flush()
    try {
      const result = await gate.xosBeforeLaunch(automation('a'), run('a2', 'a'), target())
      expect('refusal' in result).toBe(true)
    } finally {
      // flock's child inherits the lock, so end the whole group (as a finished cron job would).
      process.kill(-legacy.pid!, 'SIGKILL')
    }
    await flush()
    const result = await gate.xosBeforeLaunch(automation('a'), run('a3', 'a'), target())
    expect('automation' in result).toBe(true)
    gate.xosReleaseRun('a3')
  })

  it('allows nested child runs in the same lane via CASCADE_ACTIVE_LOCK_LANE or xosGrantInheritedLane while blocking self-recursion (RT13)', async () => {
    writeRunConfig('parent-goal', { lockLane: 'repo-mutating' })
    writeRunConfig('child-goal', { lockLane: 'repo-mutating' })

    const parentLaunch = await gate.xosBeforeLaunch(
      automation('parent-goal'),
      run('p1', 'parent-goal'),
      target()
    )
    expect('automation' in parentLaunch).toBe(true)

    // Without inheritance, child-goal sees the lane as busy.
    const blockedChild = await gate.xosBeforeLaunch(
      automation('child-goal'),
      run('c1', 'child-goal'),
      target()
    )
    expect(blockedChild).toEqual({
      refusal: 'Lane "repo-mutating" is busy with another run; skipped.'
    })

    // With xosGrantInheritedLane, child-goal inherits the active lane lock.
    gate.xosGrantInheritedLane('child-goal', 'repo-mutating')
    const allowedChild = await gate.xosBeforeLaunch(
      automation('child-goal'),
      run('c2', 'child-goal'),
      target()
    )
    expect('automation' in allowedChild).toBe(true)
    gate.xosReleaseRun('c2')

    // Orca's own environment grants nothing: the variable belongs to the agent's process.
    process.env.CASCADE_ACTIVE_LOCK_LANE = 'repo-mutating'
    try {
      const noGrant = await gate.xosBeforeLaunch(
        automation('child-goal'),
        run('c3', 'child-goal'),
        target()
      )
      expect('refusal' in noGrant).toBe(true)
    } finally {
      delete process.env.CASCADE_ACTIVE_LOCK_LANE
    }

    // A parent still cannot recurse into itself, grant or not.
    gate.xosGrantInheritedLane('parent-goal', 'repo-mutating')
    const selfRecurse = await gate.xosBeforeLaunch(
      automation('parent-goal'),
      run('p2', 'parent-goal'),
      target()
    )
    expect('refusal' in selfRecurse).toBe(true)
    gate.xosReleaseRun('p1')

    // Once nobody holds the lane the grant is void, and the child takes the lane normally.
    await flush()
    gate.xosGrantInheritedLane('child-goal', 'repo-mutating')
    const afterRelease = await gate.xosBeforeLaunch(
      automation('child-goal'),
      run('c4', 'child-goal'),
      target()
    )
    expect('automation' in afterRelease).toBe(true)
    gate.xosReleaseRun('c4')
  })
})

describe('run timeout', () => {
  it('marks a still-running run failed and closes its terminal', async () => {
    vi.useFakeTimers()
    try {
      writeRunConfig('t', { timeoutMinutes: 1 })
      await gate.xosBeforeLaunch(automation('t'), run('t1', 't', 'dispatched'), target())
      await vi.advanceTimersByTimeAsync(60_000)
      expect(host.markDispatchResult).toHaveBeenCalledWith({
        runId: 't1',
        status: 'dispatch_failed',
        error: 'Stopped after the 1-minute timeout.'
      })
      expect(host.closeRunTerminal).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

const LIMIT_SNAPSHOT: AutomationRunOutputSnapshot = {
  format: 'plain_text',
  content: "You've hit your limit",
  capturedAt: 0,
  truncated: false
}

describe('lane hand-offs (L2, L3, L4)', () => {
  it('stops the agent before the timeout frees the lane (L2)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const order: string[] = []
      host.closeRunTerminal.mockImplementationOnce(async () => {
        order.push('close')
      })
      host.markDispatchResult.mockImplementationOnce(async () => {
        order.push('mark')
      })
      writeRunConfig('a', { timeoutMinutes: 5 })
      await gate.xosBeforeLaunch(automation('a'), run('t1', 'a'), target())
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(order).toEqual(['close', 'mark'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the timeout to chat runs too (H9)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      writeRunConfig('a', { timeoutMinutes: 5 })
      const chat: Automation = { ...automation('a'), surface: 'chat' }
      await gate.xosBeforeLaunch(chat, run('t2', 'a'), target())
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(host.markDispatchResult).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 't2', status: 'dispatch_failed' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the lane across a fallback retry, so a waiter cannot slip in (L3)', async () => {
    const limited: AutomationRun = {
      ...run('l1', 'a'),
      status: 'completed',
      outputSnapshot: LIMIT_SNAPSHOT
    }
    writeRunConfig('a', {
      lockLane: 'content',
      fallbacks: [{ agent: 'codex', model: null, effort: null }]
    })
    writeRunConfig('w', { lockLane: 'content', lockWaitMinutes: 10 })
    const parent = {
      ...host,
      findAutomation: () => automation('a')
    }
    gate.registerXosAutomationHost(parent)
    await gate.xosBeforeLaunch(automation('a'), runs.get('l1')!, target())
    await gate.xosBeforeLaunch(automation('w'), run('w1', 'w'), target())

    gate.xosAfterRunFinished(limited)
    await flush()
    expect(host.runNow).toHaveBeenCalledWith('a')
    expect(host.runNow).not.toHaveBeenCalledWith('w', 'scheduled')

    const retry = await gate.xosBeforeLaunch(automation('a'), run('l2', 'a'), target())
    expect('automation' in retry).toBe(true)
    gate.xosReleaseRun('l2')
    // L4: the waiter comes back as a scheduled run, so it gets a scheduled run's precheck.
    await vi.waitFor(() => expect(host.runNow).toHaveBeenCalledWith('w', 'scheduled'), {
      timeout: 3000,
      interval: 50
    })
  })

  it('does not commit a run that hit a limit', async () => {
    writeRunConfig('a', { autoCommit: { paths: ['src'], message: null, push: false } })
    await gate.xosBeforeLaunch(
      { ...automation('a'), workspaceMode: 'existing' },
      run('c1', 'a'),
      target()
    )
    gate.xosAfterRunFinished({
      ...runs.get('c1')!,
      status: 'completed',
      outputSnapshot: LIMIT_SNAPSHOT
    })
    expect(gate.xosPendingCommits()).toBe(0)
  })
})
