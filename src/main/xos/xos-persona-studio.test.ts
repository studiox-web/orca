import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as crontabModule from './xos-crontab'
import type * as goalProcessesModule from './xos-goal-processes'
import {
  applyPersonaMutation,
  countProjectReviews,
  readPersonaStudio,
  resolvePersonaImage
} from './xos-persona-studio'
import { personaMediaDir } from './xos-persona-media'
import { importProjectGoals } from './xos-project-import'

vi.mock('./xos-crontab', async (importOriginal) => {
  const actual = await importOriginal<typeof crontabModule>()
  return {
    ...actual,
    readCrontabText: vi.fn(async () => '')
  }
})

vi.mock('./xos-goal-processes', async (importOriginal) => {
  const actual = await importOriginal<typeof goalProcessesModule>()
  return {
    ...actual,
    runningGoalJobs: vi.fn(async () => [])
  }
})

const { xosHome } = crontabModule

const tempDirs: string[] = []

function makeTempRepo(name = 'cascade-media'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-persona-'))
  tempDirs.push(base)
  const repo = join(base, name)
  mkdirSync(repo, { recursive: true })
  return repo
}

function write(path: string, content: string | Buffer): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function makeGoal(repo: string, goal: string): void {
  write(
    join(repo, 'automations', 'goals', goal, 'GOAL.md'),
    `---\nid: ${goal}\n---\n# Goal: ${goal}\n`
  )
  write(
    join(repo, 'automations', 'goals', goal, 'SOUL.md'),
    `# Soul\n\n## Name\n\nMaya River\n\n## Core\n\nCalm and grounded.\n`
  )
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
  rmSync(join(xosHome(), 'projects'), { recursive: true, force: true })
})

describe('xos-persona-studio', () => {
  it('reads home + legacy galleries with merged review state (EM1/EM2/EM4/EM5)', async () => {
    const repo = makeTempRepo()
    makeGoal(repo, 'photo-journalist')
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'references',
        'originals',
        'ref-01.webp'
      ),
      'ref-bytes'
    )
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'photoshoots',
        'originals',
        'shoot-01.webp'
      ),
      'shoot-1'
    )
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'photoshoots',
        'thumbs',
        'shoot-01.webp'
      ),
      'shoot-1-thumb'
    )
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'photoshoots',
        'originals',
        'shoot-02.webp'
      ),
      'shoot-2'
    )
    write(
      join(
        repo,
        'content',
        'photo-journal',
        'identity-reviews',
        '2026-05-27-lake-pullout-reset.webp'
      ),
      'journal-1'
    )
    write(
      join(repo, 'public', 'videos', 'photo-journal', 'maya-river', 'walk-01.mp4'),
      'video-bytes'
    )
    write(
      join(repo, 'public', 'videos', 'photo-journal', 'maya-river', 'posters', 'walk-01.webp'),
      'poster-bytes'
    )
    write(
      join(repo, 'content', 'photo-journal', 'review-status.json'),
      JSON.stringify({
        employees: {
          'photo-journalist': {
            photoshoots: {
              'shoot-01.webp': {
                status: 'accepted',
                reason: null,
                reviewed_at: '2026-05-28T04:14:41+00:00'
              },
              'shoot-02.webp': {
                status: 'rejected',
                reason: 'face drift',
                reviewed_at: '2026-05-28T04:16:20+00:00'
              }
            }
          }
        }
      })
    )
    write(
      join(repo, 'content', 'photo-journal', 'video-reviews', 'walk-01-review.md'),
      '---\nvideo_review_id: walk-01-review\nstatus: generated\noperator_review_required: true\n---\n# Review\n'
    )
    await importProjectGoals(repo)

    const studio = readPersonaStudio(repo, 'photo-journalist')
    expect(studio).not.toBeNull()
    expect(studio!.references.map((image) => image.filename)).toEqual(['ref-01.webp'])
    expect(studio!.references[0].origin).toBe('legacy')
    expect(studio!.photoshoots).toHaveLength(2)
    expect(
      studio!.photoshoots.find((image) => image.filename === 'shoot-01.webp')?.review.status
    ).toBe('accepted')
    expect(
      studio!.photoshoots.find((image) => image.filename === 'shoot-02.webp')?.review.reason
    ).toBe('face drift')
    expect(studio!.journal.map((image) => image.filename)).toEqual([
      '2026-05-27-lake-pullout-reset.webp'
    ])
    expect(studio!.videos).toHaveLength(1)
    expect(studio!.videos[0].poster).toContain('walk-01.webp')
    expect(studio!.videos[0].review.status).toBe('pending')
    expect(studio!.reviewStats).toEqual({ pending: 3, accepted: 1, rejected: 1 })
    expect(studio!.traits.map((trait) => trait.label)).toEqual(['Name', 'Core'])
    expect(studio!.traits[0].value).toContain('Maya River')
  })

  it('reviews images into the home review file and overrides legacy state', async () => {
    const repo = makeTempRepo()
    makeGoal(repo, 'photo-journalist')
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'photoshoots',
        'originals',
        'shoot-01.webp'
      ),
      'shoot-1'
    )
    write(
      join(repo, 'content', 'photo-journal', 'review-status.json'),
      JSON.stringify({
        employees: {
          'photo-journalist': { photoshoots: { 'shoot-01.webp': { status: 'accepted' } } }
        }
      })
    )
    await importProjectGoals(repo)

    const rejected = await applyPersonaMutation(repo, 'photo-journalist', {
      kind: 'review-image',
      gallery: 'photoshoots',
      filename: 'shoot-01.webp',
      status: 'rejected',
      reason: 'off-model'
    })
    expect(rejected.ok).toBe(true)

    const homeReviewPath = join(personaMediaDir(repo, 'photo-journalist'), 'review-status.json')
    expect(existsSync(homeReviewPath)).toBe(true)
    const stored = JSON.parse(readFileSync(homeReviewPath, 'utf8'))
    expect(stored.photoshoots['shoot-01.webp'].status).toBe('rejected')
    expect(stored.photoshoots['shoot-01.webp'].reason).toBe('off-model')
    expect(stored.photoshoots['shoot-01.webp'].reviewedAt).toMatch(/^\d{4}-/)

    const studio = readPersonaStudio(repo, 'photo-journalist')
    expect(studio!.photoshoots[0].review.status).toBe('rejected')
  })

  it('promotes photoshoot shots to references and refuses legacy removals', async () => {
    const repo = makeTempRepo()
    makeGoal(repo, 'content-writer')
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'content-writer',
        'photoshoots',
        'originals',
        'shoot-01.webp'
      ),
      'shoot-1'
    )
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'content-writer',
        'references',
        'originals',
        'legacy-ref.webp'
      ),
      'legacy'
    )
    await importProjectGoals(repo)

    const added = await applyPersonaMutation(repo, 'content-writer', {
      kind: 'add-reference',
      sourceGallery: 'photoshoots',
      filename: 'shoot-01.webp'
    })
    expect(added.ok).toBe(true)
    expect(
      existsSync(
        join(personaMediaDir(repo, 'content-writer'), 'references', 'originals', 'shoot-01.webp')
      )
    ).toBe(true)

    const removed = await applyPersonaMutation(repo, 'content-writer', {
      kind: 'remove-reference',
      filename: 'legacy-ref.webp'
    })
    expect(removed.ok).toBe(false)
    if (!removed.ok) {
      expect(removed.error).toContain('read-only')
    }

    const studio = readPersonaStudio(repo, 'content-writer')
    expect(studio!.references.map((image) => image.filename).sort()).toEqual([
      'legacy-ref.webp',
      'shoot-01.webp'
    ])
    expect(studio!.references.find((image) => image.filename === 'shoot-01.webp')?.origin).toBe(
      'home'
    )
  })

  it('validates uploads and saves SOUL.md', async () => {
    const repo = makeTempRepo()
    makeGoal(repo, 'content-writer')
    await importProjectGoals(repo)

    const badName = await applyPersonaMutation(repo, 'content-writer', {
      kind: 'upload-reference',
      filename: '../escape.webp',
      dataBase64: 'aGk='
    })
    expect(badName.ok).toBe(false)

    const uploaded = await applyPersonaMutation(repo, 'content-writer', {
      kind: 'upload-reference',
      filename: 'operator-ref.webp',
      dataBase64: Buffer.from('image-bytes').toString('base64')
    })
    expect(uploaded.ok).toBe(true)
    const studio = readPersonaStudio(repo, 'content-writer')
    expect(studio!.references[0].filename).toBe('operator-ref.webp')
    expect(studio!.references[0].review.status).toBe('accepted')

    const soul = await applyPersonaMutation(repo, 'content-writer', {
      kind: 'save-soul',
      soul: '# Writer Soul\n\n## Name\n\nSloane\n'
    })
    expect(soul.ok).toBe(true)
    const reread = readPersonaStudio(repo, 'content-writer')
    expect(reread!.traits[0].value).toBe('Sloane')
  })

  it('resolves gallery images safely and counts reviews per project', async () => {
    const repo = makeTempRepo()
    makeGoal(repo, 'photo-journalist')
    write(
      join(
        repo,
        'public',
        'images',
        'employee-media',
        'photo-journalist',
        'photoshoots',
        'originals',
        'shoot-01.webp'
      ),
      'shoot-1'
    )
    await importProjectGoals(repo)

    expect(resolvePersonaImage(repo, 'photo-journalist', 'photoshoots', 'shoot-01.webp')).toContain(
      'shoot-01.webp'
    )
    expect(
      resolvePersonaImage(repo, 'photo-journalist', 'photoshoots', '../secret.webp')
    ).toBeNull()
    expect(countProjectReviews(repo, ['photo-journalist'])).toEqual({
      pending: 1,
      accepted: 0,
      rejected: 0
    })
    expect(countProjectReviews(repo, ['missing-goal'])).toEqual({
      pending: 0,
      accepted: 0,
      rejected: 0
    })
  })
})
