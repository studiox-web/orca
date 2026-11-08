// XOS fork: Automations → Org chart. Stage 0 of xos/PLAN.md: one central board over the existing
// goal folders, run receipts and crontab, with an "All projects" switcher, Cascade's cards, the
// Goal Viewer, and pause/resume/run now. Ported from DJVibe's operations.tsx.
import React, { useEffect, useState } from 'react'
import { FolderKanban } from 'lucide-react'
import { XosGoalViewer } from './XosGoalViewer'
import { XosOrgChartHeader } from './XosOrgChartHeader'
import { XosOrgProjectBoard } from './XosOrgProjectBoard'
import { PortfolioTiles, RunningStrip, XosPortfolioRollupView } from './XosPortfolio'
import { PREFS_KEY, readPrefs, type Prefs } from './xos-org-prefs'
import { useXosGoalActions } from './use-xos-goal-actions'
import { useXosGoalBoard } from './use-xos-goal-board'
import { XosNewGoalDialog } from './XosNewGoalDialog'
import './xos-ops-cards.css'

export function XosOrgChartPage({
  onShowList,
  initialTarget = null,
  onInitialTargetConsumed
}: {
  onShowList: () => void
  initialTarget?: { projectKey: string; goal: string | null; create?: boolean } | null
  onInitialTargetConsumed?: () => void
}): React.JSX.Element {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const stored = readPrefs()
    return initialTarget ? { ...stored, projectKey: initialTarget.projectKey } : stored
  })
  const [selectedGoal, setSelectedGoal] = useState<string | null>(initialTarget?.goal ?? null)
  const [newGoalOpen, setNewGoalOpen] = useState(initialTarget?.create === true)
  const { board, loading, error, hidden, refresh } = useXosGoalBoard()
  const project = board?.projects.find((candidate) => candidate.key === prefs.projectKey) ?? null
  const selected = project?.goals.find((goal) => goal.goal === selectedGoal) ?? null
  const actions = useXosGoalActions(board, project, refresh)

  useEffect(() => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  }, [prefs])

  useEffect(() => {
    if (initialTarget) {
      onInitialTargetConsumed?.()
    }
  }, [initialTarget, onInitialTargetConsumed])

  const selectProject = (key: string): void => {
    setPrefs((current) => ({ ...current, projectKey: key }))
    setSelectedGoal(null)
  }

  return (
    <main
      className="xos-ops-cards relative scrollbar-sleek flex h-full min-h-0 flex-col overflow-y-auto"
      data-animations-paused={hidden ? '' : undefined}
    >
      <div className="space-y-5 px-4 pb-10 pt-5 md:px-6 md:pt-6">
        <XosOrgChartHeader
          board={board}
          project={project}
          selected={selected}
          prefs={prefs}
          setPrefs={setPrefs}
          loading={loading}
          refresh={refresh}
          selectProject={selectProject}
          setSelectedGoal={setSelectedGoal}
          onShowList={onShowList}
        />
        {error && (
          <p className="xos-tone-danger rounded-lg border p-3 text-sm">
            Could not load the board: {error}
          </p>
        )}
        {board?.warnings.map((warning) => (
          <p key={warning} className="xos-tone-warning rounded-lg border p-3 text-sm">
            {warning}
          </p>
        ))}
        {board && (
          <RunningStrip
            board={board}
            onOpen={(target, goal) => {
              setPrefs((current) => ({ ...current, projectKey: target.key }))
              setSelectedGoal(goal.goal)
            }}
          />
        )}
        {project ? (
          <XosNewGoalDialog
            open={newGoalOpen}
            project={project}
            actions={actions}
            onClose={() => setNewGoalOpen(false)}
            onCreated={(goal) => setSelectedGoal(goal)}
          />
        ) : null}
        {!board ? null : !project ? (
          board.projects.length === 0 ? (
            <section className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <FolderKanban className="mx-auto mb-2 size-6" />
              No project with an <code>automations/goals</code> folder was found in Orca or the
              crontab.
            </section>
          ) : (
            <>
              <PortfolioTiles board={board} onSelect={selectProject} />
              <XosPortfolioRollupView onSelect={selectProject} />
            </>
          )
        ) : selected ? (
          <XosGoalViewer
            item={selected}
            project={project}
            cardTheme={prefs.cardTheme}
            actions={actions}
            onBack={() => setSelectedGoal(null)}
          />
        ) : (
          <XosOrgProjectBoard
            key={project.key}
            project={project}
            prefs={prefs}
            setPrefs={setPrefs}
            actions={actions}
            setSelectedGoal={setSelectedGoal}
          />
        )}
      </div>
    </main>
  )
}
