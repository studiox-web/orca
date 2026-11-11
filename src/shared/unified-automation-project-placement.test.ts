import { describe, expect, it } from 'vitest'
import type { XosGoalBoard, XosProject } from './xos-goals-types'
import { exactUnifiedBoardProject } from './unified-automation-project-placement'

function project(key: string, name: string): XosProject {
  return {
    key,
    name,
    root: key,
    goalsDir: `${key}/goals`,
    worktreeSelector: null,
    orgSource: 'default',
    areas: [],
    goals: [],
    archived: [],
    scripts: []
  }
}

function board(projects: XosProject[]): XosGoalBoard {
  return {
    generatedAt: '2026-11-08T00:00:00.000Z',
    crontabHash: 'revision',
    projects,
    otherJobs: [],
    warnings: []
  }
}

describe('exactUnifiedBoardProject', () => {
  it('matches only exact normalized roots', () => {
    const repo = project('/projects/repo/', 'Repo')
    const snapshot = board([repo])

    expect(exactUnifiedBoardProject(snapshot, ['/projects/repo'])).toBe(repo)
    expect(exactUnifiedBoardProject(snapshot, ['/projects/repo/child'])).toBeNull()
  })

  it('uses Windows path comparison rules without folding POSIX case', () => {
    const windows = project('C:\\Repos\\Orca', 'Windows Orca')
    const posix = project('/Projects/Orca', 'POSIX Orca')
    const snapshot = board([windows, posix])

    expect(exactUnifiedBoardProject(snapshot, ['c:/repos/orca'])).toBe(windows)
    expect(exactUnifiedBoardProject(snapshot, ['/projects/orca'])).toBeNull()
  })

  it('fails closed when multiple project records claim the same exact root', () => {
    const snapshot = board([project('/repo', 'First'), project('/repo', 'Second')])

    expect(exactUnifiedBoardProject(snapshot, ['/repo'])).toBeNull()
  })
})
