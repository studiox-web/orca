// XOS fork: the two board layouts (org chart branches, business-area grid) built from goal cards.
import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  LayoutGrid,
  Mail,
  Pause,
  RefreshCw,
  TriangleAlert
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { XosGoalCard } from './XosGoalCard'
import {
  areaHealth,
  buildOrgHierarchy,
  type AreaHealth,
  type OrgChartNode,
  type OrgFilter
} from './xos-org-hierarchy'
import type { CardThemeSelection } from './xos-goal-card-logic'

export function HealthBadge({ health }: { health: AreaHealth }): React.JSX.Element {
  return <span className={`xos-chip xos-tone-${health.tone}`}>{health.label}</span>
}

export function filterIcon(filter: OrgFilter): React.JSX.Element {
  if (filter === 'attention' || filter === 'issues') {
    return <TriangleAlert className="size-4" />
  }
  if (filter === 'warnings') {
    return <CircleCheck className="size-4" />
  }
  if (filter === 'messages') {
    return <Mail className="size-4" />
  }
  if (filter === 'running') {
    return <RefreshCw className="size-4" />
  }
  if (filter === 'paused') {
    return <Pause className="size-4" />
  }
  return <LayoutGrid className="size-4" />
}

function CardGrid({
  goals,
  project,
  cardTheme,
  onOpen
}: {
  goals: XosGoal[]
  project: XosProject
  cardTheme: CardThemeSelection
  onOpen: (goal: XosGoal) => void
}): React.JSX.Element {
  return (
    <div className="grid justify-center gap-4 sm:grid-cols-[repeat(auto-fill,18rem)] sm:justify-start">
      {goals.map((goal) => (
        <XosGoalCard
          key={goal.goal}
          item={goal}
          projectKey={project.key}
          cardTheme={cardTheme}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

/** Director card on top, then one branch per business area: its manager first, then its workers. */
export function OrgChart({
  project,
  goals,
  cardTheme,
  collapsed,
  onToggle,
  onOpen
}: {
  project: XosProject
  goals: XosGoal[]
  cardTheme: CardThemeSelection
  collapsed: Set<string>
  onToggle: (id: string) => void
  onOpen: (goal: XosGoal) => void
}): React.JSX.Element {
  const root = buildOrgHierarchy(goals, project.name)
  const directReports = root.children.filter(
    (node) => node.kind !== 'group' && node.children.length === 0
  )
  const branches = root.children.filter((node) => !directReports.includes(node))
  const branchItems = (node: OrgChartNode): XosGoal[] =>
    [node.item, ...node.children.map((child) => child.item)].filter(
      (goal): goal is XosGoal => goal !== null
    )

  return (
    <div className="space-y-4">
      {(root.item || directReports.length > 0) && (
        <section className="xos-panel-lead space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-normal">
              {root.item?.area.title ?? 'Leadership'}
            </h2>
            <span className="text-sm text-muted-foreground">
              {root.counts.cards} goals report up here · {root.counts.attention} need attention
            </span>
          </div>
          <CardGrid
            goals={[root.item, ...directReports.map((node) => node.item)].filter(
              (goal): goal is XosGoal => goal !== null
            )}
            project={project}
            cardTheme={cardTheme}
            onOpen={onOpen}
          />
        </section>
      )}
      <div className="space-y-4 border-l-2 border-primary/30 pl-4 sm:ml-4">
        {branches.map((node) => {
          const items = branchItems(node)
          const isCollapsed = collapsed.has(node.id)
          const area = items[0]?.area
          return (
            <section key={node.id} className="relative space-y-3 rounded-lg border bg-muted/20 p-4">
              <span
                className="absolute -left-[1.1rem] top-7 h-0.5 w-4 bg-primary/30"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.title}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => onToggle(node.id)}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </Button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-normal">
                        {area?.title ?? node.title}
                      </h2>
                      <HealthBadge health={areaHealth(items)} />
                    </div>
                    {area?.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      {node.kind === 'manager' ? `Manager: ${node.item?.title}` : 'No manager goal'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pl-10 sm:pl-0">
                  <Badge variant="secondary">
                    {node.counts.cards} goal{node.counts.cards === 1 ? '' : 's'}
                  </Badge>
                  {node.counts.attention > 0 && (
                    <span className="xos-chip xos-tone-warning">
                      {node.counts.attention} attention
                    </span>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <CardGrid goals={items} project={project} cardTheme={cardTheme} onOpen={onOpen} />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function AreaGroups({
  project,
  goals,
  cardTheme,
  onOpen
}: {
  project: XosProject
  goals: XosGoal[]
  cardTheme: CardThemeSelection
  onOpen: (goal: XosGoal) => void
}): React.JSX.Element {
  const groups = [...new Map(goals.map((goal) => [goal.area.id, goal.area])).values()].map(
    (area) => ({
      area,
      items: goals.filter((goal) => goal.area.id === area.id)
    })
  )
  return (
    <div className="space-y-5">
      {groups.map(({ area, items }) => (
        <section
          key={area.id}
          className={[
            'space-y-4 rounded-lg border p-4',
            area.id === 'c-suite' ? 'xos-panel-lead' : 'bg-muted/20'
          ].join(' ')}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-normal">{area.title}</h2>
                <HealthBadge health={areaHealth(items)} />
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{area.description}</p>
              {area.manager && (
                <p className="mt-2 text-xs font-semibold text-muted-foreground">
                  Manager process: {area.manager}
                </p>
              )}
            </div>
            <span
              className={
                area.id === 'c-suite' ? 'xos-chip c-suite-foil-badge' : 'xos-chip xos-tone-neutral'
              }
            >
              {items.length} goal{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <CardGrid goals={items} project={project} cardTheme={cardTheme} onOpen={onOpen} />
        </section>
      ))}
    </div>
  )
}
