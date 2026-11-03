import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))

const { xosLaunchAutomation, xosObserveFinishedRun } = await import('./xos-run-fallback')
const { readRunAttempts, writeRunConfig } = await import('./xos-runtime-store')

let home: string
const LIMIT = "Working…\n⎿  You've hit your limit · resets 3pm\n> "

const automation = {
  id: 'auto-1',
  name: 'Content writer',
  agentId: 'claude',
  extraAgentArgs: '--model opus --effort high'
} as Automation

function run(id: string, trigger: AutomationRun['trigger'], screen?: string): AutomationRun {
  return {
    id,
    automationId: automation.id,
    trigger,
    status: 'completed',
    sessionKind: 'terminal',
    outputSnapshot: screen
      ? { format: 'plain_text', content: screen, capturedAt: 0, truncated: false }
      : null,
    error: null
  } as AutomationRun
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xos-fallback-'))
  process.env.ORCA_XOS_HOME = home
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(home, { recursive: true, force: true })
})

describe('fallback chain', () => {
  it('retries a limited scheduled run on the next model and records both attempts', async () => {
    writeRunConfig(automation.id, {
      fallbacks: [{ agent: 'codex', model: 'gpt-5.5', effort: 'high' }],
      fallbackOnManualRuns: false
    })
    const runNow = vi.fn(async () => undefined)
    expect(await xosLaunchAutomation(automation, run('r1', 'scheduled'))).toEqual(automation)
    xosObserveFinishedRun({ automation, runNow }, run('r1', 'scheduled', LIMIT))
    expect(runNow).toHaveBeenCalledWith('auto-1')

    const retried = await xosLaunchAutomation(automation, run('r2', 'manual'))
    expect(retried.agentId).toBe('codex')
    expect(retried.extraAgentArgs).toBe('-m gpt-5.5 -c model_reasoning_effort=high')

    xosObserveFinishedRun({ automation, runNow }, run('r2', 'manual', 'All done.'))
    expect(runNow).toHaveBeenCalledTimes(1)

    const attempts = readRunAttempts(automation.id, 10)
    expect(attempts.map((a) => [a.runId, a.attempt, a.agent, a.outcome?.kind])).toEqual([
      ['r2', 1, 'codex', 'ok'],
      ['r1', 0, 'claude', 'usage-limit']
    ])
    expect(attempts[0]).toMatchObject({ rootRunId: 'r1', parentRunId: 'r1' })
    expect(attempts[0].reason).toMatch(/^usage limit/)
  })

  it('does not fall back for a manual run unless opted in, nor twice for one completion', async () => {
    writeRunConfig(automation.id, {
      fallbacks: [{ agent: 'codex', model: null, effort: null }],
      fallbackOnManualRuns: false
    })
    const runNow = vi.fn(async () => undefined)
    await xosLaunchAutomation(automation, run('m1', 'manual'))
    xosObserveFinishedRun({ automation, runNow }, run('m1', 'manual', LIMIT))
    expect(runNow).not.toHaveBeenCalled()

    writeRunConfig(automation.id, {
      fallbacks: [{ agent: 'codex', model: null, effort: null }],
      fallbackOnManualRuns: true
    })
    await xosLaunchAutomation(automation, run('m2', 'manual'))
    xosObserveFinishedRun({ automation, runNow }, run('m2', 'manual', LIMIT))
    xosObserveFinishedRun({ automation, runNow }, run('m2', 'manual', LIMIT))
    expect(runNow).toHaveBeenCalledTimes(1)
  })

  it('never falls back on an ordinary failure and stops at the end of the chain', async () => {
    writeRunConfig(automation.id, { fallbacks: [], fallbackOnManualRuns: false })
    const runNow = vi.fn(async () => undefined)
    await xosLaunchAutomation(automation, run('s1', 'scheduled'))
    xosObserveFinishedRun({ automation, runNow }, run('s1', 'scheduled', 'Error: tests failed (3)'))
    await xosLaunchAutomation(automation, run('s2', 'scheduled'))
    xosObserveFinishedRun({ automation, runNow }, run('s2', 'scheduled', LIMIT))
    expect(runNow).not.toHaveBeenCalled()
  })

  it('falls back on chat-surface runs when usageLimitReached or auth failure is observed', async () => {
    const chatAutomation: Automation = { ...automation, id: 'chat-auto-1', surface: 'chat' }
    writeRunConfig(chatAutomation.id, {
      fallbacks: [{ agent: 'codex', model: 'gpt-5.4', effort: 'medium' }],
      fallbackOnManualRuns: false
    })
    const runNow = vi.fn(async () => undefined)
    const chatRun1: AutomationRun = {
      ...run('c1', 'scheduled'),
      automationId: chatAutomation.id,
      sessionKind: 'chat'
    }
    await xosLaunchAutomation(chatAutomation, chatRun1)

    const failedChatRun1: AutomationRun = {
      ...chatRun1,
      status: 'dispatch_failed',
      outputSnapshot: {
        format: 'plain_text',
        content: 'Usage limit reached · resets at 2026-04-03T20:00:00.000Z',
        capturedAt: 0,
        truncated: false
      },
      error: 'Usage limit reached · resets at 2026-04-03T20:00:00.000Z'
    }
    xosObserveFinishedRun({ automation: chatAutomation, runNow }, failedChatRun1)
    expect(runNow).toHaveBeenCalledWith('chat-auto-1')

    const chatRun2: AutomationRun = {
      ...run('c2', 'manual'),
      automationId: chatAutomation.id,
      sessionKind: 'chat'
    }
    const retried = await xosLaunchAutomation(chatAutomation, chatRun2)
    expect(retried.agentId).toBe('codex')
    expect(retried.extraAgentArgs).toBe('-m gpt-5.4 -c model_reasoning_effort=medium')
  })
})
