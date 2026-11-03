// XOS fork: Org chart header: breadcrumb, project switcher, card theme, refresh, list view.
import React from 'react'
import { ChevronRight, List, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { XosGoal, XosGoalBoard, XosProject } from '../../../../shared/xos-goals-types'
import type { CardThemeSelection } from './xos-goal-card-logic'
import { formatTimestamp } from './xos-format'
import { ALL, type Prefs } from './xos-org-prefs'

export function XosOrgChartHeader({
  board,
  project,
  selected,
  prefs,
  setPrefs,
  loading,
  refresh,
  selectProject,
  setSelectedGoal,
  onShowList
}: {
  board: XosGoalBoard | null
  project: XosProject | null
  selected: XosGoal | null
  prefs: Prefs
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>
  loading: boolean
  refresh: () => Promise<void>
  selectProject: (key: string) => void
  setSelectedGoal: (goal: string | null) => void
  onShowList: () => void
}): React.JSX.Element {
  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <nav
          className="flex items-center gap-1 text-sm text-muted-foreground"
          aria-label="Breadcrumb"
        >
          <span>Automations</span>
          <ChevronRight className="size-3" />
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => selectProject(ALL)}
          >
            All projects
          </button>
          {project && (
            <>
              <ChevronRight className="size-3" />
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => setSelectedGoal(null)}
              >
                {project.name}
              </button>
            </>
          )}
          {selected && (
            <>
              <ChevronRight className="size-3" />
              <span className="text-foreground">{selected.title}</span>
            </>
          )}
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-normal">
          {project ? `${project.name} org chart` : 'All projects'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {board ? `Updated ${formatTimestamp(board.generatedAt)}` : 'Loading…'}
          {project &&
            project.orgSource === 'default' &&
            ' · areas from the built-in defaults (add org.json to customize)'}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Project</span>
          <Select value={project ? project.key : ALL} onValueChange={selectProject}>
            <SelectTrigger className="w-48" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {board?.projects.map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Theme</span>
          <Select
            value={prefs.cardTheme.theme}
            onValueChange={(theme) =>
              setPrefs((current) => ({
                ...current,
                cardTheme: {
                  ...current.cardTheme,
                  theme: theme as CardThemeSelection['theme']
                }
              }))
            }
          >
            <SelectTrigger className="w-40" aria-label="Card theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="noir">Cyberpunk noir</SelectItem>
              <SelectItem value="corporate">Corporate</SelectItem>
              <SelectItem value="retreat">Yoga retreat</SelectItem>
              <SelectItem value="festival">Festival</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Images</span>
          <Select
            value={prefs.cardTheme.imageMode}
            onValueChange={(imageMode) =>
              setPrefs((current) => ({
                ...current,
                cardTheme: {
                  ...current.cardTheme,
                  imageMode: imageMode === 'light' ? 'light' : 'dark'
                }
              }))
            }
          >
            <SelectTrigger className="w-28" aria-label="Card image mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
        <Button type="button" variant="outline" onClick={onShowList}>
          <List />
          Automations list
        </Button>
      </div>
    </header>
  )
}
