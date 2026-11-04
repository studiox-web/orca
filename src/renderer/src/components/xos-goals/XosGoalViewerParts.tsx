// XOS fork: Goal Viewer building blocks (tiles, facts, collapsibles, crontab rows) and its action contract.
import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  type LucideIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  XosAreaMutation,
  XosCronJob,
  XosCronMutation,
  XosGoal,
  XosGoalMutation,
  XosGoalRunMode
} from '../../../../shared/xos-goals-types'
import { formatTimestamp, relativeTime } from './xos-format'
import { XosCronJobDialog } from './XosCronJobDialog'

/** A mutation minus the crontab hash, which the actions hook fills in from the loaded board. */
export type WithoutHash<T> = T extends unknown ? Omit<T, 'crontabHash'> : never

export type XosGoalRunOptions = {
  mode?: XosGoalRunMode
  sidecar?: string
  message?: string
}

export type XosGoalActions = {
  busy: string | null
  /** Each resolves true when the change succeeded (a toast reports either way). */
  cron: (mutation: WithoutHash<XosCronMutation>, busyKey?: string) => Promise<boolean>
  goalOp: (mutation: WithoutHash<XosGoalMutation>, busyKey?: string) => Promise<boolean>
  areaOp: (mutation: XosAreaMutation) => Promise<boolean>
  runGoal: (goal: XosGoal, options?: XosGoalRunOptions) => void
  releaseTakeover: (goal: XosGoal, advance: boolean) => void
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
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{job.schedule}</code>
          <span className="truncate">{job.goal ?? job.name}</span>
          {job.paused && (
            <span className="xos-chip xos-tone-warning">
              {job.pausedBy === 'migration' ? 'Paused for migration' : 'Paused'}
            </span>
          )}
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={`Edit ${job.goal ?? job.name}`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>
      <XosCronJobDialog
        target={editing ? { mode: 'edit', job } : null}
        actions={actions}
        onClose={() => setEditing(false)}
      />
    </div>
  )
}

export function GoalRunBar({
  item,
  busy,
  onRun
}: {
  item: XosGoal
  busy: boolean
  onRun: (options: XosGoalRunOptions) => void
}): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [sidecar, setSidecar] = useState<string>('__normal__')
  const sidecars = item.viewer.sidecars ?? []

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = message.trim()
    const isSidecar = sidecar !== '__normal__'
    onRun({
      mode: isSidecar ? 'sidecar' : 'normal',
      ...(isSidecar ? { sidecar } : {}),
      ...(trimmed ? { message: trimmed } : {})
    })
    setMessage('')
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3"
    >
      <MessageSquare className="size-4 shrink-0 text-primary" />
      <Input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={`Tell ${item.goal} what to focus on in this run (optional)…`}
        className="min-w-60 flex-1"
        disabled={busy || item.running !== null}
        aria-label="Operator message for run"
      />
      {sidecars.length > 0 && (
        <Select value={sidecar} onValueChange={setSidecar} disabled={busy}>
          <SelectTrigger className="w-44" aria-label="Contract mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" align="end" sideOffset={4}>
            <SelectItem value="__normal__">Standard GOAL.md</SelectItem>
            {sidecars.map((name) => (
              <SelectItem key={name} value={name}>
                Sidecar: {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={busy || item.running !== null || (!message.trim() && sidecar === '__normal__')}
      >
        <Play className="size-4" />
        {sidecar !== '__normal__' ? `Run ${sidecar}` : 'Send & run'}
      </Button>
    </form>
  )
}

export function GoalLogsCollapsible({
  item,
  onOpenFile
}: {
  item: XosGoal
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  return (
    <Collapsible title="Goal logs" summary={`${item.logs.length} recent`}>
      <div className="grid gap-2 md:grid-cols-2">
        {item.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logs available.</p>
        ) : (
          item.logs.map((entry) => (
            <button
              key={entry.filename}
              type="button"
              onClick={() => onOpenFile(entry.path)}
              className="flex w-full items-start gap-2 rounded-md border bg-muted/30 p-3 text-left text-sm transition-colors hover:bg-muted/60"
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{entry.filename}</span>
                <span className="block truncate text-muted-foreground">{entry.first_line}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Collapsible>
  )
}

export function GoalContractCollapsible({ item }: { item: XosGoal }): React.JSX.Element {
  return (
    <Collapsible
      title="Contract"
      summary={item.viewer.lockLane ? `lane ${item.viewer.lockLane}` : 'no lane'}
    >
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        {[
          ['Agents', item.viewer.agents.join(', ') || 'Unspecified'],
          ['Lock lane', item.viewer.lockLane ?? 'None'],
          ['Estimated runtime', item.viewer.estimatedRuntime ?? 'Unspecified'],
          ['Status updated', formatTimestamp(item.viewer.statusUpdatedAt) ?? 'Unavailable'],
          ['30-day models', item.viewer.usage30d.models.join(', ') || 'No token usage recorded'],
          ['Goal folder', item.viewer.goalPath.replace(/\/GOAL\.md$/, '')]
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border bg-background/60 p-2">
            <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </Collapsible>
  )
}
