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

    const first = await gate.xosBeforeLaunch(automation('a'), run('a1', 'a'), repo)
    expect('automation' in first).toBe(true)
    const skipped = await gate.xosBeforeLaunch(automation('b'), run('b1', 'b'), repo)
    expect(skipped).toEqual({ refusal: 'Lane "content" is busy with another run; skipped.' })
    const queued = await gate.xosBeforeLaunch(automation('c'), run('c1', 'c'), repo)
    expect('refusal' in queued && queued.refusal).toMatch(/Queued/)

    gate.xosAfterRunFinished(run('a1', 'a', 'completed'))
    await flush()
    expect(host.runNow).toHaveBeenCalledWith('c')
    expect(
      'automation' in (await gate.xosBeforeLaunch(automation('b'), run('b2', 'b'), repo))
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
      const result = await gate.xosBeforeLaunch(automation('a'), run('a2', 'a'), repo)
      expect('refusal' in result).toBe(true)
    } finally {
      // flock's child inherits the lock, so end the whole group (as a finished cron job would).
      process.kill(-legacy.pid!, 'SIGKILL')
    }
    await flush()
    const result = await gate.xosBeforeLaunch(automation('a'), run('a3', 'a'), repo)
    expect('automation' in result).toBe(true)
    gate.xosReleaseRun('a3')
  })
})

describe('run timeout', () => {
  it('marks a still-running run failed and closes its terminal', async () => {
    vi.useFakeTimers()
    try {
      writeRunConfig('t', { timeoutMinutes: 1 })
      await gate.xosBeforeLaunch(automation('t'), run('t1', 't', 'dispatched'), repo)
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
