// XOS fork: Personas & Media Studio (stage F, EM1-EM6). One goal's persona identity: SOUL.md voice
// traits, reference/photoshoot/journal galleries, video gallery, review workflow and the sidecar
// generation triggers. Media lives under the goal's assets/media in the project home; legacy
// Cascade folders (public/images/employee-media, content/photo-journal) are read-only fallbacks.
import type { XosActionResult } from './xos-goals-types'

export type { XosActionResult } from './xos-goals-types'

export type XosMediaReviewStatus = 'pending' | 'accepted' | 'rejected'

export type XosMediaReview = {
  status: XosMediaReviewStatus
  reason: string | null
  reviewedAt: string | null
}

export type XosMediaImage = {
  filename: string
  /** 'home' = ~/.orca-xos project-home assets (writable); 'legacy' = repo folders (read-only). */
  origin: 'home' | 'legacy'
  /** Absolute paths per variant; originals is the source of truth, gallery/thumbs may mirror it. */
  variants: { original: string | null; gallery: string | null; thumb: string | null }
  review: XosMediaReview
  bytes: number
}

export type XosMediaVideo = {
  filename: string
  origin: 'home' | 'legacy'
  path: string
  poster: string | null
  review: XosMediaReview
  bytes: number
}

export type XosPersonaTrait = {
  key: string
  label: string
  /** Section body, flattened to one line. */
  value: string
}

/** Review decision counts (one gallery or a whole project). */
export type XosReviewPending = { pending: number; accepted: number; rejected: number }

export type XosPersonaStudio = {
  projectKey: string
  goal: string
  soulPath: string | null
  /** SOUL.md content (bounded read). */
  soul: string | null
  traits: XosPersonaTrait[]
  references: XosMediaImage[]
  photoshoots: XosMediaImage[]
  journal: XosMediaImage[]
  videos: XosMediaVideo[]
  reviewStats: XosReviewPending
  /** Sidecar contracts available for generation runs (EM6). */
  sidecars: string[]
  /** Canonical writable media dir in the project home. */
  mediaDir: string
}

export type XosPersonaImageGallery = 'references' | 'photoshoots' | 'journal'

export type XosPersonaMutation =
  | {
      kind: 'review-image'
      gallery: XosPersonaImageGallery
      filename: string
      status: 'accepted' | 'rejected'
      reason?: string
    }
  | { kind: 'review-video'; filename: string; status: 'accepted' | 'rejected'; reason?: string }
  | { kind: 'add-reference'; sourceGallery: 'photoshoots' | 'journal'; filename: string }
  | { kind: 'remove-reference'; filename: string }
  | { kind: 'upload-reference'; filename: string; dataBase64: string }
  | { kind: 'save-soul'; soul: string }

export type XosPersonaApi = {
  getPersonaStudio: (args: { projectKey: string; goal: string }) => Promise<XosPersonaStudio | null>
  mutatePersona: (args: {
    projectKey: string
    goal: string
    mutation: XosPersonaMutation
  }) => Promise<XosActionResult>
  /** Data URL for a gallery image (home or legacy), for <img> thumbnails. */
  personaImage: (args: {
    projectKey: string
    goal: string
    gallery: XosPersonaImageGallery | 'videos'
    filename: string
  }) => Promise<string | null>
}
