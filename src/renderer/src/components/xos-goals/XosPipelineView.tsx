// XOS fork: Stage E Pipeline View (PL1–PL4, §3g.7).
// Renders the horizontal flow strip (Cascade goal cards joined by queue pipes with counts,
// floor/ceiling bands, and stuck-item age) above the clickable pipe Queue Board.
import React, { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, ExternalLink, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import {
  computePipelineFromGoals,
  type XosPipelinePipe
} from '../../../../shared/xos-pipeline-model'
import { useXosItems } from './use-xos-items'
import { relativeTime } from './xos-format'
import type { CardThemeSelection } from './xos-goal-card-logic'
import { XosGoalCard } from './XosGoalCard'
import { XosItemDrawer } from './XosItemDrawer'
import { XosItemsBoardView } from './XosItemsBoard'
import {
  buildColumns,
  isXosItemsSort,
  prettyGoal,
  selectedItems,
  selectedTypes,
  sortItems,
  stageTone,
  TONE_CLASS,
  type XosItemsSort,
  type XosViewItem
} from './xos-items-model'
import { openXosItemsInTasks } from './xos-items-source'

type PipeDescriptor = XosPipelinePipe

function buildTypePipes(
  project: XosProject,
  typeId: string,
  stageOrder: string[]
): PipeDescriptor[] {
  return computePipelineFromGoals(project.goals)
    .pipes.filter((pipe) => pipe.typeId === typeId)
    .sort((a, b) => {
      const [ia, ib] = [stageOrder.indexOf(a.stageId), stageOrder.indexOf(b.stageId)]
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.label.localeCompare(b.label)
    })
}

function PipeCard({
  pipe,
  active,
  onSelect,
  onOpenTasks
}: {
  pipe: PipeDescriptor
  active: boolean
  onSelect: () => void
  onOpenTasks: () => void
}): React.JSX.Element {
  const band =
    pipe.floor !== null || pipe.ceiling !== null
      ? `band ${pipe.floor ?? 0}–${pipe.ceiling ?? '∞'}`
      : 'unbounded'
  const countText = pipe.readyCount !== null ? `${pipe.readyCount}/${pipe.count}` : `${pipe.count}`
  const fromText = pipe.fromGoals.length ? pipe.fromGoals.map(prettyGoal).join(', ') : 'intake'
  const toText = pipe.toGoals.length ? pipe.toGoals.map(prettyGoal).join(', ') : 'terminal'
  return (
    <div
      className={[
        'flex w-52 shrink-0 flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-xs shadow-xs transition-colors',
        active
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border/70 hover:border-primary/40'
      ].join(' ')}
    >
      <button type="button" onClick={onSelect} className="space-y-1.5 text-left">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate font-semibold text-foreground">{pipe.label}</span>
          <span
            className={[
              'rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
              TONE_CLASS[pipe.tone]
            ].join(' ')}
          >
            {countText}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{band}</span>
          <span>·</span>
          <span className="capitalize">{pipe.status.replace('-', ' ')}</span>
        </div>
        {pipe.oldestAt && pipe.count > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {pipe.stuck && <AlertTriangle className="size-3 shrink-0 text-foreground" />}
            <span className="truncate">
              oldest {relativeTime(pipe.oldestAt)}
              {pipe.stuck ? ` (${pipe.oldestAgeHours}h stuck)` : ''}
            </span>
          </div>
        )}
      </button>
      <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">
          {fromText} → {toText}
        </span>
        <button
          type="button"
          onClick={onOpenTasks}
          title="Open stage in Tasks"
          className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-3" />
        </button>
      </div>
    </div>
  )
}

export function XosPipelineView({
  project,
  cardTheme,
  onSelectGoal
}: {
  project: XosProject
  cardTheme: CardThemeSelection
  onSelectGoal: (goal: XosGoal) => void
}): React.JSX.Element {
  const { snapshot } = useXosItems()
  const [typeId, setTypeId] = useState<string>('feature')
  const [focusStageId, setFocusStageId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<XosItemsSort>('updated')
  const [readyOnly, setReadyOnly] = useState(false)
  const [drawerItem, setDrawerItem] = useState<XosViewItem | null>(null)

  const types = useMemo(
    () => (snapshot ? selectedTypes(snapshot, project.key) : []),
    [snapshot, project.key]
  )
  const currentType = types.find((t) => t.id === typeId) ?? types[0] ?? null
  const activeType = currentType?.id ?? 'feature'
  const stageOrder = useMemo(() => currentType?.stages.map((s) => s.id) ?? [], [currentType])
  const pipes = useMemo(
    () => buildTypePipes(project, activeType, stageOrder),
    [project, activeType, stageOrder]
  )
  const goalByName = useMemo(() => new Map(project.goals.map((g) => [g.goal, g])), [project.goals])

  const flowNodes = useMemo(() => {
    const seen = new Set<string>()
    const nodes: ({ kind: 'goal'; goal: XosGoal } | { kind: 'pipe'; pipe: PipeDescriptor })[] = []
    const pushGoal = (name: string) => {
      const g = goalByName.get(name)
      if (g && !seen.has(name)) {
        seen.add(name)
        nodes.push({ kind: 'goal', goal: g })
      }
    }
    for (const pipe of pipes) {
      pipe.fromGoals.forEach(pushGoal)
      nodes.push({ kind: 'pipe', pipe })
      pipe.toGoals.forEach(pushGoal)
    }
    return nodes
  }, [pipes, goalByName])

  const projectStages = useMemo(() => currentType?.stages ?? [], [currentType])
  const projectItems = useMemo(() => {
    if (!snapshot) {
      return []
    }
    const q = search.trim().toLowerCase()
    const raw = selectedItems(snapshot, project.key, activeType).filter((item) => {
      if (readyOnly && !item.ready) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        item.title.toLowerCase().includes(q) ||
        (item.bucket ?? '').toLowerCase().includes(q) ||
        item.chips.some((c) => c.value.toLowerCase().includes(q))
      )
    })
    return sortItems(raw, sort)
  }, [snapshot, project.key, activeType, readyOnly, search, sort])

  const columns = useMemo(
    () => (currentType ? buildColumns(currentType, projectItems) : []),
    [currentType, projectItems]
  )
  const drawerStage = useMemo(
    () => (drawerItem ? (projectStages.find((s) => s.id === drawerItem.stageId) ?? null) : null),
    [drawerItem, projectStages]
  )

  const starvedCount = pipes.filter((p) => p.status === 'starved').length
  const backedUpCount = pipes.filter((p) => p.status === 'backed-up').length
  const healthyCount = pipes.filter((p) => p.status === 'healthy').length
  const stuckCount = pipes.filter((p) => p.stuck).length
  const changeSort = (value: string): void => {
    if (isXosItemsSort(value)) {
      setSort(value)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Layers className="size-4 text-muted-foreground" />
          {(types.length ? types : [{ id: 'feature', label: 'Features', stages: [] }]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTypeId(t.id)
                setFocusStageId(null)
              }}
              className={[
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                activeType === t.id
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-transparent bg-muted/30 text-muted-foreground hover:text-foreground'
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="xos-chip xos-tone-success">{healthyCount} healthy</span>
          {starvedCount > 0 && (
            <span className="xos-chip xos-tone-warning">{starvedCount} starved</span>
          )}
          {backedUpCount > 0 && (
            <span className="xos-chip xos-tone-danger">{backedUpCount} backed up</span>
          )}
          {stuckCount > 0 && (
            <span className="xos-chip xos-tone-warning">{stuckCount} stuck &gt;72h</span>
          )}
        </div>
      </div>

      <section className="space-y-2 rounded-lg border bg-muted/15 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Goal &amp; Queue Flow Strip
          </h3>
          {focusStageId && (
            <Button variant="ghost" size="sm" onClick={() => setFocusStageId(null)}>
              Clear pipe focus ({focusStageId})
            </Button>
          )}
        </div>
        {flowNodes.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No declared queue pipes for this item type.
          </p>
        ) : (
          <div className="scrollbar-sleek flex items-stretch gap-2.5 overflow-x-auto pb-2">
            {flowNodes.map((node, idx) => (
              <React.Fragment
                key={node.kind === 'goal' ? `g:${node.goal.goal}` : `p:${node.pipe.id}`}
              >
                {idx > 0 && (
                  <div className="flex shrink-0 items-center text-muted-foreground/60">
                    <ArrowRight className="size-4" />
                  </div>
                )}
                {node.kind === 'goal' ? (
                  <div className="w-72 shrink-0">
                    <XosGoalCard
                      item={node.goal}
                      projectKey={project.key}
                      cardTheme={cardTheme}
                      onOpen={onSelectGoal}
                    />
                  </div>
                ) : (
                  <PipeCard
                    pipe={node.pipe}
                    active={focusStageId === node.pipe.stageId}
                    onSelect={() =>
                      setFocusStageId((cur) =>
                        cur === node.pipe.stageId ? null : node.pipe.stageId
                      )
                    }
                    onOpenTasks={() =>
                      openXosItemsInTasks({
                        projectKey: project.key,
                        typeId: activeType,
                        stageId: node.pipe.stageId
                      })
                    }
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Queue Board
            </h3>
            {projectStages.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFocusStageId((cur) => (cur === s.id ? null : s.id))}
                className={[
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  focusStageId === s.id ? 'ring-1 ring-primary' : '',
                  TONE_CLASS[stageTone(s)]
                ].join(' ')}
              >
                {s.label}: {s.readyCount !== null ? `${s.readyCount}/${s.count}` : s.count}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter queue items..."
              className="w-48"
            />
            <Select value={sort} onValueChange={changeSort}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Recently updated</SelectItem>
                <SelectItem value="created">Newest</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={readyOnly ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setReadyOnly((v) => !v)}
            >
              Ready only
            </Button>
          </div>
        </div>
        <XosItemsBoardView
          columns={columns}
          focusStageId={focusStageId}
          showProject={false}
          onOpen={(item) => setDrawerItem(item)}
        />
      </section>

      <XosItemDrawer item={drawerItem} stage={drawerStage} onClose={() => setDrawerItem(null)} />
    </div>
  )
}
