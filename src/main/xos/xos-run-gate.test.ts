import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'

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
    await flush()
    expect(host.runNow).toHaveBeenCalledWith('c')
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

    // With CASCADE_ACTIVE_LOCK_LANE, child-goal inherits the lane, but parent-goal still cannot recurse on itself.
    process.env.CASCADE_ACTIVE_LOCK_LANE = 'repo-mutating'
    try {
      const envChild = await gate.xosBeforeLaunch(
        automation('child-goal'),
        run('c3', 'child-goal'),
        target()
      )
      expect('automation' in envChild).toBe(true)
      gate.xosReleaseRun('c3')

      const selfRecurse = await gate.xosBeforeLaunch(
        automation('parent-goal'),
        run('p2', 'parent-goal'),
        target()
      )
      expect('refusal' in selfRecurse).toBe(true)
    } finally {
      delete process.env.CASCADE_ACTIVE_LOCK_LANE
      gate.xosReleaseRun('p1')
    }
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
