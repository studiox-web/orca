// XOS fork: project-level §3d controls: new goal, new area, pause/resume the whole project, and
// the archived goals list (restore, or hard delete with a typed confirm).
import React, { useState } from 'react'
import { ArchiveRestore, FolderPlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosProject } from '../../../../shared/xos-goals-types'
import { XosAreaDialog } from './XosAreaDialog'
import { XosScopeControls } from './XosAreaControls'
import { XosConfirmDialog, type XosConfirmRequest } from './XosConfirmDialog'
import { XosNewGoalDialog } from './XosNewGoalDialog'
import { formatTimestamp } from './xos-format'
import type { XosGoalActions } from './XosGoalViewerParts'

export function XosProjectToolbar({
  project,
  actions,
  onCreated
}: {
  project: XosProject
  actions: XosGoalActions
  onCreated: (goal: string) => void
}): React.JSX.Element {
  const [newGoal, setNewGoal] = useState(false)
  const [newArea, setNewArea] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={() => setNewGoal(true)}>
        <Plus className="size-4" />
        New goal
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setNewArea(true)}>
        <FolderPlus className="size-4" />
        New area
      </Button>
      <XosScopeControls project={project} area={null} actions={actions} />
      <XosNewGoalDialog
        open={newGoal}
        project={project}
        actions={actions}
        onClose={() => setNewGoal(false)}
        onCreated={onCreated}
      />
      <XosAreaDialog
        open={newArea}
        area={null}
        project={project}
        actions={actions}
        onClose={() => setNewArea(false)}
      />
    </div>
  )
}

export function XosArchivedGoals({
  project,
  actions
}: {
  project: XosProject
  actions: XosGoalActions
}): React.JSX.Element | null {
  const [confirm, setConfirm] = useState<XosConfirmRequest | null>(null)
  if (project.archived.length === 0) {
    return null
  }
  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <h2 className="text-lg font-semibold tracking-normal">Archived goals</h2>
        <p className="text-sm text-muted-foreground">
          In automations/goals/_archive. Their schedules are paused; restoring keeps them paused.
        </p>
      </div>
      {project.archived.map((entry) => {
        const lines = project.scripts.filter((job) => job.goal === entry.goal)
        const busy = actions.busy === entry.goal
        return (
          <div
            key={entry.goal}
            className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{entry.title}</p>
              <p className="text-xs text-muted-foreground">
                {entry.goal}
                {entry.archivedAt ? ` · archived ${formatTimestamp(entry.archivedAt)}` : ''}
                {lines.length > 0
                  ? ` · ${lines.length} paused crontab line${lines.length === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void actions.goalOp(
                    { kind: 'restore', projectKey: project.key, archived: entry.goal },
                    entry.goal
                  )
                }
              >
                <ArchiveRestore className="size-4" />
                Restore
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive-chip"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: `Delete ${entry.title} for good?`,
                    description:
                      'Deletes the archived folder and removes its crontab lines. Git keeps the folder history if it was committed.',
                    preview: [
                      `delete folder: ${entry.path}`,
                      ...lines.map((job) => `remove line: ${job.schedule} ${job.command}`)
                    ],
                    confirmLabel: 'Delete goal',
                    destructive: true,
                    typedConfirm: entry.goal,
                    onConfirm: () =>
                      actions.goalOp(
                        {
                          kind: 'delete',
                          projectKey: project.key,
                          archived: entry.goal,
                          confirm: entry.goal
                        },
                        entry.goal
                      )
                  })
                }
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </div>
        )
      })}
      <XosConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
