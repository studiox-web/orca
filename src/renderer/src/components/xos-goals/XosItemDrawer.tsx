// XOS fork: Tasks → Goals item drawer (§3h stage 0): the item's frontmatter, rendered spec and the
// goals around its stage. Read-only; "Open in editor" is the way to change it until stage C.
import React, { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { XosItemDetail, XosItemStage } from '../../../../shared/xos-items-types'
import { relativeTime } from './xos-format'
import { prettyGoal, type XosViewItem } from './xos-items-model'

function fieldText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 1)
  }
  return String(value)
}

function GoalLine({ label, goals }: { label: string; goals: string[] }): React.JSX.Element | null {
  if (goals.length === 0) {
    return null
  }
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {goals.map(prettyGoal).join(', ')}
    </p>
  )
}

export function XosItemDrawer({
  item,
  stage,
  onClose
}: {
  item: XosViewItem | null
  stage: XosItemStage | null
  onClose: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<XosItemDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const path = item?.path ?? null

  useEffect(() => {
    setDetail(null)
    if (!path || !window.api.xosGoals) {
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api.xosGoals
      .getItem({ path })
      .then((result) => {
        if (!cancelled) {
          setDetail(result)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const openInEditor = (): void => {
    if (!path) {
      return
    }
    void window.api.xosGoals?.openFile({ path }).then((result) => {
      if (!result.ok) {
        toast.error(result.error)
      }
    })
  }

  const fields = Object.entries(detail?.frontmatter ?? {})

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>{item?.title}</SheetTitle>
          <SheetDescription>
            {stage?.label ?? item?.stageId}
            {item?.bucket ? ` · ${item.bucket}` : ''} · {item?.projectName}
            {item?.updatedAt ? ` · updated ${relativeTime(item.updatedAt)}` : ''}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1 pr-6">
            <Button type="button" size="sm" variant="outline" onClick={openInEditor}>
              <FileText className="size-3.5" />
              Open in editor
            </Button>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
              title={path ?? ''}
            >
              {path}
            </span>
          </div>
        </SheetHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto border-t px-4 py-4">
          {stage && (stage.writers.length > 0 || stage.readers.length > 0) && (
            <section className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <GoalLine label="Put here by" goals={stage.writers} />
              <GoalLine label="Picked up by" goals={stage.readers} />
            </section>
          )}
          {fields.length > 0 && (
            <dl className="grid gap-2 sm:grid-cols-2">
              {fields.map(([key, value]) => (
                <div key={key} className="min-w-0 rounded-md border bg-background/60 p-2 text-sm">
                  <dt className="text-xs font-semibold text-muted-foreground">{key}</dt>
                  <dd className="whitespace-pre-wrap break-words">{fieldText(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {loading && !detail && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && !detail && item && (
            <p className="text-sm text-muted-foreground">
              This file could not be read. It may have moved to another stage; refresh the board.
            </p>
          )}
          {detail && <CommentMarkdown content={detail.body} variant="document" />}
          {detail?.truncated && (
            <p className="text-xs text-muted-foreground">
              Showing the first 256 KB. Open the file in the editor for the rest.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
