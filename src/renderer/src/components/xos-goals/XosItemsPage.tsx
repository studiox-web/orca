// XOS fork: Tasks → Goals (§3h stage 0): features, bugs and content as a PM board over the legacy
// repo folders. Read-only for now; it shares the project choice with Automations → Org chart.
import React, { useMemo, useState } from 'react'
import { Columns3, List, RefreshCw, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export function XosItemsPage(): React.JSX.Element {
  const view = useXosItemsView()
  const { snapshot, loading, error, refresh } = useXosItems()
  const [storedProject, setStoredProject] = useState(readSharedProjectKey)
  const [sort, setSort] = useState<XosItemsSort>('updated')
  const [openItem, setOpenItem] = useState<XosViewItem | null>(null)

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

  const chooseProject = (key: string): void => {
    setStoredProject(key)
    writeSharedProjectKey(key)
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
          {view.layout === 'list' && (
            <Select value={sort} onValueChange={(value) => setSort(value as XosItemsSort)}>
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
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Workflow className="size-3.5" />
        Work items your goals move through their queues. Read-only for now: open an item in the
        editor to change it.
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
            onOpen={setOpenItem}
          />
        ) : (
          <XosItemsListView
            items={sortItems(items, sort)}
            stageLabel={(item) =>
              `${stageById.get(item.stageId)?.label ?? item.stageId}${item.bucket ? ` · ${item.bucket}` : ''}`
            }
            showProject={showProject}
            onOpen={setOpenItem}
          />
        ))}
      <XosItemDrawer
        item={openItem}
        stage={openItem ? (stageById.get(openItem.stageId) ?? null) : null}
        onClose={() => setOpenItem(null)}
      />
    </div>
  )
}
