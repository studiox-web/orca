// XOS fork: Personas & Media Studio (stage F, EM1-EM6). Assembles one goal's studio view: SOUL.md
// voice traits, reference/photoshoot/journal galleries, video gallery, and applies the review
// workflow (accept/reject with reason + timestamp), reference upload/promote/remove and SOUL saves.
// All writes stay inside the goal's project-home media dir, are audited and auto-committed.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type {
  XosActionResult,
  XosMediaImage,
  XosPersonaMutation,
  XosPersonaStudio,
  XosReviewPending
} from '../../shared/xos-persona-types'
import { readHead, safeReaddir, squish } from './xos-goal-files'
import {
  GALLERY_LIMIT,
  IMAGE_RE,
  legacyEmployeeMediaDir,
  legacyPhotoJournalDir,
  legacyReviews,
  mergeReviews,
  homeReviews,
  personaMediaDir,
  scanImageGallery,
  scanLegacyJournal,
  scanVideos
} from './xos-persona-media'
import { commitProjectHome, resolveProjectGoalsDir } from './xos-project-home'
import { audit } from './xos-crontab'

const SOUL_MAX_BYTES = 64 * 1024
const UPLOAD_MAX_BYTES = 12 * 1024 * 1024
const VARIANTS = ['originals', 'gallery', 'thumbs'] as const

function soulTraits(soul: string | null): XosPersonaStudio['traits'] {
  if (!soul) {
    return []
  }
  const traits: XosPersonaStudio['traits'] = []
  for (const section of soul.split(/^##\s+/m).slice(1)) {
    const [heading, ...body] = section.split('\n')
    const value = squish(body.join(' '), 300)
    if (heading && value) {
      traits.push({
        key: heading.trim().toLowerCase().replace(/\s+/g, '-'),
        label: heading.trim(),
        value
      })
    }
  }
  return traits
}

/** Full studio view for one goal (EM1-EM5 read model). */
export function readPersonaStudio(repoRoot: string, goal: string): XosPersonaStudio | null {
  const goalsDir = resolveProjectGoalsDir(repoRoot)
  const goalDir = join(goalsDir, goal)
  if (!existsSync(join(goalDir, 'GOAL.md'))) {
    return null
  }
  const mediaDir = personaMediaDir(repoRoot, goal)
  const home = homeReviews(mediaDir)
  const legacy = legacyReviews(repoRoot, goal)
  const soulPath = join(goalDir, 'SOUL.md')
  const soul = readHead(soulPath, SOUL_MAX_BYTES)
  const sidecars = safeReaddir(join(goalDir, 'sidecars'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort()
  const legacyMedia = legacyEmployeeMediaDir(repoRoot, goal)
  const isJournalist = goal === 'photo-journalist'
  const attach = (images: XosMediaImage[], gallery: string): XosMediaImage[] => {
    const reviews = mergeReviews(home, legacy, gallery)
    return images.slice(0, GALLERY_LIMIT).map((image) => ({
      ...image,
      review: reviews[image.filename] ?? image.review
    }))
  }
  const references = attach(
    [
      ...scanImageGallery(join(mediaDir, 'references'), 'home'),
      ...scanImageGallery(join(legacyMedia, 'references'), 'legacy')
    ],
    'references'
  )
  const photoshoots = attach(
    [
      ...scanImageGallery(join(mediaDir, 'photoshoots'), 'home'),
      ...scanImageGallery(join(legacyMedia, 'photoshoots'), 'legacy')
    ],
    'photoshoots'
  )
  const journal = attach(
    isJournalist
      ? [
          ...scanImageGallery(join(mediaDir, 'journal'), 'home'),
          ...scanLegacyJournal(join(legacyPhotoJournalDir(repoRoot), 'identity-reviews'))
        ]
      : scanImageGallery(join(mediaDir, 'journal'), 'home'),
    'journal'
  )
  const videoRoots: [string, 'home' | 'legacy'][] = [
    [join(mediaDir, 'videos', 'originals'), 'home'],
    [join(repoRoot, 'public', 'videos', 'employee-media', goal, 'originals'), 'legacy']
  ]
  if (isJournalist) {
    for (const personaDir of safeReaddir(join(repoRoot, 'public', 'videos', 'photo-journal'))) {
      videoRoots.push([join(repoRoot, 'public', 'videos', 'photo-journal', personaDir), 'legacy'])
    }
  }
  const videoReviews = mergeReviews(home, legacy, 'videos')
  const videos = scanVideos(videoRoots)
    .slice(0, GALLERY_LIMIT)
    .map((video) => ({ ...video, review: videoReviews[video.filename] ?? video.review }))
  const reviewStats: XosReviewPending = { pending: 0, accepted: 0, rejected: 0 }
  for (const media of [...references, ...photoshoots, ...journal, ...videos]) {
    reviewStats[media.review.status] += 1
  }
  return {
    projectKey: repoRoot,
    goal,
    soulPath: existsSync(soulPath) ? soulPath : null,
    soul,
    traits: soulTraits(soul),
    references,
    photoshoots,
    journal,
    videos,
    reviewStats,
    sidecars,
    mediaDir
  }
}

/** PF5 input for the portfolio rollup: pending/accepted/rejected across a project's goals. */
export function countProjectReviews(repoRoot: string, goals: string[]): XosReviewPending {
  const totals: XosReviewPending = { pending: 0, accepted: 0, rejected: 0 }
  for (const goal of goals) {
    const studio = readPersonaStudio(repoRoot, goal)
    if (studio) {
      totals.pending += studio.reviewStats.pending
      totals.accepted += studio.reviewStats.accepted
      totals.rejected += studio.reviewStats.rejected
    }
  }
  return totals
}

function writeHomeReview(
  mediaDir: string,
  gallery: string,
  filename: string,
  status: 'accepted' | 'rejected',
  reason?: string
): void {
  const reviews = homeReviews(mediaDir)
  reviews[gallery] = {
    ...reviews[gallery],
    [filename]: { status, reason: reason?.trim() || null, reviewedAt: new Date().toISOString() }
  }
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(
    join(mediaDir, 'review-status.json'),
    `${JSON.stringify(reviews, null, 2)}\n`,
    'utf8'
  )
}

function findImage(
  studio: XosPersonaStudio,
  gallery: 'photoshoots' | 'journal' | 'references',
  filename: string
): XosMediaImage | null {
  const list =
    gallery === 'photoshoots'
      ? studio.photoshoots
      : gallery === 'journal'
        ? studio.journal
        : studio.references
  return list.find((image) => image.filename === filename) ?? null
}

function copyIntoReferences(mediaDir: string, source: string, filename: string): void {
  for (const variant of VARIANTS) {
    const destDir = join(mediaDir, 'references', variant)
    mkdirSync(destDir, { recursive: true })
    const dest = join(destDir, filename)
    if (resolve(source) !== resolve(dest)) {
      cpSync(source, dest)
    }
  }
}

const fail = (error: string): XosActionResult => ({ ok: false, error })

/** Review, reference and SOUL writes. Every path stays inside the goal's project-home media dir. */
export async function applyPersonaMutation(
  repoRoot: string,
  goal: string,
  mutation: XosPersonaMutation
): Promise<XosActionResult> {
  const studio = readPersonaStudio(repoRoot, goal)
  if (!studio) {
    return fail(`Goal ${goal} was not found.`)
  }
  const mediaDir = personaMediaDir(repoRoot, goal)
  const goalDir = join(resolveProjectGoalsDir(repoRoot), goal)
  try {
    switch (mutation.kind) {
      case 'review-image':
      case 'review-video': {
        const gallery = mutation.kind === 'review-video' ? 'videos' : mutation.gallery
        writeHomeReview(mediaDir, gallery, mutation.filename, mutation.status, mutation.reason)
        break
      }
      case 'add-reference': {
        const image = findImage(studio, mutation.sourceGallery, mutation.filename)
        const source = image?.variants.original ?? image?.variants.gallery
        if (!image || !source) {
          return fail(`${mutation.filename} was not found in ${mutation.sourceGallery}.`)
        }
        copyIntoReferences(mediaDir, source, image.filename)
        writeHomeReview(
          mediaDir,
          'references',
          image.filename,
          'accepted',
          'promoted from photoshoot'
        )
        break
      }
      case 'remove-reference': {
        const image = studio.references.find((entry) => entry.filename === mutation.filename)
        if (!image) {
          return fail(`${mutation.filename} is not a reference image.`)
        }
        if (image.origin === 'legacy') {
          return fail(
            'Legacy repo references are read-only in Orca. Remove them in Cascade or upload a replacement.'
          )
        }
        for (const variant of VARIANTS) {
          rmSync(join(mediaDir, 'references', variant, image.filename), { force: true })
        }
        break
      }
      case 'upload-reference': {
        if (/[/\\]|\.\./.test(mutation.filename) || !IMAGE_RE.test(mutation.filename)) {
          return fail('Reference filename must be a plain image file name (webp, png or jpg).')
        }
        const data = Buffer.from(mutation.dataBase64, 'base64')
        if (data.byteLength === 0 || data.byteLength > UPLOAD_MAX_BYTES) {
          return fail('Reference image must be between 1 byte and 12 MB.')
        }
        const original = join(mediaDir, 'references', 'originals', mutation.filename)
        mkdirSync(join(mediaDir, 'references', 'originals'), { recursive: true })
        writeFileSync(original, data)
        copyIntoReferences(mediaDir, original, mutation.filename)
        writeHomeReview(mediaDir, 'references', mutation.filename, 'accepted', 'operator upload')
        break
      }
      case 'save-soul': {
        if (mutation.soul.length > SOUL_MAX_BYTES) {
          return fail(`SOUL.md is limited to ${SOUL_MAX_BYTES / 1024} KB.`)
        }
        writeFileSync(join(goalDir, 'SOUL.md'), mutation.soul, 'utf8')
        break
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  audit({ action: `persona.${mutation.kind}`, project: basename(repoRoot), goal })
  await commitProjectHome(repoRoot, `xos: persona ${mutation.kind} for ${goal}`)
  return { ok: true, message: `Persona studio: ${mutation.kind} saved for ${goal}.` }
}

export { resolvePersonaImage } from './xos-persona-media'
