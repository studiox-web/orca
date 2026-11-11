import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  archiveGoalFolder,
  createGoalFolder,
  deleteArchivedFolder,
  listArchivedGoals,
  restoreGoalFolder
} from './xos-goal-lifecycle'
import { loadOrg } from './xos-goal-org'
import { removeArea, setGoalArea, upsertArea } from './xos-goal-org-edit'

const TEMPLATE = [
  '# Template',
  '',
  '## GOAL.md Template',
  '',
  '```markdown',
  '---',
  'id: goal-slug',
  'type: goal',
  'agents: [codex]',
  '---',
  '',
  '# Goal: Title',
  '',
  '## Definition of Done',
  '```',
  ''
].join('\n')

describe('goal lifecycle and org edits', () => {
  let dir: string
  let root: string
  let goalsDir: string
  let savedHome: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xos-goal-life-'))
    root = join(dir, 'dj')
    goalsDir = join(root, 'automations', 'goals')
    mkdirSync(join(root, 'automations', '_template'), { recursive: true })
    mkdirSync(goalsDir, { recursive: true })
    writeFileSync(join(root, 'automations', '_template', 'goal.md'), TEMPLATE)
    savedHome = process.env.ORCA_XOS_HOME
    process.env.ORCA_XOS_HOME = join(dir, 'home')
  })

  afterEach(() => {
    if (savedHome === undefined) {
      delete process.env.ORCA_XOS_HOME
    } else {
      process.env.ORCA_XOS_HOME = savedHome
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a goal from the project template, then archives, restores and deletes it', () => {
    const goalPath = createGoalFolder({
      root,
      goalsDir,
      goal: 'festival-curator',
      title: 'Festival Curator',
      agent: 'claude'
    })
    const contract = readFileSync(goalPath, 'utf8')
    expect(contract).toContain('id: festival-curator')
    expect(contract).toContain('agents: [claude]')
    expect(contract).toContain('# Goal: Festival Curator')
    expect(existsSync(join(goalsDir, 'festival-curator', 'STATUS.md'))).toBe(true)
    expect(() =>
      createGoalFolder({ root, goalsDir, goal: 'festival-curator', title: '', agent: 'codex' })
    ).toThrow(/already exists/)
    expect(() =>
      createGoalFolder({ root, goalsDir, goal: '../escape', title: '', agent: 'codex' })
    ).toThrow(/lowercase/)

    archiveGoalFolder(goalsDir, 'festival-curator')
    expect(existsSync(join(goalsDir, 'festival-curator'))).toBe(false)
    expect(listArchivedGoals(goalsDir).map((entry) => entry.title)).toEqual(['Festival Curator'])

    expect(restoreGoalFolder(goalsDir, 'festival-curator')).toBe('festival-curator')
    archiveGoalFolder(goalsDir, 'festival-curator')
    expect(() => deleteArchivedFolder(goalsDir, '..')).toThrow()
    deleteArchivedFolder(goalsDir, 'festival-curator')
    expect(listArchivedGoals(goalsDir)).toEqual([])
  })

  it('writes org.json on first edit and moves goals between areas', () => {
    expect(loadOrg('dj').source).toBe('default')
    upsertArea(
      'dj',
      { id: 'festivals', title: 'Festivals', description: 'Curation', manager: 'curator' },
      new Set(['curator', 'content-writer'])
    )
    expect(() =>
      upsertArea(
        'dj',
        { id: 'x', title: 'X', description: '', manager: 'nobody' },
        new Set(['curator'])
      )
    ).toThrow(/not a goal/)
    setGoalArea('dj', 'content-writer', 'festivals')
    const org = loadOrg('dj')
    expect(org.source).toBe('org.json')
    expect(org.areas.find((area) => area.id === 'festivals')?.goals).toEqual([
      'curator',
      'content-writer'
    ])
    expect(org.areas.find((area) => area.id === 'marketing-growth')?.goals).not.toContain(
      'content-writer'
    )
    removeArea('dj', 'festivals')
    expect(loadOrg('dj').areas.some((area) => area.id === 'festivals')).toBe(false)
  })
})
