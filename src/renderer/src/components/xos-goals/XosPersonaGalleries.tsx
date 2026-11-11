// XOS fork: Persona Studio media galleries (stage F). Reference gallery (upload/promote/remove),
// photoshoot and photo-journal galleries with the accept/reject review workflow (EM1/EM2/EM3/EM5),
// the video gallery with posters (EM4) and the shared image-loading hook. The reject dialog lives
// here so the review reason stays next to the galleries it applies to.
import React, { useRef, useState } from 'react'
import { Camera, Check, Film, ImagePlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosPersonaMutation, XosPersonaStudio } from '../../../../shared/xos-persona-types'
import { formatCompactNumber, relativeTime } from './xos-format'
import { GalleryCard, ReviewChip, usePersonaImage, VideoPoster } from './XosPersonaGalleryCards'

export { ReviewChip, usePersonaImage }

const JOURNAL_PAGE_SIZE = 12

type ReviewGallery = 'photoshoots' | 'journal' | 'videos'

export function PersonaGalleries({
  projectKey,
  goal,
  studio,
  mutate,
  onOpenFile
}: {
  projectKey: string
  goal: string
  studio: XosPersonaStudio
  mutate: (mutation: XosPersonaMutation) => Promise<boolean>
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  const [journalPage, setJournalPage] = useState(0)
  const [rejecting, setRejecting] = useState<{ gallery: ReviewGallery; filename: string } | null>(
    null
  )
  const [rejectReason, setRejectReason] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const review = (
    gallery: ReviewGallery,
    filename: string,
    status: 'accepted' | 'rejected'
  ): void => {
    if (status === 'rejected') {
      setRejecting({ gallery, filename })
      setRejectReason('')
      return
    }
    void mutate(
      gallery === 'videos'
        ? { kind: 'review-video', filename, status }
        : { kind: 'review-image', gallery, filename, status }
    )
  }

  const confirmReject = (): void => {
    if (!rejecting) {
      return
    }
    const { gallery, filename } = rejecting
    void mutate(
      gallery === 'videos'
        ? { kind: 'review-video', filename, status: 'rejected', reason: rejectReason }
        : { kind: 'review-image', gallery, filename, status: 'rejected', reason: rejectReason }
    )
    setRejecting(null)
  }

  const upload = (file: File | undefined): void => {
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      void mutate({
        kind: 'upload-reference',
        filename: file.name,
        dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1)
      })
    }
    reader.readAsDataURL(file)
  }

  const journalStart = journalPage * JOURNAL_PAGE_SIZE
  const journalPageItems = studio.journal.slice(journalStart, journalStart + JOURNAL_PAGE_SIZE)
  const journalPages = Math.max(1, Math.ceil(studio.journal.length / JOURNAL_PAGE_SIZE))

  return (
    <>
      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">
            Reference images ({studio.references.length})
          </h2>
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                upload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" />
              Upload
            </Button>
          </div>
        </div>
        {studio.references.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
            {studio.references.map((image) => (
              <GalleryCard
                key={image.filename}
                projectKey={projectKey}
                goal={goal}
                gallery="references"
                image={image}
              >
                {image.origin === 'home' && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void mutate({ kind: 'remove-reference', filename: image.filename })
                    }
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </Button>
                )}
              </GalleryCard>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No references yet. Upload a photo or promote a reviewed photoshoot shot.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Camera className="size-4" />
          Photoshoot gallery ({studio.photoshoots.length})
        </h2>
        {studio.photoshoots.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
            {studio.photoshoots.map((image) => (
              <GalleryCard
                key={`${image.origin}:${image.filename}`}
                projectKey={projectKey}
                goal={goal}
                gallery="photoshoots"
                image={image}
              >
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => review('photoshoots', image.filename, 'accepted')}
                >
                  <Check className="size-3" />
                  Accept
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => review('photoshoots', image.filename, 'rejected')}
                >
                  <X className="size-3" />
                  Reject
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={studio.references.some((ref) => ref.filename === image.filename)}
                  onClick={() =>
                    void mutate({
                      kind: 'add-reference',
                      sourceGallery: 'photoshoots',
                      filename: image.filename
                    })
                  }
                >
                  Use as ref
                </Button>
              </GalleryCard>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No photoshoot images yet. Run a photoshoot sidecar.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Film className="size-4" />
          Video gallery ({studio.videos.length})
        </h2>
        {studio.videos.length ? (
          <div className="grid gap-2">
            {studio.videos.map((video) => (
              <div
                key={`${video.origin}:${video.filename}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-background/60 p-2 text-sm"
              >
                <VideoPoster projectKey={projectKey} goal={goal} video={video} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={video.filename}>
                    {video.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCompactNumber(video.bytes)} B
                    {video.review.reviewedAt
                      ? ` · reviewed ${relativeTime(video.review.reviewedAt)}`
                      : ''}
                  </p>
                </div>
                <ReviewChip status={video.review.status} reason={video.review.reason} />
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => review('videos', video.filename, 'accepted')}
                >
                  <Check className="size-3" />
                  Accept
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => review('videos', video.filename, 'rejected')}
                >
                  <X className="size-3" />
                  Reject
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => onOpenFile(video.path)}
                >
                  Open
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No videos yet.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <h2 className="text-sm font-semibold text-primary">
          Photo journal ({studio.journal.length})
        </h2>
        {journalPageItems.length ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
              {journalPageItems.map((image) => (
                <GalleryCard
                  key={`${image.origin}:${image.filename}`}
                  projectKey={projectKey}
                  goal={goal}
                  gallery="journal"
                  image={image}
                >
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => review('journal', image.filename, 'accepted')}
                  >
                    <Check className="size-3" />
                    Accept
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => review('journal', image.filename, 'rejected')}
                  >
                    <X className="size-3" />
                    Reject
                  </Button>
                </GalleryCard>
              ))}
            </div>
            {journalPages > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={journalPage === 0}
                  onClick={() => setJournalPage((page) => page - 1)}
                >
                  Prev
                </Button>
                <span className="text-muted-foreground">
                  Page {journalPage + 1} of {journalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={journalPage >= journalPages - 1}
                  onClick={() => setJournalPage((page) => page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No journal images yet.</p>
        )}
      </section>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Reject {rejecting.filename}</h3>
            <input
              autoFocus
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Reason (e.g. face drifts from references)"
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={confirmReject}>
                <X className="size-4" />
                Reject image
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
