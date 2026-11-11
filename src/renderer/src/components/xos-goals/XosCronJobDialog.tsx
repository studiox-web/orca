// XOS fork: edit a legacy crontab line (schedule + command, or remove it), or add a schedule to a
// goal. Main validates and writes through the guarded crontab path; this only collects input.
import React, { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { XosCronJob, XosGoal } from '../../../../shared/xos-goals-types'
import type { XosGoalActions } from './XosGoalViewerParts'

export type XosCronDialogTarget =
  | { mode: 'edit'; job: XosCronJob }
  | { mode: 'add'; projectKey: string; goal: XosGoal }

const RUNNERS = ['codex', 'claude', 'gemini']
const SCHEDULE_HINT = 'minute hour day month weekday, e.g. "25 10 * * *" (10:25 daily) or @daily'

export function XosCronJobDialog({
  target,
  actions,
  onClose
}: {
  target: XosCronDialogTarget | null
  actions: XosGoalActions
  onClose: () => void
}): React.JSX.Element {
  const [schedule, setSchedule] = useState('')
  const [command, setCommand] = useState('')
  const [runner, setRunner] = useState('codex')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, setPending] = useState(false)

  const targetKey =
    target?.mode === 'edit'
      ? `edit:${target.job.id}`
      : target
        ? `add:${target.projectKey}:${target.goal.goal}`
        : null
  // Reset the form when a different line/goal opens (not on every board refresh).
  useEffect(() => {
    setConfirmRemove(false)
    if (target?.mode === 'edit') {
      setSchedule(target.job.schedule)
      setCommand(target.job.command)
    } else if (target?.mode === 'add') {
      setSchedule('0 9 * * *')
      setRunner(RUNNERS.find((name) => target.goal.viewer.agents.includes(name)) ?? 'codex')
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target's identity
  }, [targetKey])

  const submit = (work: () => Promise<boolean>): void => {
    setPending(true)
    void work().then((ok) => {
      setPending(false)
      if (ok) {
        onClose()
      }
    })
  }

  const save = (): void => {
    if (target?.mode === 'edit') {
      submit(() =>
        actions.cron({ kind: 'edit-job', jobId: target.job.id, schedule, command }, target.job.id)
      )
    } else if (target?.mode === 'add') {
      submit(() =>
        actions.cron(
          {
            kind: 'add-goal-schedule',
            projectKey: target.projectKey,
            goal: target.goal.goal,
            schedule,
            runner
          },
          target.goal.goal
        )
      )
    }
  }

  const title =
    target?.mode === 'add'
      ? `Schedule ${target.goal.title}`
      : `Edit ${target?.job.goal ?? target?.job.name ?? 'crontab line'}`

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target?.mode === 'add'
              ? 'Adds a crontab line (marked "orca-xos managed") that runs this goal like its siblings.'
              : 'Saves straight to your crontab. A backup is taken first, and the save is refused if the crontab changed since the board loaded.'}
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Schedule</span>
          <Input
            id="xos-cron-schedule"
            name="xos-cron-schedule"
            variant="code"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
          />
          <span className="text-muted-foreground">{SCHEDULE_HINT}</span>
        </label>
        {target?.mode === 'edit' ? (
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Command</span>
            <Textarea
              id="xos-cron-command"
              name="xos-cron-command"
              variant="code"
              className="min-h-28"
              value={command}
              onChange={(event) => setCommand(event.target.value.replace(/\r?\n/g, ' '))}
            />
          </label>
        ) : (
          <div className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Runner</span>
            <Select value={runner} onValueChange={setRunner}>
              <SelectTrigger className="w-40" aria-label="Runner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
                {RUNNERS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          {target?.mode === 'edit' ? (
            <Button
              type="button"
              variant={confirmRemove ? 'destructive' : 'destructive-chip'}
              disabled={pending}
              onClick={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true)
                  return
                }
                submit(() => actions.cron({ kind: 'remove-job', jobId: target.job.id }))
              }}
            >
              <Trash2 className="size-4" />
              {confirmRemove ? 'Click again to remove the line' : 'Remove line'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !schedule.trim()} onClick={save}>
              {target?.mode === 'add' ? 'Add schedule' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
