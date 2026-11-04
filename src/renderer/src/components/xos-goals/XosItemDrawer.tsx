// XOS fork: Tasks → Goals item drawer (§3h.2): frontmatter editor, stage move / reject controls,
// transition timeline from transitions.jsonl, and rendered markdown spec.
import React, { useEffect, useState } from 'react'
import { CheckCircle2, FileText, Plus, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type {
  XosItemDetail,
  XosItemMutation,
  XosItemStage
} from '../../../../shared/xos-items-types'
import { relativeTime } from './xos-format'
import { XosItemFields } from './XosItemFields'
import { XosItemTimeline } from './XosItemTimeline'
import { prettyGoal, type XosViewItem } from './xos-items-model'

const REJECT_BUCKETS = [
  { id: 'not-now', label: 'Not now' },
  { id: 'too-big', label: 'Too big' },
  { id: 'off-brand', label: 'Off brand' },
  { id: 'wrong-direction', label: 'Wrong direction' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'not-interested', label: 'Not interested' },
  { id: 'other', label: 'Other' }
] as const

const QUICK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const QUICK_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const

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

const NO_STAGES: XosItemStage[] = []

export function XosItemDrawer({
  item,
  stage,
  stages = NO_STAGES,
  onClose,
  onMutated
}: {
  item: XosViewItem | null
  stage: XosItemStage | null
  stages?: XosItemStage[]
  onClose: () => void
  onMutated?: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<XosItemDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejectBucket, setRejectBucket] = useState<string>('not-now')
  const [customKey, setCustomKey] = useState('')
  const [customVal, setCustomVal] = useState('')
  const path = item?.path ?? null

  const reloadDetail = (targetPath: string): void => {
    if (!window.api.xosGoals) {
      return
    }
    setLoading(true)
    void window.api.xosGoals
      .getItem({ path: targetPath })
      .then((result) => setDetail(result))
      .finally(() => setLoading(false))
  }

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

  const runMutation = async (mutation: XosItemMutation, closeAfter = false): Promise<void> => {
    if (!window.api.xosGoals?.mutateItem) {
      return
    }
    setBusy(true)
    try {
      const res = await window.api.xosGoals.mutateItem(mutation)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(res.message)
      onMutated?.()
      if (closeAfter || mutation.kind === 'move') {
        onClose()
      } else if (res.path) {
        reloadDetail(res.path)
      }
    } finally {
      setBusy(false)
    }
  }

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
  const rejectedStage = stages.find((s) => s.kind === 'rejected')
  const currentPriority = String(detail?.frontmatter?.priority ?? '')
  const currentSize = String(detail?.frontmatter?.size ?? '')

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
            {item && (
              <Button
                type="button"
                size="sm"
                variant={item.ready ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() =>
                  void runMutation({ kind: 'edit', path: item.path, ready: !item.ready })
                }
              >
                <CheckCircle2 className="size-3.5" />
                {item.ready ? 'Ready (unset)' : 'Mark ready'}
              </Button>
            )}
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
              title={path ?? ''}
            >
              {path}
            </span>
          </div>
        </SheetHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto border-t px-4 py-4">
          {item && (
            <section className="space-y-2.5 rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {stages.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Stage:</span>
                    <Select
                      value={item.stageId}
                      disabled={busy}
                      onValueChange={(toStageId) =>
                        toStageId !== item.stageId &&
                        void runMutation({ kind: 'move', path: item.path, toStageId }, true)
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        density="compact"
                        className="h-7 w-40"
                        aria-label="Move stage"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Priority:</span>
                  <Select
                    value={currentPriority || 'none'}
                    disabled={busy}
                    onValueChange={(val) =>
                      void runMutation({
                        kind: 'edit',
                        path: item.path,
                        updates: { priority: val === 'none' ? null : val }
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      density="compact"
                      className="h-7 w-28"
                      aria-label="Priority"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {QUICK_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Size:</span>
                  <Select
                    value={currentSize || 'none'}
                    disabled={busy}
                    onValueChange={(val) =>
                      void runMutation({
                        kind: 'edit',
                        path: item.path,
                        updates: { size: val === 'none' ? null : val }
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      density="compact"
                      className="h-7 w-24"
                      aria-label="Size"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {QUICK_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {rejectedStage && item.stageId !== rejectedStage.id && (
                <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                  <span className="text-muted-foreground">Reject into bucket:</span>
                  <Select value={rejectBucket} onValueChange={setRejectBucket}>
                    <SelectTrigger
                      size="sm"
                      density="compact"
                      className="h-7 w-40"
                      aria-label="Reject reason"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REJECT_BUCKETS.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runMutation(
                        {
                          kind: 'move',
                          path: item.path,
                          toStageId: rejectedStage.id,
                          bucket: rejectBucket
                        },
                        true
                      )
                    }
                  >
                    <XCircle className="size-3.5" />
                    Reject
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                <Input
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="field (e.g. risk)"
                  density="compact"
                  className="w-36"
                />
                <Input
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value)}
                  placeholder="value (empty clears)"
                  density="compact"
                  className="w-44"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !customKey.trim()}
                  onClick={() => {
                    const key = customKey.trim()
                    if (!key) {
                      return
                    }
                    void runMutation({
                      kind: 'edit',
                      path: item.path,
                      updates: { [key]: customVal.trim() || null }
                    })
                    setCustomKey('')
                    setCustomVal('')
                  }}
                >
                  <Plus className="size-3.5" />
                  Set field
                </Button>
              </div>
            </section>
          )}
          {stage && (stage.writers.length > 0 || stage.readers.length > 0) && (
            <section className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <GoalLine label="Put here by" goals={stage.writers} />
              <GoalLine label="Picked up by" goals={stage.readers} />
            </section>
          )}
          {detail?.transitions && <XosItemTimeline transitions={detail.transitions} />}
          <XosItemFields fields={fields} />
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
