// XOS fork: Tasks → Goals board (columns = stages) and list views (§3h stage 0).
import React, { useEffect, useState } from 'react'
import { ChevronRight, CircleCheck } from 'lucide-react'
import { relativeTime } from './xos-format'
import {
  chipValue,
  prettyGoal,
  stageTone,
  TONE_CLASS,
  type XosItemColumn,
  type XosViewItem
} from './xos-items-model'

const CARD_CHIP_KEYS = [
  'priority',
  'size',
  'risk',
  'severity',
  'review_status',
  'media_status',
  'status'
]

function ItemChips({ item, limit }: { item: XosViewItem; limit: number }): React.JSX.Element {
  const chips = CARD_CHIP_KEYS.map((key) => ({ key, value: chipValue(item, key) }))
    .filter((chip): chip is { key: string; value: string } => chip.value !== null)
    .slice(0, limit)
  return (
    <span className="flex flex-wrap gap-1">
      {item.ready && (
        <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold xos-tone-success">
          <CircleCheck className="size-3" aria-hidden="true" />
          ready
        </span>
      )}
      {item.bucket && (
        <span className="rounded-full border px-1.5 text-[10px] font-semibold xos-tone-warning">
          {item.bucket}
        </span>
      )}
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.key}
          className="max-w-36 truncate rounded-full border bg-muted/40 px-1.5 text-[10px] text-muted-foreground"
        >
          {chip.value.replace(/_/g, ' ')}
        </span>
      ))}
    </span>
  )
}

function ItemCard({
  item,
  showProject,
  onOpen
}: {
  item: XosViewItem
  showProject: boolean
  onOpen: (item: XosViewItem) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full flex-col gap-1.5 rounded-md border bg-card p-2.5 text-left text-sm shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <span className="line-clamp-2 font-medium leading-snug">{item.title}</span>
      <ItemChips item={item} limit={3} />
      <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{showProject ? item.projectName : (item.created ?? '')}</span>
        <span className="shrink-0">{relativeTime(item.updatedAt)}</span>
      </span>
    </button>
  )
}

function ColumnHeader({ column }: { column: XosItemColumn }): React.JSX.Element {
  const { stage } = column
  const tone = stageTone(stage)
  const band =
    stage.floor !== null || stage.ceiling !== null
      ? `keep ${stage.floor ?? 0}–${stage.ceiling ?? '∞'}${stage.readyCount !== null ? ' ready' : ''}`
      : null
  const flow = [
    stage.writers.length ? `from ${stage.writers.map(prettyGoal).join(', ')}` : null,
    stage.readers.length ? `to ${stage.readers.map(prettyGoal).join(', ')}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="space-y-1 px-1 pb-2" title={flow || undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{stage.label}</span>
        <span
          className={[
            'rounded-full border px-1.5 text-[11px] font-semibold tabular-nums',
            TONE_CLASS[tone]
          ].join(' ')}
        >
          {stage.readyCount !== null ? `${stage.readyCount}/${stage.count}` : stage.count}
        </span>
      </div>
      {(band || flow) && (
        <p className="truncate text-[11px] text-muted-foreground">{band ?? flow}</p>
      )}
    </div>
  )
}

export function XosItemsBoardView({
  columns,
  focusStageId,
  showProject,
  onOpen
}: {
  columns: XosItemColumn[]
  focusStageId: string | null
  showProject: boolean
  onOpen: (item: XosViewItem) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!focusStageId) {
      return
    }
    setExpanded((current) => new Set(current).add(focusStageId))
    document
      .getElementById(`xos-stage-${focusStageId}`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [focusStageId])

  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {columns.map((column) => {
        const collapsed = column.stage.kind !== 'active' && !expanded.has(column.stage.id)
        if (collapsed) {
          return (
            <button
              key={column.stage.id}
              id={`xos-stage-${column.stage.id}`}
              type="button"
              onClick={() => setExpanded((current) => new Set(current).add(column.stage.id))}
              title={`Show ${column.stage.label}`}
              className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg border bg-muted/20 py-3 text-xs text-muted-foreground hover:bg-muted/40"
            >
              <ChevronRight className="size-3.5" />
              <span className="tabular-nums">{column.stage.count}</span>
              <span className="[writing-mode:vertical-rl]">{column.stage.label}</span>
            </button>
          )
        }
        return (
          <section
            key={column.stage.id}
            id={`xos-stage-${column.stage.id}`}
            className={[
              'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20 p-2',
              focusStageId === column.stage.id ? 'ring-2 ring-primary/60' : ''
            ].join(' ')}
          >
            <ColumnHeader column={column} />
            <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {column.items.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
              )}
              {column.items.map((item) => (
                <ItemCard key={item.path} item={item} showProject={showProject} onOpen={onOpen} />
              ))}
              {column.hidden > 0 && (
                <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
                  {column.hidden} older not shown
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function XosItemsListView({
  items,
  stageLabel,
  showProject,
  onOpen
}: {
  items: XosViewItem[]
  stageLabel: (item: XosViewItem) => string
  showProject: boolean
  onOpen: (item: XosViewItem) => void
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Stage</th>
            <th className="px-3 py-2 font-medium">Details</th>
            {showProject && <th className="px-3 py-2 font-medium">Project</th>}
            <th className="px-3 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.path}
              onClick={() => onOpen(item)}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
            >
              <td className="max-w-md truncate px-3 py-2 font-medium">{item.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {stageLabel(item)}
              </td>
              <td className="px-3 py-2">
                <ItemChips item={item} limit={4} />
              </td>
              {showProject && (
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {item.projectName}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {relativeTime(item.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">No items of this type.</p>
      )}
    </div>
  )
}
