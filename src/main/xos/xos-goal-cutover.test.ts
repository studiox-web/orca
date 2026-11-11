// XOS fork: per-goal cutover (H5), project-home identity (L6, L7) and takeover sessions (M6).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitProjectHome,
  hasFullImport,
  isGoalCentral,
  listProjectGoals,
  projectHomeDir,
  resolveGoalDir,
  resolveProjectGoalsDir
} from './xos-project-home'
import { orgFilePath } from './xos-goal-org'
import { importProjectGoals } from './xos-project-import'
import { isLockFree, laneLockFile } from './xos-lane-lock'
import { isItemClaimActive } from './xos-item-claims'
import { parseFrontmatter } from './xos-goal-files'
import { releaseTakeoverSession, startTakeoverSession } from './xos-takeover-session'
import { activeTakeover, listRunJournal } from './xos-run-journal'
import { removeTempDir } from './xos-temp-dir.test-fixture'

let base: string

function repoWith(name: string, goals: string[]): string {
  const repo = join(base, name)
  for (const goal of goals) {
    const dir = join(repo, 'automations', 'goals', goal)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'GOAL.md'), `---\ntitle: ${goal}\nlock_lane: content\n---\n# ${goal}\n`)
    writeFileSync(join(dir, 'STATUS.md'), 'repo status\n')
  }
  return repo
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-cutover-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
})

afterEach(async () => {
  delete process.env.ORCA_XOS_HOME
  await removeTempDir(base)
})

describe('per-goal cutover (H5)', () => {
  it('moves one goal and leaves the rest running from the repo', async () => {
    const repo = repoWith('site', ['writer', 'editor'])
    await importProjectGoals(repo, { goals: ['writer'] })
    expect(isGoalCentral(repo, 'writer')).toBe(true)
    expect(resolveGoalDir(repo, 'writer')).toContain(join('home', 'projects', 'site'))
    expect(resolveGoalDir(repo, 'editor')).toBe(join(repo, 'automations', 'goals', 'editor'))
    expect(listProjectGoals(repo)).toEqual(['editor', 'writer'])
    expect(hasFullImport(repo)).toBe(false)
    expect(resolveProjectGoalsDir(repo)).toBe(join(repo, 'automations', 'goals'))
  })

  it('never overwrites newer central state on re-import unless forced', async () => {
    const repo = repoWith('site', ['writer'])
    await importProjectGoals(repo)
    const status = join(resolveGoalDir(repo, 'writer'), 'STATUS.md')
    writeFileSync(status, 'newer central status\n')

    const again = await importProjectGoals(repo)
    expect(again.skippedExisting).toEqual(['writer'])
    expect(readFileSync(status, 'utf8')).toBe('newer central status\n')

    await importProjectGoals(repo, { force: true })
    expect(readFileSync(status, 'utf8')).toBe('repo status\n')
  })

  it('a later whole-project import upgrades a partial one', async () => {
    const repo = repoWith('site', ['writer', 'editor'])
    await importProjectGoals(repo, { goals: ['writer'] })
    await importProjectGoals(repo)
    expect(hasFullImport(repo)).toBe(true)
    expect(isGoalCentral(repo, 'editor')).toBe(true)
  })
})

describe('project home identity', () => {
  it('gives a second repo with the same folder name its own home (L7)', async () => {
    const first = repoWith(join('a', 'site'), ['writer'])
    const second = repoWith(join('b', 'site'), ['writer'])
    await importProjectGoals(first)
    expect(projectHomeDir(second)).not.toBe(projectHomeDir(first))
    expect(orgFilePath(second)).not.toBe(orgFilePath(first))
    await importProjectGoals(second)
    expect(projectHomeDir(first)).toMatch(/site$/)
    expect(readFileSync(join(projectHomeDir(second), 'project.json'), 'utf8')).toContain(second)
  })

  it('serializes concurrent commits instead of losing them to index.lock (L6)', async () => {
    const repo = repoWith('site', ['writer'])
    await importProjectGoals(repo)
    const home = projectHomeDir(repo)
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => {
        writeFileSync(join(home, `note-${index}.txt`), 'x')
        return commitProjectHome(repo, `note ${index}`)
      })
    )
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: home, encoding: 'utf8' })).toBe('')
  })

  // Real git, through the whole retry backoff.
  it('retries past a lock held by another process and reports a lasting failure (L6)', async () => {
    const repo = repoWith('site', ['writer'])
    await importProjectGoals(repo)
    const home = projectHomeDir(repo)
    const lock = join(home, '.git', 'index.lock')
    writeFileSync(lock, '')
    writeFileSync(join(home, 'note.txt'), 'x')
    const pending = commitProjectHome(repo, 'blocked for a moment')
    rmSync(lock)
    expect(await pending).not.toBeNull()

    writeFileSync(lock, '')
    writeFileSync(join(home, 'note-2.txt'), 'x')
    expect(await commitProjectHome(repo, 'stays blocked')).toBeNull()
    expect(readFileSync(join(base, 'home', 'audit.jsonl'), 'utf8')).toContain(
      'project.commit_failed'
    )
    rmSync(lock)
  }, 10_000)
})

describe('takeover sessions (M6)', () => {
  function itemIn(repo: string): string {
    const dir = join(repo, 'docs', 'features', 'planned')
    mkdirSync(dir, { recursive: true })
    const item = join(dir, 'spec.md')
    writeFileSync(item, '---\ntitle: Spec\n---\nBody\n')
    return item
  }

  it('holds the lane and keeps the claim fresh until released', async () => {
    const repo = repoWith('site', ['writer'])
    const item = itemIn(repo)
    const nowMs = Date.parse('2026-11-04T12:00:00.000Z')
    const session = await startTakeoverSession({
      repoRoot: repo,
      goal: 'writer',
      agent: 'claude',
      itemPath: item,
      nowMs
    })
    expect(session.ok).toBe(true)
    const lane = laneLockFile(repo, 'content')
    expect(await isLockFree(lane)).toBe(false)
    const fm = parseFrontmatter(readFileSync(item, 'utf8'))
    expect(isItemClaimActive(fm, nowMs + 2 * 60 * 60_000)).toBe(true)

    const second = await startTakeoverSession({
      repoRoot: repo,
      goal: 'writer',
      agent: 'codex',
      itemPath: null
    })
    expect(second.ok).toBe(false)

    expect(
      releaseTakeoverSession({ repoRoot: repo, goal: 'writer', note: 'left off at step 3' }).ok
    ).toBe(true)
    await vi.waitFor(async () => expect(await isLockFree(lane)).toBe(true), {
      timeout: 3000,
      interval: 50
    })
    expect(activeTakeover(repo, 'writer')).toBeNull()
    expect(listRunJournal()).toEqual([])
    expect(readFileSync(item, 'utf8')).not.toContain('claimed_by')
    expect(readFileSync(join(resolveGoalDir(repo, 'writer'), 'STATUS.md'), 'utf8')).toContain(
      'left off at step 3'
    )
  })

  it('refuses a takeover while the lane is busy, and releasing nothing is an error', async () => {
    const repo = repoWith('site', ['writer', 'editor'])
    const first = await startTakeoverSession({
      repoRoot: repo,
      goal: 'writer',
      agent: 'claude',
      itemPath: null
    })
    expect(first.ok).toBe(true)
    const blocked = await startTakeoverSession({
      repoRoot: repo,
      goal: 'editor',
      agent: 'claude',
      itemPath: null
    })
    expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining('busy') })
    expect(releaseTakeoverSession({ repoRoot: repo, goal: 'editor' }).ok).toBe(false)
    releaseTakeoverSession({ repoRoot: repo, goal: 'writer' })
    expect(existsSync(join(base, 'home', 'run-state'))).toBe(true)
  })
})
