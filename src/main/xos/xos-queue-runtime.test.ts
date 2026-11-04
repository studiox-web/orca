// XOS fork: H1 wiring: a queue event starts a real native run, only for opted-in projects (L9).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startNativeGoalRun = vi.fn(async () => ({ ok: true, runId: 'r', message: 'ok' }))
vi.mock('./xos-live-runs', () => ({ startNativeGoalRun }))

const { startXosQueueRuntime } = await import('./xos-queue-runtime')
const { setProjectTriggers } = await import('./xos-trigger-projects')
const { evaluateProjectQueueTriggers } = await import('./xos-queue-triggers')
const { goalLockFile, tryLock } = await import('./xos-lane-lock')

let base: string
let repo: string

beforeEach(() => {
  vi.clearAllMocks()
  base = mkdtempSync(join(tmpdir(), 'xos-qrt-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
  repo = join(base, 'site')
  const goal = join(repo, 'automations', 'goals', 'writer')
  mkdirSync(join(goal, 'inbox'), { recursive: true })
  writeFileSync(
    join(goal, 'GOAL.md'),
    '---\nlock_lane: content\nqueues:\n  in:\n    - path: docs/features/planned\n---\n# W\n'
  )
  mkdirSync(join(repo, 'docs', 'features', 'planned'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'features', 'planned', 'a.md'), '---\ntitle: A\n---\n')
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('startXosQueueRuntime', () => {
  it('starts nothing for a project that did not opt in', async () => {
    const stop = startXosQueueRuntime()
    await new Promise<void>((done) => {
      setImmediate(done)
    })
    stop()
    expect(startNativeGoalRun).not.toHaveBeenCalled()
  })

  it('starts a native run with the event trigger for an opted-in project', async () => {
    setProjectTriggers(repo, true)
    const stop = startXosQueueRuntime()
    await vi.waitFor(() => expect(startNativeGoalRun).toHaveBeenCalled(), { timeout: 3000 })
    stop()
    expect(startNativeGoalRun).toHaveBeenCalledWith({
      repoRoot: repo,
      goal: 'writer',
      mode: 'normal',
      trigger: 'event'
    })
  })
})

describe('evaluateProjectQueueTriggers (L9)', () => {
  it('sees a native run through the same goal lock the runner takes', async () => {
    const held = await tryLock(goalLockFile(repo, 'writer'))
    expect(await evaluateProjectQueueTriggers({ repoRoot: repo })).toEqual([])
    held?.release()
  })

  it('does not re-trigger a reply for a message a run already took', async () => {
    const message = join(repo, 'automations', 'goals', 'writer', 'inbox', 'a.md')
    writeFileSync(message, '---\nfrom: operator\nstatus: open\n---\nHi\n')
    const events = await evaluateProjectQueueTriggers({ repoRoot: repo })
    expect(events[0]?.mode).toBe('reply')
    writeFileSync(message, '---\nfrom: operator\nstatus: open\nread_at: x\n---\nHi\n')
    const again = await evaluateProjectQueueTriggers({ repoRoot: repo })
    expect(again.every((event) => event.mode !== 'reply')).toBe(true)
  })
})
