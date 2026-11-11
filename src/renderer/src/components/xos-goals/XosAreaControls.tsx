// XOS fork: bulk controls for an area or a whole project: edit the area, and pause/resume every
// schedule under it after a preview of the exact crontab lines that will change (§3d, PF2).
import React, { useState } from 'react'
import { Pause, Pencil, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosCronJob, XosGoalArea, XosProject } from '../../../../shared/xos-goals-types'
import { XosAreaDialog } from './XosAreaDialog'
import { XosConfirmDialog, type XosConfirmRequest } from './XosConfirmDialog'
import type { XosGoalActions } from './XosGoalViewerParts'

function scopeJobs(project: XosProject, areaId: string | null): XosCronJob[] {
  const goals = areaId ? project.goals.filter((goal) => goal.area.id === areaId) : project.goals
  return [...goals.flatMap((goal) => goal.viewer.cron.jobs), ...(areaId ? [] : project.scripts)]
}

/** `area` null = the whole project. */
export function XosScopeControls({
  project,
  area,
  actions
}: {
  project: XosProject
  area: XosGoalArea | null
  actions: XosGoalActions
}): React.JSX.Element | null {
  const [confirm, setConfirm] = useState<XosConfirmRequest | null>(null)
  const [editing, setEditing] = useState(false)
  const jobs = scopeJobs(project, area?.id ?? null)
  const editable = area !== null && area.id !== 'unassigned'
  const active = jobs.filter((job) => !job.paused)
  const paused = jobs.filter((job) => job.paused)
  const scopeLabel = area ? area.title : project.name

  const ask = (pause: boolean): void => {
    const targets = pause ? active : paused
    setConfirm({
      title: `${pause ? 'Pause' : 'Resume'} everything in ${scopeLabel}?`,
      description: `${pause ? 'Comments out' : 'Restores'} ${targets.length} crontab line${targets.length === 1 ? '' : 's'}. A backup is taken first.`,
      preview: targets.map((job) => `${job.goal ?? job.name}: ${job.schedule}`),
      confirmLabel: pause ? 'Pause all' : 'Resume all',
      destructive: pause,
      onConfirm: () =>
        area
          ? actions.cron({
              kind: pause ? 'pause-area' : 'resume-area',
              projectKey: project.key,
              areaId: area.id
            })
          : actions.cron({
              kind: pause ? 'pause-project' : 'resume-project',
              projectKey: project.key
            })
    })
  }

  if (!editable && jobs.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-2">
      {active.length > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => ask(true)}>
          <Pause className="size-4" />
          Pause {area ? 'area' : 'project'}
        </Button>
      )}
      {paused.length > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => ask(false)}>
          <Play className="size-4" />
          Resume {paused.length}
        </Button>
      )}
      {editable && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit ${area.title}`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
        </Button>
      )}
      {editable && (
        <XosAreaDialog
          open={editing}
          area={area}
          project={project}
          actions={actions}
          onClose={() => setEditing(false)}
        />
      )}
      <XosConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
