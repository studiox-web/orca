// XOS fork: Goal Viewer building blocks (tiles, facts, collapsibles, crontab rows) and its action contract.
import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Pause, Play, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { XosCronJob, XosGoal } from '../../../../shared/xos-goals-types'
import { formatTimestamp, relativeTime } from './xos-format'

export type XosGoalActions = {
  busy: string | null
  runGoal: (goal: XosGoal) => void
  setGoalPaused: (goal: XosGoal, paused: boolean) => void
  runJob: (job: XosCronJob) => void
  setJobPaused: (job: XosCronJob, paused: boolean) => void
  openFile: (path: string) => void
}

export function StatusBadge({ value }: { value: string }): React.JSX.Element {
  const lower = value.toLowerCase()
  const tone =
    lower.includes('success') || lower.includes('pass') || lower.includes('finished')
      ? 'success'
      : lower.includes('fail') || lower.includes('error') || lower.includes('blocked')
        ? 'danger'
        : 'warning'
  return <span className={`xos-chip xos-tone-${tone}`}>{value}</span>
}

export function DetailTile({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold" title={value}>
        {value}
      </p>
      {detail && (
        <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      )}
    </div>
  )
}

export function GoalFact({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon
  label: string
  value: string | null
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background/60 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium">{value ?? 'Unavailable'}</dd>
      </div>
    </div>
  )
}

export function Collapsible({
  title,
  summary,
  children
}: {
  title: string
  summary: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-lg border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && <div className="border-t p-3">{children}</div>}
    </section>
  )
}

export function CronJobRow({
  job,
  actions
}: {
  job: XosCronJob
  actions: XosGoalActions
}): React.JSX.Element {
  const busy = actions.busy === job.id
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{job.schedule}</code>
          <span className="truncate">{job.goal ?? job.name}</span>
          {job.paused && <span className="xos-chip xos-tone-warning">Paused</span>}
        </p>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={job.command}>
          {job.command}
        </p>
        {!job.paused && job.nextRunAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            Next {formatTimestamp(job.nextRunAt)} ({relativeTime(job.nextRunAt)})
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => actions.runJob(job)}
        >
          <Play className="size-4" />
          Run now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => actions.setJobPaused(job, !job.paused)}
        >
          {job.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {job.paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
    </div>
  )
}
