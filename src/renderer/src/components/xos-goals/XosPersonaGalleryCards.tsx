// XOS fork: Persona Studio media gallery item cards, image cache hook, and review chips.
import React, { useEffect, useState } from 'react'
import { Film } from 'lucide-react'
import type {
  XosMediaImage,
  XosMediaReviewStatus,
  XosMediaVideo,
  XosPersonaImageGallery
} from '../../../../shared/xos-persona-types'
import { formatCompactNumber } from './xos-format'

const imageCache = new Map<string, Promise<string | null>>()

export function usePersonaImage(
  projectKey: string,
  goal: string,
  gallery: XosPersonaImageGallery | 'videos',
  filename: string | null
): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!filename) {
      setSrc(null)
      return
    }
    const key = `${projectKey}\0${goal}\0${gallery}\0${filename}`
    let pending = imageCache.get(key)
    if (!pending) {
      pending =
        window.api.xosGoals?.personaImage({ projectKey, goal, gallery, filename }) ??
        Promise.resolve(null)
      imageCache.set(key, pending)
    }
    void pending.then((data) => {
      if (!cancelled) {
        setSrc(data)
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectKey, goal, gallery, filename])
  return src
}

const REVIEW_TONE: Record<XosMediaReviewStatus, string> = {
  pending: 'xos-tone-warning',
  accepted: 'xos-tone-success',
  rejected: 'xos-tone-danger'
}

export function ReviewChip({
  status,
  reason
}: {
  status: XosMediaReviewStatus
  reason?: string | null
}): React.JSX.Element {
  return (
    <span
      className={`xos-chip ${REVIEW_TONE[status]}`}
      title={reason ? `Reason: ${reason}` : undefined}
    >
      {status}
      {reason ? ' · has note' : ''}
    </span>
  )
}

export function GalleryCard({
  projectKey,
  goal,
  gallery,
  image,
  children
}: {
  projectKey: string
  goal: string
  gallery: XosPersonaImageGallery
  image: XosMediaImage
  children: React.ReactNode
}): React.JSX.Element {
  const src = usePersonaImage(
    projectKey,
    goal,
    gallery,
    image.variants.thumb ?? image.variants.gallery ?? image.variants.original
  )
  return (
    <figure className="flex flex-col overflow-hidden rounded-lg border bg-background/60">
      {src ? (
        <img src={src} alt={image.filename} className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground">
          {formatCompactNumber(image.bytes)} B
        </div>
      )}
      <figcaption className="space-y-1.5 p-2">
        <p className="truncate text-[11px] text-muted-foreground" title={image.filename}>
          {image.filename}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <ReviewChip status={image.review.status} reason={image.review.reason} />
          {image.origin === 'legacy' && <span className="xos-chip xos-tone-neutral">legacy</span>}
        </div>
        <div className="flex flex-wrap gap-1">{children}</div>
      </figcaption>
    </figure>
  )
}

export function VideoPoster({
  projectKey,
  goal,
  video
}: {
  projectKey: string
  goal: string
  video: XosMediaVideo
}): React.JSX.Element {
  const posterName = video.poster ? video.poster.split('/').pop()! : null
  const src = usePersonaImage(projectKey, goal, 'videos', posterName)
  return src ? (
    <img src={src} alt="" className="size-16 shrink-0 rounded-md border object-cover" />
  ) : (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-muted/40">
      <Film className="size-5 text-muted-foreground" />
    </div>
  )
}
