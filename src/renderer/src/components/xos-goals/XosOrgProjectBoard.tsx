// XOS fork: one project's board: layout and filter toolbar, cards, and its scheduled scripts.
import React, { useMemo, useState } from 'react'
import { Filter, LayoutGrid, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { filterOptions, goalMatchesFilter, type OrgFilter } from './xos-org-hierarchy'
import { AreaGroups, filterIcon, OrgChart } from './XosOrgChartViews'
import { CronJobRow, type XosGoalActions } from './XosGoalViewerParts'
import type { Prefs } from './xos-org-prefs'

export function XosOrgProjectBoard({
  project,
  prefs,
  setPrefs,
  actions,
  setSelectedGoal
}: {
  project: XosProject
  prefs: Prefs
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>
  actions: XosGoalActions
  setSelectedGoal: (goal: string | null) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<OrgFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const projectGoals = project.goals
  const visibleGoals = useMemo(
    () => projectGoals.filter((goal: XosGoal) => goalMatchesFilter(goal, filter)),
    [projectGoals, filter]
  )
  const options = useMemo(() => filterOptions(projectGoals), [projectGoals])
  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Layout</p>
            <ToggleGroup
              type="single"
              value={prefs.layout}
              onValueChange={(value) => {
                if (value === 'chart' || value === 'areas') {
                  setPrefs((current) => ({ ...current, layout: value }))
                }
              }}
              variant="outline"
              className="mt-1 flex-wrap"
              aria-label="Board layout"
            >
              <ToggleGroupItem value="chart">
                <Network className="size-4" />
                Org chart
              </ToggleGroupItem>
              <ToggleGroupItem value="areas">
                <LayoutGrid className="size-4" />
                Business areas
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Filter</p>
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => {
                if (options.some((option) => option.value === value)) {
                  setFilter(value as OrgFilter)
                }
              }}
              variant="outline"
              className="mt-1 flex-wrap"
              aria-label="Goal filter"
            >
              {options.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {filterIcon(option.value)}
                  {option.label}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                    {option.count}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
          <Filter className="size-4 text-primary" />
          Showing {visibleGoals.length} of {projectGoals.length} goals
        </span>
      </section>
      {visibleGoals.length === 0 ? (
        <section className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm">
          <p className="font-semibold text-primary">No goals match this filter.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => setFilter('all')}>
            Reset filter
          </Button>
        </section>
      ) : prefs.layout === 'chart' ? (
        <OrgChart
          project={project}
          goals={visibleGoals}
          cardTheme={prefs.cardTheme}
          collapsed={collapsed}
          onToggle={(id) =>
            setCollapsed((current) => {
              const next = new Set(current)
              if (next.has(id)) {
                next.delete(id)
              } else {
                next.add(id)
              }
              return next
            })
          }
          onOpen={(goal) => setSelectedGoal(goal.goal)}
        />
      ) : (
        <AreaGroups
          project={project}
          goals={visibleGoals}
          cardTheme={prefs.cardTheme}
          onOpen={(goal) => setSelectedGoal(goal.goal)}
        />
      )}

      {project.scripts.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Scheduled scripts</h2>
            <p className="text-sm text-muted-foreground">
              Crontab jobs in {project.name} that are not goal runs (backups, syncs, deploys).
            </p>
          </div>
          {project.scripts.map((job) => (
            <CronJobRow key={job.id} job={job} actions={actions} />
          ))}
        </section>
      )}
    </>
  )
}
