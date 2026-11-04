import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { goalQueues, queueTone, readItemSummary, scanProjectQueues } from './xos-work-items'

let root: string

function write(rel: string, text: string): void {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xos-items-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('scanProjectQueues', () => {
  it('lists only item types whose folders exist and skips README and dotfiles', () => {
    write(
      'docs/features/planned/a.md',
      '---\nbuilder:\n  ready: true\n  priority: high\n---\n# A\n'
    )
    write('docs/features/planned/b.md', '---\nbuilder:\n  ready: false\n---\n# B\n')
    write('docs/features/planned/README.md', '# readme')
    write('docs/features/planned/.gitkeep', '')
    write('docs/features/completed/c.md', '# C')
    const scan = scanProjectQueues(root, { activeOnly: false })
    expect(scan.map((entry) => entry.type.id)).toEqual(['feature'])
    const planned = scan[0].stages.find((stage) => stage.stage.id === 'planned')!
    expect(planned.files).toHaveLength(2)
    expect(planned.readyCount).toBe(1)
    const active = scanProjectQueues(root, { activeOnly: true })
    expect(active[0].stages.map((stage) => stage.stage.id)).toEqual(['planned'])
  })

  it('tags items in merged stages with their bucket', () => {
    write('automations/goals/feature-dreamer/inbox/too-big/x.md', '# X')
    write('automations/goals/feature-dreamer/inbox/pitch.md', '# P')
    const scan = scanProjectQueues(root, { activeOnly: false })
    const stages = scan[0].stages
    const rejected = stages.find((stage) => stage.stage.id === 'rejected')!
    expect(rejected.files.map((file) => file.bucket)).toEqual(['too-big'])
    const pitches = stages.find((stage) => stage.stage.id === 'pitch')!
    expect(pitches.files).toHaveLength(1)
    expect(pitches.files[0].bucket).toBeNull()
  })
})

describe('goalQueues', () => {
  it('wires a goal to the stages it reads and writes, with floor/ceiling tones', () => {
    for (let index = 0; index < 3; index += 1) {
      write(`docs/features/planned/${index}.md`, '---\nbuilder:\n  ready: true\n---\n')
    }
    const scan = scanProjectQueues(root, { activeOnly: true })
    const groomer = goalQueues(scan, 'feature-backlog-groomer')
    expect(groomer.out.map((ref) => [ref.stageId, ref.readyCount, ref.tone])).toEqual([
      ['planned', 3, 'starved']
    ])
    const builder = goalQueues(scan, 'implement-planned-feature-backlog')
    expect(builder.in.map((ref) => ref.stageId)).toEqual(['planned'])
    expect(goalQueues(scan, 'someone-else')).toEqual({ in: [], out: [] })
  })

  it('computes tones', () => {
    expect(queueTone(0)).toBe('idle')
    expect(queueTone(2)).toBe('ok')
    expect(queueTone(8, 5, 8)).toBe('backed-up')
    expect(queueTone(4, 5, 8)).toBe('starved')
  })
})

describe('readItemSummary', () => {
  it('takes the title from frontmatter, then the first heading, then the file name', () => {
    write('content/drafts/2026-11-01-one.md', '---\ntitle: Titled\nstatus: draft\n---\nbody')
    write(
      'content/drafts/2026-11-02-two.md',
      '---\nreview_status: editor_approved\n---\n# Heading two\n'
    )
    write('content/drafts/2026-11-03-three-words.md', 'plain body')
    const scan = scanProjectQueues(root, { activeOnly: false })
    const drafts = scan[0].stages.find((stage) => stage.stage.id === 'draft')!
    const items = drafts.files.map((file) => readItemSummary(file, 'content', drafts.stage))
    const byTitle = Object.fromEntries(items.map((item) => [item.title, item]))
    expect(Object.keys(byTitle).sort()).toEqual(['Heading two', 'Titled', 'three words'])
    expect(byTitle.Titled.chips).toEqual([{ key: 'status', value: 'draft' }])
    expect(byTitle['Heading two'].created).toBe('2026-11-02')
    expect(byTitle['three words'].ready).toBeNull()
  })
})

describe('moveWorkItem guards (M14)', () => {
  it('refuses a claimed item and a name already in the target stage', async () => {
    const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { moveWorkItem } = await import('./xos-work-items-crud')
    const repo = mkdtempSync(join(tmpdir(), 'xos-move-'))
    process.env.ORCA_XOS_HOME = join(repo, '.home')
    try {
      const planned = join(repo, 'docs', 'features', 'planned')
      const done = join(repo, 'docs', 'features', 'completed')
      mkdirSync(planned, { recursive: true })
      mkdirSync(done, { recursive: true })
      const item = join(planned, 'spec.md')
      const claimed = `---\ntitle: S\nclaimed_by: run-1\nclaimed_at: ${new Date().toISOString()}\n---\n`
      writeFileSync(item, claimed)
      const move = (force?: boolean) =>
        moveWorkItem({ roots: [repo], pathOrQuery: item, toStageId: 'completed', force })
      expect(move()).toMatchObject({ ok: false, error: expect.stringContaining('run-1') })

      writeFileSync(join(done, 'spec.md'), 'the finished one\n')
      expect(move(true)).toMatchObject({ ok: false, error: expect.stringContaining('already has') })
      expect(readFileSync(join(done, 'spec.md'), 'utf8')).toBe('the finished one\n')

      rmSync(join(done, 'spec.md'))
      expect(move(true).ok).toBe(true)
    } finally {
      delete process.env.ORCA_XOS_HOME
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
