import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'
import type { XosCatalogModel } from '../../shared/xos-runtime-types'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Notification: { isSupported: () => false }
}))

const { inferTier, rankCandidates } = await import('./xos-auto-mode')
const { assessQuota, registerXosQuotaSource } = await import('./xos-quota')
const { xosLaunchAutomation } = await import('./xos-run-fallback')
const { readRunAttempts, writeRunConfig } = await import('./xos-runtime-store')

const NOW = Date.UTC(2026, 10, 3, 12)
const HOUR = 3_600_000

function limits(weeklyUsed: number, resetsInHours: number, sessionUsed = 10): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: sessionUsed,
      windowMinutes: 300,
      resetsAt: NOW + HOUR,
      resetDescription: null
    },
    weekly: {
      usedPercent: weeklyUsed,
      windowMinutes: 10080,
      resetsAt: NOW + resetsInHours * HOUR,
      resetDescription: null
    },
    updatedAt: NOW,
    error: null,
    status: 'ok'
  }
}

const model = (id: string): XosCatalogModel => ({
  id,
  label: id,
  isDefault: false,
  efforts: [{ value: 'high', label: 'High' }]
})

describe('tiers', () => {
  it('infers the RT5 pairs from model names', () => {
    expect(['opus', 'gpt-5.5', 'gemini-3.1-pro-preview', 'fable'].map(inferTier)).toEqual([
      'high',
      'high',
      'high',
      'high'
    ])
    expect(['sonnet', 'gpt-5.4-mini', 'gemini-3.5-flash'].map(inferTier)).toEqual([
      'standard',
      'standard',
      'standard'
    ])
    expect(['haiku', 'gpt-5.3-codex-spark'].map(inferTier)).toEqual(['light', 'light'])
    expect(inferTier('something-new')).toBeNull()
  })
})

describe('quota', () => {
  it('drops a provider inside the reserve or with a full 5h window', () => {
    expect(assessQuota('claude', 'opus', 10, NOW, limits(93, 48))).toMatchObject({
      exhausted: true,
      note: 'claude weekly at 93% (keeping 10% reserve)'
    })
    expect(assessQuota('claude', 'opus', 0, NOW, limits(20, 48, 99)).exhausted).toBe(true)
    expect(assessQuota('codex', 'gpt-5.5', 0, NOW, null)).toMatchObject({
      known: false,
      exhausted: false
    })
  })
})

describe('ranking', () => {
  const auto = {
    tier: 'high' as const,
    providers: ['claude', 'codex'],
    reservePercent: 10,
    effort: 'high'
  }
  const listed = [
    { agent: 'claude', models: [model('opus'), model('sonnet')] },
    { agent: 'codex', models: [model('gpt-5.5'), model('gpt-5.4-mini')] }
  ]

  it('prefers the quota that resets soonest with the most left, and skips exhausted ones', () => {
    const quotas: Record<string, ProviderRateLimits> = {
      claude: limits(50, 120),
      codex: limits(50, 24)
    }
    const ranked = rankCandidates(auto, listed, {}, (agent, id) =>
      assessQuota(agent, id, auto.reservePercent, NOW, quotas[agent])
    )
    expect(ranked.map((entry) => entry.choice.model)).toEqual(['gpt-5.5', 'opus'])
    expect(ranked[0].choice.effort).toBe('high')

    quotas.codex = limits(95, 24)
    const next = rankCandidates(auto, listed, {}, (agent, id) =>
      assessQuota(agent, id, auto.reservePercent, NOW, quotas[agent])
    )
    expect(next.map((entry) => [entry.choice.model, entry.available])).toEqual([
      ['opus', true],
      ['gpt-5.5', false]
    ])
  })

  it('follows tier map edits', () => {
    const ranked = rankCandidates(
      auto,
      listed,
      { 'claude:sonnet': 'high', 'claude:opus': null },
      () => assessQuota('x', null, 0, NOW, null)
    )
    expect(ranked.map((entry) => entry.choice.model)).toEqual(['sonnet', 'gpt-5.5'])
  })
})

describe('before launch', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'xos-auto-'))
    process.env.ORCA_XOS_HOME = home
  })
  afterEach(() => {
    delete process.env.ORCA_XOS_HOME
    rmSync(home, { recursive: true, force: true })
    registerXosQuotaSource({ getState: () => ({}) as RateLimitState })
  })

  it('skips a primary model whose quota is used up and records why', async () => {
    registerXosQuotaSource({
      getState: () => ({ claude: limits(100, 30), codex: null }) as unknown as RateLimitState
    })
    writeRunConfig('a', { fallbacks: [{ agent: 'codex', model: 'gpt-5.5', effort: null }] })
    const automation = {
      id: 'a',
      name: 'A',
      agentId: 'claude',
      extraAgentArgs: '--model opus'
    } as Automation
    const run = { id: 'r1', automationId: 'a', trigger: 'scheduled' } as AutomationRun
    const launched = await xosLaunchAutomation(automation, run)
    expect(launched.agentId).toBe('codex')
    const [attempt] = readRunAttempts('a', 1)
    expect(attempt).toMatchObject({ attempt: 1, agent: 'codex' })
    expect(attempt.reason).toMatch(/^skipped before launch: claude weekly at 100%/)
  })
})
