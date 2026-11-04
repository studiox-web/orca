// XOS fork: Tasks → Goals (§3h stage 0 & §3h.2 CRUD): features, bugs and content as a PM board over
// the legacy or imported repo folders with item creation, drag-and-drop stage moves, and drawer editing.
import React, { useMemo, useState } from 'react'
import { Columns3, List, Plus, RefreshCw, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { XosItemDrawer } from './XosItemDrawer'
import { XosItemsBoardView, XosItemsListView } from './XosItemsBoard'
import {
  ALL_PROJECTS,
  buildColumns,
  selectedItems,
  selectedTypes,
  sortItems,
  type XosItemsSort,
  type XosViewItem
} from './xos-items-model'
import {
  readSharedProjectKey,
  setXosItemsView,
  useXosItemsView,
  writeSharedProjectKey
} from './xos-items-source'
import { useXosItems } from './use-xos-items'
import './xos-ops-cards.css'

const SORTS: { id: XosItemsSort; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'created', label: 'Newest' },
  { id: 'priority', label: 'Priority' },
  { id: 'title', label: 'Title' }
]

function isItemsSort(value: string): value is XosItemsSort {
  return SORTS.some((s) => s.id === value)
}

export function XosItemsPage(): React.JSX.Element {
  const view = useXosItemsView()
  const { snapshot, loading, error, refresh } = useXosItems()
  const [storedProject, setStoredProject] = useState(readSharedProjectKey)
  const [sort, setSort] = useState<XosItemsSort>('updated')
  const [openItemPath, setOpenItemPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newStageId, setNewStageId] = useState<string>('')
  const [newPriority, setNewPriority] = useState<string>('medium')
  const [newReady, setNewReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const projects = snapshot?.projects ?? []
  const projectKey = projects.some((project) => project.projectKey === storedProject)
    ? storedProject
    : ALL_PROJECTS
  const types = useMemo(
    () => (snapshot ? selectedTypes(snapshot, projectKey) : []),
    [snapshot, projectKey]
  )
  const type = types.find((candidate) => candidate.id === view.typeId) ?? types[0] ?? null
  const items = useMemo(
    () => (snapshot && type ? selectedItems(snapshot, projectKey, type.id) : []),
    [snapshot, projectKey, type]
  )
  const columns = useMemo(() => (type ? buildColumns(type, items) : []), [type, items])
  const stageById = new Map(type?.stages.map((stage) => [stage.id, stage]) ?? [])
  const showProject = projectKey === ALL_PROJECTS && projects.length > 1
  const openItem = useMemo(
    () => (openItemPath ? (items.find((i) => i.path === openItemPath) ?? null) : null),
    [items, openItemPath]
  )

  const chooseProject = (key: string): void => {
    setStoredProject(key)
    writeSharedProjectKey(key)
  }

  const handleCreateItem = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!type || !newTitle.trim() || !window.api.xosGoals?.mutateItem) {
      return
    }
    const targetProjectKey =
      projectKey === ALL_PROJECTS ? (projects[0]?.projectKey ?? '') : projectKey
    if (!targetProjectKey) {
      toast.error('Select a project first.')
      return
    }
    setBusy(true)
    try {
      const res = await window.api.xosGoals.mutateItem({
        kind: 'create',
        projectKey: targetProjectKey,
        typeId: type.id,
        stageId: newStageId || type.stages[0]?.id,
        title: newTitle.trim(),
        priority: newPriority === 'none' ? undefined : newPriority,
        ready: newReady
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(res.message)
      setNewTitle('')
      setCreating(false)
      await refresh()
      if (res.path) {
        setOpenItemPath(res.path)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleMoveItem = async (path: string, toStageId: string): Promise<void> => {
    const existing = items.find((i) => i.path === path)
    if (!existing || existing.stageId === toStageId || !window.api.xosGoals?.mutateItem) {
      return
    }
    const res = await window.api.xosGoals.mutateItem({ kind: 'move', path, toStageId })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.message)
    await refresh()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={projectKey} onValueChange={chooseProject}>
          <SelectTrigger size="sm" className="w-48" aria-label="Project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.projectKey} value={project.projectKey}>
                {project.projectName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Item type">
          {types.map((candidate) => {
            const total = candidate.stages
              .filter((stage) => stage.kind === 'active')
              .reduce((sum, stage) => sum + stage.count, 0)
            const active = candidate.id === type?.id
            return (
              <Button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={active}
                size="sm"
                variant={active ? 'secondary' : 'ghost'}
                onClick={() => setXosItemsView({ typeId: candidate.id, focusStageId: null })}
              >
                {candidate.label}
                <span className="tabular-nums text-muted-foreground">{total}</span>
              </Button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {type && (
            <Button
              type="button"
              size="sm"
              variant={creating ? 'secondary' : 'outline'}
              onClick={() => setCreating((v) => !v)}
            >
              <Plus className="size-3.5" />
              New item
            </Button>
          )}
          {view.layout === 'list' && (
            <Select
              value={sort}
              onValueChange={(value) => {
                if (isItemsSort(value)) {
                  setSort(value)
                }
              }}
            >
              <SelectTrigger size="sm" className="w-44" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant={view.layout === 'board' ? 'secondary' : 'ghost'}
            aria-label="Board"
            onClick={() => setXosItemsView({ layout: 'board' })}
          >
            <Columns3 className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={view.layout === 'list' ? 'secondary' : 'ghost'}
            aria-label="List"
            onClick={() => setXosItemsView({ layout: 'list' })}
          >
            <List className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
        </div>
      </div>
      {creating && type && (
        <form
          onSubmit={(e) => void handleCreateItem(e)}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2.5 text-xs"
        >
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Work item title…"
            density="compact"
            className="min-w-52 flex-1"
          />
          <Select value={newStageId || type.stages[0]?.id || ''} onValueChange={setNewStageId}>
            <SelectTrigger
              size="sm"
              density="compact"
              className="h-7 w-40"
              aria-label="Initial stage"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {type.stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={newPriority} onValueChange={setNewPriority}>
            <SelectTrigger
              size="sm"
              density="compact"
              className="h-7 w-28"
              aria-label="Initial priority"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No priority</SelectItem>
              <SelectItem value="critical">critical</SelectItem>
              <SelectItem value="high">high</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="low">low</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={newReady}
              onChange={(e) => setNewReady(e.target.checked)}
            />
            Ready
          </label>
          <Button type="submit" size="sm" disabled={busy || !newTitle.trim()}>
            Create
          </Button>
        </form>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Workflow className="size-3.5" />
        Work items your goals move through their queues. Drag cards between stages or click an item
        to edit fields and view its transition timeline.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!snapshot && !error && <p className="text-sm text-muted-foreground">Loading items…</p>}
      {snapshot && !type && (
        <p className="text-sm text-muted-foreground">
          No work-item folders found. Goal projects with docs/features, docs/bugs or content/ queues
          show up here.
        </p>
      )}
      {type &&
        (view.layout === 'board' ? (
          <XosItemsBoardView
            columns={columns}
            focusStageId={view.focusStageId}
            showProject={showProject}
            onOpen={(item: XosViewItem) => setOpenItemPath(item.path)}
            onMoveItem={(path, toStageId) => void handleMoveItem(path, toStageId)}
          />
        ) : (
          <XosItemsListView
            items={sortItems(items, sort)}
            stageLabel={(item) =>
              `${stageById.get(item.stageId)?.label ?? item.stageId}${item.bucket ? ` · ${item.bucket}` : ''}`
            }
            showProject={showProject}
            onOpen={(item: XosViewItem) => setOpenItemPath(item.path)}
          />
        ))}
      <XosItemDrawer
        item={openItem}
        stage={openItem ? (stageById.get(openItem.stageId) ?? null) : null}
        stages={type?.stages ?? []}
        onClose={() => setOpenItemPath(null)}
        onMutated={() => void refresh()}
      />
    </div>
  )
}
