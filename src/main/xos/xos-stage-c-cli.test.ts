import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XOS_GOALS_HANDLERS } from '../../cli/handlers/xos-goals'
import { XOS_ITEMS_HANDLERS } from '../../cli/handlers/xos-items'
import type { CommandHandler, HandlerContext } from '../../cli/dispatch'

function makeCtx(cwd: string, flagObj: Record<string, string | boolean> = {}): HandlerContext {
  return {
    cwd,
    json: true,
    flags: new Map(Object.entries(flagObj)),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: local XOS CLI handlers do not use the RPC client.
    client: {} as HandlerContext['client']
  }
}

async function runCliJson<T = unknown>(
  handler: CommandHandler,
  cwd: string,
  flags: Record<string, string | boolean> = {}
): Promise<T> {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    logs.push(String(msg))
  })
  try {
    await handler(makeCtx(cwd, flags))
  } finally {
    spy.mockRestore()
  }
  const parsed: T = JSON.parse(logs.at(-1) ?? 'null')
  return parsed
}

describe('Stage C CLI handlers (orca goals, items, usage, models)', () => {
  let root: string
  let repoRoot: string
  const prevXosHome = process.env.ORCA_XOS_HOME

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
    root = mkdtempSync(join(tmpdir(), 'xos-stage-c-cli-'))
    process.env.ORCA_XOS_HOME = join(root, '.orca-xos')
    repoRoot = join(root, 'sample-app')
    mkdirSync(join(repoRoot, 'automations/goals/seo-blog-post'), { recursive: true })
    mkdirSync(join(repoRoot, 'docs/features/backlog'), { recursive: true })
    mkdirSync(join(repoRoot, 'docs/features/specs'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'automations/goals/seo-blog-post/GOAL.md'),
      [
        '---',
        'agents: [claude, codex]',
        'model: claude-sonnet-4-6',
        'model_reasoning_effort: medium',
        'lock_lane: repo-mutating',
        '---',
        '# Goal: SEO Blog Post',
        '',
        'Write a weekly SEO post.'
      ].join('\n'),
      'utf8'
    )
    mkdirSync(join(repoRoot, 'automations/logs'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'automations/logs/token-usage.jsonl'),
      `${JSON.stringify({
        ts: '2026-04-15T12:00:00.000Z',
        feature: 'seo-blog-post',
        model: 'claude-sonnet-4-6',
        actual_tokens: 12500,
        estimated_cost_usd: 0.0425
      })}\n`,
      'utf8'
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    if (prevXosHome === undefined) {
      delete process.env.ORCA_XOS_HOME
    } else {
      process.env.ORCA_XOS_HOME = prevXosHome
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('supports goals list, show, create, edit, message, reply, run, archive, delete, and history', async () => {
    const listed = await runCliJson<{ goals: { goal: string }[] }>(
      XOS_GOALS_HANDLERS['goals list'],
      repoRoot
    )
    expect(listed.goals.map((g) => g.goal)).toContain('seo-blog-post')

    const created = await runCliJson<{ ok: boolean; goal: string }>(
      XOS_GOALS_HANDLERS['goals create'],
      repoRoot,
      {
        slug: 'bug-hunter',
        title: 'Bug Hunter',
        area: 'Engineering',
        model: 'gpt-5.4'
      }
    )
    expect(created.ok).toBe(true)
    expect(created.goal).toBe('bug-hunter')

    const edited = await runCliJson<{ ok: boolean; changes: string[] }>(
      XOS_GOALS_HANDLERS['goals edit'],
      repoRoot,
      {
        goal: 'bug-hunter',
        effort: 'high',
        'max-runs-per-day': '3'
      }
    )
    expect(edited.ok).toBe(true)
    expect(edited.changes).toContain('model_reasoning_effort=high')

    const msgRes = await runCliJson<{ ok: boolean; message: { id: string } }>(
      XOS_GOALS_HANDLERS['goals message'],
      repoRoot,
      {
        goal: 'seo-blog-post',
        body: 'Cover harmonic mixing next.'
      }
    )
    expect(msgRes.ok).toBe(true)

    const shown = await runCliJson<{ goal: string; inbox: { status: string }[] }>(
      XOS_GOALS_HANDLERS['goals show'],
      repoRoot,
      { goal: 'seo-blog-post' }
    )
    expect(shown.goal).toBe('seo-blog-post')
    expect(shown.inbox).toHaveLength(1)

    const replyRun = await runCliJson<{ ok: boolean; mode: string; openInboxCount: number }>(
      XOS_GOALS_HANDLERS['goals reply'],
      repoRoot,
      { goal: 'seo-blog-post' }
    )
    expect(replyRun.ok).toBe(true)
    expect(replyRun.mode).toBe('reply')
    expect(replyRun.openInboxCount).toBe(1)

    const normalRun = await runCliJson<{ ok: boolean; mode: string }>(
      XOS_GOALS_HANDLERS['goals run'],
      repoRoot,
      { goal: 'seo-blog-post', message: 'Focus on beginners' }
    )
    expect(normalRun.ok).toBe(true)
    expect(normalRun.mode).toBe('normal')

    const archived = await runCliJson<{ ok: boolean; archived: boolean }>(
      XOS_GOALS_HANDLERS['goals archive'],
      repoRoot,
      { goal: 'bug-hunter' }
    )
    expect(archived.ok).toBe(true)

    await runCliJson(XOS_GOALS_HANDLERS['goals create'], repoRoot, {
      slug: 'temp-goal',
      title: 'Temp Goal'
    })
    const deleted = await runCliJson<{ ok: boolean; deleted: boolean }>(
      XOS_GOALS_HANDLERS['goals delete'],
      repoRoot,
      { goal: 'temp-goal', confirm: 'temp-goal' }
    )
    expect(deleted.ok).toBe(true)

    const history = await runCliJson<{ auditEvents: { action: string }[] }>(
      XOS_GOALS_HANDLERS['goals history'],
      repoRoot,
      {}
    )
    expect(history.auditEvents.length).toBeGreaterThan(0)
  })

  it('supports items create, list, edit, move, show (with transition timeline), usage summary, and models list', async () => {
    const created = await runCliJson<{ ok: boolean; id: string; path: string }>(
      XOS_ITEMS_HANDLERS['items create'],
      repoRoot,
      {
        type: 'feature-ideas',
        stage: 'backlog',
        title: 'Harmonic Filter',
        priority: 'high',
        ready: true
      }
    )
    expect(created.ok).toBe(true)

    const listed = await runCliJson<{ total: number; items: { id: string }[] }>(
      XOS_ITEMS_HANDLERS['items list'],
      repoRoot,
      { project: 'sample-app', type: 'feature-ideas', stage: 'backlog' }
    )
    expect(listed.total).toBe(1)
    expect(listed.items[0]?.id).toBe(created.id)

    const edited = await runCliJson<{ ok: boolean }>(XOS_ITEMS_HANDLERS['items edit'], repoRoot, {
      id: created.id,
      set: 'size=m\0risk=low',
      ready: true
    })
    expect(edited.ok).toBe(true)

    const moved = await runCliJson<{ ok: boolean; item: { stageId: string } }>(
      XOS_ITEMS_HANDLERS['items move'],
      repoRoot,
      {
        id: created.id,
        'to-stage': 'specs'
      }
    )
    expect(moved.ok).toBe(true)
    expect(moved.item.stageId).toBe('specs')

    const rejected = await runCliJson<{ ok: boolean; item: { stageId: string; bucket: string } }>(
      XOS_ITEMS_HANDLERS['items move'],
      repoRoot,
      {
        id: created.id,
        'to-stage': 'rejected',
        reason: 'not-now'
      }
    )
    expect(rejected.ok).toBe(true)
    expect(rejected.item.stageId).toBe('rejected')
    expect(rejected.item.bucket).toBe('not-now')

    const detail = await runCliJson<{ transitions: { fromStage: string; toStage: string }[] }>(
      XOS_ITEMS_HANDLERS['items show'],
      repoRoot,
      { id: created.id }
    )
    expect(detail.transitions.length).toBeGreaterThanOrEqual(3)

    const usage = await runCliJson<{ totalTokens: number; byGoal: { goal: string }[] }>(
      XOS_ITEMS_HANDLERS['usage summary'],
      repoRoot,
      { project: 'sample-app', days: '7' }
    )
    expect(usage.totalTokens).toBe(12500)
    expect(usage.byGoal[0]?.goal).toBe('seo-blog-post')

    const models = await runCliJson<{ models: { agent: string; id: string }[] }>(
      XOS_ITEMS_HANDLERS['models list'],
      repoRoot,
      { agent: 'claude' }
    )
    expect(models.models.length).toBeGreaterThan(0)
    expect(models.models[0]?.agent).toBe('claude')
  })
})
