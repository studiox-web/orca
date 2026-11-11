import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyGitHubIssue,
  closeCompletedGitHubIssues,
  extractLinkedGitHubIssueNumbers,
  syncGitHubIssuesIntake
} from './xos-github-intake'
import { projectItemsDir } from './xos-project-home'

const tempDirs: string[] = []

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xos-gh-intake-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('xos-github-intake', () => {
  it('classifies feature requests, bugs, feedback, support, invalid, and force overrides', () => {
    const feature = classifyGitHubIssue({
      number: 101,
      title: 'Feature request: please add dark mode export option',
      body: 'Would be nice to allow users to export data in dark theme.',
      author: 'alice'
    })
    expect(feature.kind).toBe('feature')
    expect(feature.route).toEqual({ typeId: 'feature', stageId: 'pitch' })
    expect(feature.labels).toContain('type:feature')
    expect(feature.areas).toContain('data')

    const bug = classifyGitHubIssue({
      number: 102,
      title: 'App crash on startup after CloudKit sync fails',
      body: 'Steps to reproduce: open app, crash happens with data loss.',
      author: 'bob'
    })
    expect(bug.kind).toBe('bug')
    expect(bug.priority).toBe('high')
    expect(bug.route).toEqual({ typeId: 'bug', stageId: 'incoming' })
    expect(bug.areas).toContain('sync')

    const feedback = classifyGitHubIssue({
      number: 103,
      title: 'The onboarding workflow feels confusing and awkward',
      body: 'Hard to tell which button to press on the setup screen.',
      author: 'carol'
    })
    expect(feedback.kind).toBe('feedback')
    expect(feedback.route).toEqual({ typeId: 'feedback', stageId: 'incoming' })

    const invalid = classifyGitHubIssue({
      number: 104,
      title: 'Test issue please ignore this',
      body: 'Created by mistake',
      author: 'dave'
    })
    expect(invalid.kind).toBe('invalid')
    expect(invalid.route).toBeNull()

    const forced = classifyGitHubIssue({
      number: 105,
      title: 'How do I find settings?',
      body: 'Question about settings',
      labels: ['force:feature']
    })
    expect(forced.kind).toBe('feature')
    expect(forced.reasons[0]).toBe('override:feature')
  })

  it('routes internal author quick-fix issues to bug/incoming', () => {
    const quickFix = classifyGitHubIssue(
      {
        number: 106,
        title: 'Header text is truncated and misaligned on modal',
        body: 'The label is cut off on smaller screens.',
        author: 'founder'
      },
      { internalUsers: ['founder'] }
    )
    expect(quickFix.sourceKind).toBe('internal')
    expect(quickFix.kind).toBe('bug')
    expect(quickFix.route).toEqual({ typeId: 'bug', stageId: 'incoming' })
  })

  it('syncs external GitHub issues into project-home items with source: github#<number> and deduplicates', () => {
    const repoRoot = makeTempRepo()
    const issues = [
      {
        number: 42,
        title: 'Feature request: support for CSV export',
        body: 'Please add CSV export for weekly logs.',
        url: 'https://github.com/acme/app/issues/42',
        author: 'ext-user',
        createdAt: '2026-04-10T12:00:00Z'
      },
      {
        number: 43,
        title: 'Crash when tapping notification reminder',
        body: 'App crashes with exception when opening reminder alert.',
        url: 'https://github.com/acme/app/issues/43',
        author: 'ext-user-2',
        createdAt: '2026-04-11T12:00:00Z'
      },
      {
        number: 44,
        title: 'test issue ignore this',
        body: 'spam test issue',
        createdAt: '2026-04-11T12:00:00Z'
      }
    ]

    const first = syncGitHubIssuesIntake({
      repoRoot,
      issues,
      nowIso: '2026-04-12T00:00:00Z'
    })
    expect(first.synced).toHaveLength(2)
    expect(first.skippedInvalid).toEqual([44])
    expect(first.skippedExisting).toEqual([])

    const featureItem = first.synced.find((s) => s.issueNumber === 42)
    expect(featureItem?.typeId).toBe('feature')
    expect(featureItem?.stageId).toBe('pitch')
    const raw = readFileSync(featureItem!.path, 'utf8')
    expect(raw).toContain('source: github#42')
    expect(raw).toContain('github_issue_number: 42')
    expect(extractLinkedGitHubIssueNumbers(raw)).toEqual([42])

    const second = syncGitHubIssuesIntake({
      repoRoot,
      issues,
      nowIso: '2026-04-12T01:00:00Z'
    })
    expect(second.synced).toHaveLength(0)
    expect(second.skippedExisting).toEqual([42, 43])
  })

  it('closes linked GitHub issues when their item reaches completed/ or fixed/', () => {
    const repoRoot = makeTempRepo()
    const completedDir = join(projectItemsDir(repoRoot), 'feature', 'completed')
    mkdirSync(completedDir, { recursive: true })
    const itemPath = join(completedDir, '2026-04-10-gh-42-csv-export.md')
    writeFileSync(
      itemPath,
      [
        '---',
        'title: "CSV Export"',
        'source: github#42',
        'github_issue_number: 42',
        'status: completed',
        '---',
        '',
        '# CSV Export',
        '- GitHub Issue: #42',
        ''
      ].join('\n'),
      'utf8'
    )

    const closedCalls: { issueNumber: number; itemPath: string }[] = []
    const res = closeCompletedGitHubIssues({
      repoRoot,
      openIssueNumbers: new Set([42]),
      nowIso: '2026-04-15T10:00:00Z',
      closeIssue: (issueNumber, path) => closedCalls.push({ issueNumber, itemPath: path })
    })
    expect(res.closed).toHaveLength(1)
    expect(res.closed[0].issueNumber).toBe(42)
    expect(closedCalls).toEqual([{ issueNumber: 42, itemPath }])
    expect(readFileSync(itemPath, 'utf8')).toContain('github_closed_at: 2026-04-15T10:00:00Z')

    const repeat = closeCompletedGitHubIssues({
      repoRoot,
      openIssueNumbers: new Set([42]),
      closeIssue: (issueNumber, path) => closedCalls.push({ issueNumber, itemPath: path })
    })
    expect(repeat.closed).toHaveLength(0)
    expect(closedCalls).toHaveLength(1)
  })
})
