// XOS fork: media scanning for the Persona Studio (stage F). Image galleries with
// originals/gallery/thumbs variants, video galleries with posters, and the review-state merge
// (home review-status.json over Cascade's content/photo-journal/review-status.json and
// video-reviews/*.md). All reads are bounded; legacy repo folders are read-only.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { XosMediaImage, XosMediaReview, XosMediaVideo } from '../../shared/xos-persona-types'
import { readHead, safeReaddir } from './xos-goal-files'
import { projectHomeDir } from './xos-project-home'

export const IMAGE_RE = /\.(webp|png|jpe?g)$/i
const VIDEO_RE = /\.(mp4|webm|mov)$/i
export const GALLERY_LIMIT = 300
const VARIANTS = ['originals', 'gallery', 'thumbs'] as const

export type ReviewMap = Record<string, Record<string, XosMediaReview>>

export const pendingReview = (): XosMediaReview => ({
  status: 'pending',
  reason: null,
  reviewedAt: null
})

/** The canonical writable media dir in the project home. */
export function personaMediaDir(repoRoot: string, goal: string): string {
  return join(projectHomeDir(repoRoot), 'goals', goal, 'assets', 'media')
}

export function legacyEmployeeMediaDir(repoRoot: string, goal: string): string {
  return join(repoRoot, 'public', 'images', 'employee-media', goal)
}

export function legacyPhotoJournalDir(repoRoot: string): string {
  return join(repoRoot, 'content', 'photo-journal')
}

function readJson<T>(path: string): T | null {
  try {
    const parsed: T = JSON.parse(readFileSync(path, 'utf8'))
    return parsed
  } catch {
    return null
  }
}

export function homeReviews(mediaDir: string): ReviewMap {
  return readJson<ReviewMap>(join(mediaDir, 'review-status.json')) ?? {}
}

/** Cascade's review-status.json: employees.<goal>.photoshoots.<file>, plus video review md files. */
export function legacyReviews(repoRoot: string, goal: string): ReviewMap {
  const dir = legacyPhotoJournalDir(repoRoot)
  const raw = readJson<{
    employees?: Record<
      string,
      {
        photoshoots?: Record<
          string,
          { status?: string; reason?: string | null; reviewed_at?: string }
        >
      }
    >
  }>(join(dir, 'review-status.json'))
  const photoshoots: Record<string, XosMediaReview> = {}
  for (const [file, entry] of Object.entries(raw?.employees?.[goal]?.photoshoots ?? {})) {
    photoshoots[file] = {
      status: entry.status === 'accepted' || entry.status === 'rejected' ? entry.status : 'pending',
      reason: entry.reason ?? null,
      reviewedAt: entry.reviewed_at ?? null
    }
  }
  const videos: Record<string, XosMediaReview> = {}
  for (const name of safeReaddir(join(dir, 'video-reviews'))) {
    if (!name.endsWith('-review.md')) {
      continue
    }
    const head = readHead(join(dir, 'video-reviews', name), 2048) ?? ''
    const status = /^status:\s*(\S+)/m.exec(head)?.[1] ?? 'generated'
    const required = /^operator_review_required:\s*true/m.test(head)
    videos[name.replace(/-review\.md$/, '.mp4')] = {
      status:
        status === 'accepted' || status === 'rejected' ? status : required ? 'pending' : 'accepted',
      reason: null,
      reviewedAt: null
    }
  }
  return { photoshoots, videos }
}

export function mergeReviews(
  home: ReviewMap,
  legacy: ReviewMap,
  gallery: string
): Record<string, XosMediaReview> {
  return { ...legacy[gallery], ...home[gallery] }
}

export function scanImageGallery(dir: string, origin: 'home' | 'legacy'): XosMediaImage[] {
  if (!existsSync(dir)) {
    return []
  }
  const byFile = new Map<string, XosMediaImage>()
  for (const variant of VARIANTS) {
    for (const name of safeReaddir(join(dir, variant))) {
      if (!IMAGE_RE.test(name)) {
        continue
      }
      const path = join(dir, variant, name)
      let bytes = 0
      try {
        bytes = statSync(path).size
      } catch {
        continue
      }
      const entry = byFile.get(name) ?? {
        filename: name,
        origin,
        variants: { original: null, gallery: null, thumb: null },
        review: pendingReview(),
        bytes: 0
      }
      if (variant === 'originals') {
        entry.variants.original = path
        entry.bytes = bytes
      } else if (variant === 'gallery') {
        entry.variants.gallery = path
      } else {
        entry.variants.thumb = path
      }
      byFile.set(name, entry)
    }
  }
  return [...byFile.values()].sort((a, b) => b.filename.localeCompare(a.filename))
}

export function scanLegacyJournal(dir: string): XosMediaImage[] {
  if (!existsSync(dir)) {
    return []
  }
  return safeReaddir(dir)
    .filter((name) => IMAGE_RE.test(name))
    .map((name) => {
      const path = join(dir, name)
      let bytes = 0
      try {
        bytes = statSync(path).size
      } catch {
        // Listed then gone: a goal is moving media right now.
      }
      return {
        filename: name,
        origin: 'legacy' as const,
        variants: { original: path, gallery: null, thumb: null },
        review: pendingReview(),
        bytes
      }
    })
    .sort((a, b) => b.filename.localeCompare(a.filename))
}

export function scanVideos(dirs: [string, 'home' | 'legacy'][]): XosMediaVideo[] {
  const out: XosMediaVideo[] = []
  for (const [dir, origin] of dirs) {
    for (const name of safeReaddir(dir)) {
      if (!VIDEO_RE.test(name)) {
        continue
      }
      const path = join(dir, name)
      let bytes = 0
      try {
        bytes = statSync(path).size
      } catch {
        continue
      }
      const posterDir =
        basename(dir) === 'originals' ? join(dir, '..', 'posters') : join(dir, 'posters')
      const poster = [
        name.replace(VIDEO_RE, '.webp'),
        name.replace(VIDEO_RE, '.jpg'),
        name.replace(VIDEO_RE, '.png')
      ]
        .map((candidate) => resolve(join(posterDir, candidate)))
        .find((candidate) => existsSync(candidate))
      out.push({
        filename: name,
        origin,
        path,
        poster: poster ?? null,
        review: pendingReview(),
        bytes
      })
    }
  }
  return out.sort((a, b) => b.filename.localeCompare(a.filename))
}

/** Absolute path for one gallery image (home first, then legacy), for the IPC data-URL handler. */
export function resolvePersonaImage(
  repoRoot: string,
  goal: string,
  gallery: string,
  filename: string
): string | null {
  if (/[/\\]|\.\./.test(filename)) {
    return null
  }
  const direct = (roots: string[]): string | null => {
    for (const root of roots) {
      const path = resolve(join(root, filename))
      if (path.startsWith(`${resolve(root)}${sep}`) && existsSync(path)) {
        return path
      }
    }
    return null
  }
  if (gallery === 'journal' && goal === 'photo-journalist') {
    return direct([
      join(personaMediaDir(repoRoot, goal), 'journal'),
      join(legacyPhotoJournalDir(repoRoot), 'identity-reviews')
    ])
  }
  if (gallery === 'videos') {
    return direct([
      join(personaMediaDir(repoRoot, goal), 'videos', 'posters'),
      join(personaMediaDir(repoRoot, goal), 'videos', 'originals'),
      join(repoRoot, 'public', 'videos', 'employee-media', goal, 'posters')
    ])
  }
  const roots =
    gallery === 'journal'
      ? [join(personaMediaDir(repoRoot, goal), 'journal')]
      : [
          join(personaMediaDir(repoRoot, goal), gallery),
          join(legacyEmployeeMediaDir(repoRoot, goal), gallery)
        ]
  for (const root of roots) {
    for (const variant of VARIANTS) {
      const path = resolve(join(root, variant, filename))
      if (path.startsWith(`${resolve(root)}${sep}`) && existsSync(path)) {
        return path
      }
    }
  }
  return null
}
