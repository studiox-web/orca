// XOS fork: Stage D live run tail (plan §4 row D, UI7 live-tail, OV2). Polls the goal's native
// run while the viewer/card is visible: status + elapsed, the claimed item and its stage (§3g.5),
// and the last screen lines. Legacy crontab runs return null here and keep the old spinner.
import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosLiveRunTail } from '../../../../shared/xos-goals-types'
import { formatDuration, relativeTime } from './xos-format'

const LIVE_MS = 3_000
const IDLE_MS = 15_000

export function useXosLiveTail(
  projectKey: string,
  goal: string,
  active = true
): XosLiveRunTail | null {
  const [tail, setTail] = useState<XosLiveRunTail | null>(null)
  useEffect(() => {
    const api = window.api.xosGoals
    if (!active || !api) {
      return
    }
    let cancelled = false
    let timer: number | null = null
    const poll = async (): Promise<void> => {
      try {
        const next = await api.liveTail({ projectKey, goal })
        if (!cancelled) {
          setTail(next)
          timer = window.setTimeout(
            () => void poll(),
            next?.status === 'running' ? LIVE_MS : IDLE_MS
          )
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void poll(), IDLE_MS)
        }
      }
    }
    void poll()
    const onVisibility = (): void => {
      if (!document.hidden && timer === null) {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [projectKey, goal, active])
  return tail
}

const STATUS_META: Record<XosLiveRunTail['status'], { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'xos-tone-live' },
  success: { label: 'Success', tone: 'xos-tone-success' },
  failed: { label: 'Failed', tone: 'xos-tone-danger' },
  limited: { label: 'Usage limit', tone: 'xos-tone-warning' },
  takeover: { label: 'Operator at the helm', tone: 'xos-tone-live' }
}

export function LiveRunStatusChip({ tail }: { tail: XosLiveRunTail }): React.JSX.Element {
  const meta = STATUS_META[tail.status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.tone}`}
    >
      {tail.status === 'running' && (
        <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" />
      )}
      {meta.label}
      {tail.elapsedSeconds !== null && formatDuration(tail.elapsedSeconds) ? (
        <span className="font-normal opacity-80">· {formatDuration(tail.elapsedSeconds)}</span>
      ) : null}
    </span>
  )
}

/** Goal Viewer section: the live (or latest native) run with its tail, item and stage. */
export function XosLiveRunTail({
  projectKey,
  goal,
  onOpenLog
}: {
  projectKey: string
  goal: string
  onOpenLog: (path: string) => void
}): React.JSX.Element | null {
  const tail = useXosLiveTail(projectKey, goal)
  // Null = follow the run: the tail opens while running and stays as the user left it afterwards.
  const [tailOverride, setTailOverride] = useState<boolean | null>(null)
  const showTail = tailOverride ?? tail?.status === 'running'
  if (!tail) {
    return null
  }
  const text = tail.lines.join('\n').trimEnd()
  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <LiveRunStatusChip tail={tail} />
        {tail.item && (
          <span
            className="inline-flex max-w-64 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs"
            title={`${tail.item.path} — stage ${tail.item.stage}`}
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate">{tail.item.title}</span>
            <span className="shrink-0 text-muted-foreground">· {tail.item.stage}</span>
          </span>
        )}
        {tail.branch && (
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{tail.branch}</code>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {tail.trigger === 'manual_takeover'
              ? `took over ${relativeTime(tail.startedAt)}`
              : `${relativeTime(tail.startedAt)}${tail.finishedAt ? '' : ' …'}`}
          </span>
          {text && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setTailOverride(!showTail)}
              aria-expanded={showTail}
            >
              {showTail ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Tail
            </Button>
          )}
          {tail.logPath && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenLog(tail.logPath)}>
              <FileText className="size-4" />
              Log
            </Button>
          )}
        </span>
      </div>
      {text && showTail && (
        <pre className="scrollbar-sleek max-h-56 overflow-auto rounded-md border bg-background/80 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}
    </section>
  )
}

/** Card badge (UI7 live-tail button): shows the live native run and its item while running. */
export function XosGoalLiveBadge({
  projectKey,
  goal,
  active
}: {
  projectKey: string
  goal: string
  active: boolean
}): React.JSX.Element | null {
  const tail = useXosLiveTail(projectKey, goal, active)
  if (!tail || (tail.status !== 'running' && tail.status !== 'takeover')) {
    return null
  }
  return (
    <span
      className="pointer-events-none absolute top-2 left-2 z-10 inline-flex max-w-[85%] items-center gap-1.5 rounded-sm border border-primary/30 bg-background/95 px-1.5 py-0.5 text-[10px] font-semibold text-primary shadow-sm"
      title={
        tail.item
          ? `${STATUS_META[tail.status].label}: ${tail.item.title} (${tail.item.stage})`
          : STATUS_META[tail.status].label
      }
    >
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
      <span className="truncate">{tail.item?.title ?? STATUS_META[tail.status].label}</span>
    </span>
  )
}
