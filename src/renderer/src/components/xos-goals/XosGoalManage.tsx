// XOS fork: §3d goal management in the Goal Viewer: move to another area, add a schedule, archive.
import React, { useState } from 'react'
import { Archive, CalendarPlus, FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { XosConfirmDialog, type XosConfirmRequest } from './XosConfirmDialog'
import { XosCronJobDialog } from './XosCronJobDialog'
import type { XosGoalActions } from './XosGoalViewerParts'

const NO_AREA = '__none__'

export function XosGoalManage({
  item,
  project,
  actions,
  onArchived
}: {
  item: XosGoal
  project: XosProject
  actions: XosGoalActions
  onArchived: () => void
}): React.JSX.Element {
  const [scheduling, setScheduling] = useState(false)
  const [confirm, setConfirm] = useState<XosConfirmRequest | null>(null)
  const busy = actions.busy === item.goal
  const areaValue = project.areas.some((area) => area.id === item.area.id) ? item.area.id : NO_AREA

  const archive = (): void => {
    const lines = item.viewer.cron.jobs.filter((job) => !job.paused)
    setConfirm({
      title: `Archive ${item.title}?`,
      description: `Moves automations/goals/${item.goal} to goals/_archive and pauses its schedule. Its files and run history stay; restore it any time from Archived goals.`,
      preview: lines.map((job) => `pause: ${job.schedule} ${job.command}`),
      confirmLabel: 'Archive goal',
      destructive: true,
      onConfirm: async () => {
        const ok = await actions.goalOp(
          { kind: 'archive', projectKey: project.key, goal: item.goal },
          item.goal
        )
        if (ok) {
          onArchived()
        }
        return ok
      }
    })
  }

  return (
    <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">Business area</p>
        <Select
          value={areaValue}
          disabled={busy}
          onValueChange={(value) => {
            void actions.goalOp(
              {
                kind: 'set-area',
                projectKey: project.key,
                goal: item.goal,
                areaId: value === NO_AREA ? null : value
              },
              item.goal
            )
          }}
        >
          <SelectTrigger className="w-56" aria-label="Business area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
            {project.areas.map((area) => (
              <SelectItem key={area.id} value={area.id}>
                {area.title}
              </SelectItem>
            ))}
            <SelectItem value={NO_AREA}>Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => setScheduling(true)}
      >
        <CalendarPlus className="size-4" />
        Add schedule
      </Button>
      {project.goalsDir.startsWith(project.root) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void actions.goalOp({ kind: 'import-project', projectKey: project.key }, item.goal)
          }}
        >
          <FolderInput className="size-4" />
          Import to ~/.orca-xos
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="destructive-chip"
        disabled={busy || item.running !== null}
        onClick={archive}
      >
        <Archive className="size-4" />
        Archive
      </Button>
      {project.orgSource === 'default' && (
        <p className="basis-full text-xs text-muted-foreground">
          This project uses the built-in areas. Changing an area writes them to
          ~/.orca-xos/projects/…/org.json first.
        </p>
      )}
      <XosCronJobDialog
        target={scheduling ? { mode: 'add', projectKey: project.key, goal: item } : null}
        actions={actions}
        onClose={() => setScheduling(false)}
      />
      <XosConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
