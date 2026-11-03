// XOS fork: a goal's work queues (§3g, read-only in stage 0): small chips over the card art, and a
// Queues section in the Goal Viewer that opens each queue in Tasks → Goals.
import React from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosGoalQueues, XosQueueRef } from '../../../../shared/xos-items-types'
import { relativeTime } from './xos-format'
import { TONE_CLASS } from './xos-items-model'
import { openXosItemsInTasks } from './xos-items-source'

function amount(ref: XosQueueRef): string {
  const value = ref.readyCount ?? ref.count
  return ref.ceiling !== null ? `${value}/${ref.ceiling}` : String(value)
}

function describe(ref: XosQueueRef, direction: 'in' | 'out'): string {
  const parts = [
    `${direction === 'in' ? 'Reads' : 'Feeds'} ${ref.label}: ${ref.count} item${ref.count === 1 ? '' : 's'}`
  ]
  if (ref.readyCount !== null) {
    parts.push(`${ref.readyCount} ready`)
  }
  if (ref.floor !== null || ref.ceiling !== null) {
    parts.push(`keep between ${ref.floor ?? 0} and ${ref.ceiling ?? '∞'}`)
  }
  if (ref.tone === 'starved') {
    parts.push('below its floor: upstream should refill it')
  } else if (ref.tone === 'backed-up') {
    parts.push('at its ceiling: upstream should pause')
  }
  return parts.join(' · ')
}

/** Up to three chips; queues that need attention first, then ones with work waiting. */
export function XosQueueChips({ queues }: { queues: XosGoalQueues }): React.JSX.Element | null {
  const weight = { 'backed-up': 0, starved: 1, ok: 2, idle: 3 } as const
  const refs = [
    ...queues.in.map((ref) => ({ ref, direction: 'in' as const })),
    ...queues.out.map((ref) => ({ ref, direction: 'out' as const }))
  ]
    .sort((a, b) => weight[a.ref.tone] - weight[b.ref.tone])
    .slice(0, 3)
  if (refs.length === 0) {
    return null
  }
  return (
    <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] flex-wrap gap-1">
      {refs.map(({ ref, direction }) => {
        const Icon = direction === 'in' ? ArrowDownToLine : ArrowUpFromLine
        return (
          <span
            key={`${direction}:${ref.typeId}:${ref.stageId}`}
            title={describe(ref, direction)}
            className={[
              'inline-flex items-center gap-1 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm',
              TONE_CLASS[ref.tone]
            ].join(' ')}
          >
            <Icon className="size-3" aria-hidden="true" />
            <span className="max-w-24 truncate">{ref.label}</span>
            <span className="tabular-nums">{amount(ref)}</span>
          </span>
        )
      })}
    </span>
  )
}

function QueueRow({
  queueRef,
  direction,
  projectKey
}: {
  queueRef: XosQueueRef
  direction: 'in' | 'out'
  projectKey: string
}): React.JSX.Element {
  const Icon = direction === 'in' ? ArrowDownToLine : ArrowUpFromLine
  const oldest = relativeTime(queueRef.oldestAt)
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background/60 p-2 text-sm">
      <span
        className={[
          'inline-flex size-7 items-center justify-center rounded-md border',
          TONE_CLASS[queueRef.tone]
        ].join(' ')}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {queueRef.label}{' '}
          <span className="tabular-nums text-muted-foreground">{amount(queueRef)}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {describe(queueRef, direction)}
          {oldest ? ` · oldest ${oldest}` : ''}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          openXosItemsInTasks({ projectKey, typeId: queueRef.typeId, stageId: queueRef.stageId })
        }
      >
        <ExternalLink className="size-3.5" />
        Open in Tasks
      </Button>
    </div>
  )
}

export function XosGoalQueueList({
  queues,
  projectKey
}: {
  queues: XosGoalQueues
  projectKey: string
}): React.JSX.Element {
  if (queues.in.length === 0 && queues.out.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This goal has no known work queues. Queues become editable in GOAL.md in a later stage.
      </p>
    )
  }
  return (
    <div className="grid gap-2">
      {queues.in.map((ref) => (
        <QueueRow
          key={`in:${ref.typeId}:${ref.stageId}`}
          queueRef={ref}
          direction="in"
          projectKey={projectKey}
        />
      ))}
      {queues.out.map((ref) => (
        <QueueRow
          key={`out:${ref.typeId}:${ref.stageId}`}
          queueRef={ref}
          direction="out"
          projectKey={projectKey}
        />
      ))}
    </div>
  )
}

export function queueSummary(queues: XosGoalQueues): string {
  const total = queues.in.length + queues.out.length
  if (total === 0) {
    return 'none'
  }
  const attention = [...queues.in, ...queues.out].filter(
    (ref) => ref.tone === 'starved' || ref.tone === 'backed-up'
  ).length
  return `${queues.in.length} in · ${queues.out.length} out${attention ? ` · ${attention} need attention` : ''}`
}
