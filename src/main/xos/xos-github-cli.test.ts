import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseGhIssues, syncGitHubForProject } from './xos-github-cli'
import { projectItemsDir } from './xos-project-home'

let base: string
let repo: string

const ISSUES = JSON.stringify([
  {
    number: 12,
    title: 'Crash when saving a post',
    body: 'Steps to reproduce: click save. Expected: saved. Actual: crash.',
    url: 'https://example.test/12',
    author: { login: 'visitor' },
    labels: [{ name: 'bug' }],
    createdAt: '2026-11-01T00:00:00Z'
  }
])

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-gh-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
  repo = join(base, 'site')
  mkdirSync(repo)
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('syncGitHubForProject (H1, PL4)', () => {
  it('maps the gh JSON shape', () => {
    expect(parseGhIssues(ISSUES)[0]).toMatchObject({ author: 'visitor', labels: ['bug'] })
  })

  it('files issues as local items and closes nothing without --close', async () => {
    const gh = vi.fn(async () => ISSUES)
    const first = await syncGitHubForProject({ repoRoot: repo, gh })
    expect(first.synced).toHaveLength(1)
    expect(first.dryRun).toBe(true)
    expect(gh).toHaveBeenCalledTimes(1)
    const again = await syncGitHubForProject({ repoRoot: repo, gh })
    expect(again.synced).toHaveLength(0)
    expect(again.skippedExisting).toEqual([12])
  })

  it('closes a completed issue only when asked', async () => {
    const done = join(projectItemsDir(repo), 'feature', 'completed')
    mkdirSync(done, { recursive: true })
    writeFileSync(join(done, 'a.md'), '---\nsource: github#12\ngithub_issue: 12\n---\nDone\n')
    const gh = vi.fn(async () => ISSUES)
    const dry = await syncGitHubForProject({ repoRoot: repo, gh })
    expect(dry.closed.map((row) => row.issueNumber)).toEqual([12])
    expect(gh).toHaveBeenCalledTimes(1)
    await syncGitHubForProject({ repoRoot: repo, gh, close: true })
    expect(gh).toHaveBeenCalledWith(repo, expect.arrayContaining(['issue', 'close', '12']))
  })
})
