import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { xosHome } from './xos-crontab'
import {
  assembleGoalPrompt,
  expandSharedIncludes,
  resolveAllowedGoalAgent
} from './xos-goal-prompt'

const tempDirs: string[] = []

function makeTempRepo(name = 'prompt-repo'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-prompt-'))
  tempDirs.push(base)
  const repo = join(base, name)
  mkdirSync(repo, { recursive: true })
  return repo
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
  rmSync(join(xosHome(), 'projects'), { recursive: true, force: true })
})

describe('xos-goal-prompt (RT2, RT3, RT9, RT10, RT12, RT14, RT17)', () => {
  it('expands @shared/... includes recursively and rejects cycles and path traversal', () => {
    const repo = makeTempRepo()
    const sharedDir = join(repo, 'automations', 'shared')
    mkdirSync(sharedDir, { recursive: true })
    writeFileSync(join(sharedDir, 'base.md'), 'Base rule 1\n@shared/nested.md')
    writeFileSync(join(sharedDir, 'nested.md'), 'Nested rule 2')
    writeFileSync(join(sharedDir, 'cycle-a.md'), '@shared/cycle-b.md')
    writeFileSync(join(sharedDir, 'cycle-b.md'), '@shared/cycle-a.md')

    const expanded = expandSharedIncludes('# Header\n  @shared/base.md\n# Footer', repo)
    expect(expanded).toContain('<!-- begin include: @shared/base.md -->')
    expect(expanded).toContain('Base rule 1')
    expect(expanded).toContain('<!-- begin include: @shared/nested.md -->')
    expect(expanded).toContain('Nested rule 2')

    expect(() => expandSharedIncludes('@shared/cycle-a.md', repo)).toThrow(/Include cycle detected/)
    expect(() => expandSharedIncludes('@shared/../../etc/passwd', repo)).toThrow(
      /Invalid @shared include path/
    )
  })

  it('enforces allowed agents from GOAL.md frontmatter (RT2)', () => {
    expect(resolveAllowedGoalAgent('claude', { agents: ['codex'] })).toBe('codex')
    expect(resolveAllowedGoalAgent('claude', { agents: ['codex', 'claude'] })).toBe('claude')
    expect(resolveAllowedGoalAgent(undefined, { agents: ['claude'] })).toBe('claude')
  })

  it('stops on Definition of Done met when no reopen work exists, and reopens when input queue has work (RT14)', () => {
    const repo = makeTempRepo()
    const goalDir = join(repo, 'automations', 'goals', 'fix-qa-bugs')
    mkdirSync(join(goalDir, 'log'), { recursive: true })
    mkdirSync(join(goalDir, 'inbox'), { recursive: true })
    mkdirSync(join(repo, 'docs', 'bugs', 'incoming'), { recursive: true })
    writeFileSync(
      join(goalDir, 'GOAL.md'),
      '---\nid: fix-qa-bugs\nagents: [codex]\nlock_lane: repo-mutating\n---\n# Goal: Fix QA Bugs\n'
    )
    writeFileSync(
      join(goalDir, 'STATUS.md'),
      '# Status\n\nDefinition of Done met\n- result: complete\n'
    )

    const skipped = assembleGoalPrompt({ repoRoot: repo, goal: 'fix-qa-bugs' })
    expect(skipped.status).toBe('skipped_dod')

    writeFileSync(
      join(repo, 'docs', 'bugs', 'incoming', '2026-04-03-new-bug.md'),
      '---\ntitle: Regression on checkout\n---\n# Bug\n'
    )
    const reopened = assembleGoalPrompt({ repoRoot: repo, goal: 'fix-qa-bugs' })
    expect(reopened.status).toBe('ready')
    if (reopened.status === 'ready') {
      expect(reopened.reopenedFromDod).toBe(true)
      expect(reopened.prompt).not.toMatch(/^Definition of Done met$/m)
      expect(reopened.prompt).toContain('Runner reopen note: new input queue items exist')
      expect(reopened.prompt).toContain('## Queue Snapshot (RT17)')
      expect(reopened.prompt).toContain('2026-04-03-new-bug.md')
    }
  })

  it('supports reply mode (RT9), sidecars (RT10), and operator messages (RT12)', () => {
    const repo = makeTempRepo()
    const goalDir = join(repo, 'automations', 'goals', 'cto')
    mkdirSync(join(goalDir, 'log'), { recursive: true })
    mkdirSync(join(goalDir, 'inbox'), { recursive: true })
    mkdirSync(join(goalDir, 'sidecars'), { recursive: true })
    mkdirSync(join(repo, 'automations', 'shared'), { recursive: true })
    writeFileSync(join(repo, 'automations', 'AGENTS.md'), 'Global operating principles.')
    writeFileSync(join(repo, 'automations', 'shared', 'audit.md'), 'Shared audit checklist.')
    writeFileSync(
      join(goalDir, 'GOAL.md'),
      '---\nid: cto\nagents: [claude]\nmodel: claude-opus-4-6\nmodel_reasoning_effort: high\n---\n# Goal: CTO\n'
    )
    writeFileSync(join(goalDir, 'STATUS.md'), '# Status\n- health: green\n')
    writeFileSync(join(goalDir, 'MEMORY.md'), '# Memory\nKey decision 1.\n')
    writeFileSync(join(goalDir, 'SOUL.md'), 'Calm, rigorous engineering leader.')
    writeFileSync(
      join(goalDir, 'sidecars', 'weekly-review.md'),
      '# Weekly Review\n@shared/audit.md\n'
    )

    // Reply mode with empty inbox skips precheck.
    const emptyReply = assembleGoalPrompt({ repoRoot: repo, goal: 'cto', mode: 'reply' })
    expect(emptyReply.status).toBe('skipped_precheck')

    // Add an open message from ceo.
    const msgPath = join(goalDir, 'inbox', '2026-04-03__from-ceo__to-cto.md')
    writeFileSync(
      msgPath,
      '---\nfrom: ceo\nto: cto\nstatus: open\n---\nWhat is our deployment risk?\n'
    )

    const replyReady = assembleGoalPrompt({
      repoRoot: repo,
      goal: 'cto',
      mode: 'reply',
      nowMs: Date.parse('2026-04-03T18:00:00Z')
    })
    expect(replyReady.status).toBe('ready')
    if (replyReady.status === 'ready') {
      expect(replyReady.model).toBe('gpt-5.4-mini')
      expect(replyReady.effort).toBe('low')
      expect(replyReady.lockLane).toBe('dm')
      expect(replyReady.disableFallback).toBe(true)
      expect(replyReady.disableAutoCommit).toBe(true)
      expect(replyReady.prompt).toContain('Inbox-only response run')
      expect(replyReady.prompt).not.toContain('Global operating principles.')
    }
    const updatedInbox = readFileSync(msgPath, 'utf8')
    expect(updatedInbox).toContain('read_by: cto')
    expect(updatedInbox).toContain('read_at: 2026-04-03T18:00:00.000Z')

    // Sidecar mode with operator message.
    const sidecarReady = assembleGoalPrompt({
      repoRoot: repo,
      goal: 'cto',
      mode: 'sidecar',
      sidecar: 'weekly-review',
      operatorMessage: 'Focus on database latency today.'
    })
    expect(sidecarReady.status).toBe('ready')
    if (sidecarReady.status === 'ready') {
      expect(sidecarReady.prompt).toContain('## Sidecar Contract (sidecars/weekly-review.md)')
      expect(sidecarReady.prompt).toContain('Shared audit checklist.')
      expect(sidecarReady.prompt).toContain('Calm, rigorous engineering leader.')
      expect(sidecarReady.prompt).toContain('Focus on database latency today.')
    }
  })
})
