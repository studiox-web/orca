// XOS fork: the Goal Viewer, ported from DJVibe's GoalDetailPanel (overview tab). Laravel links
// became Orca actions: Run now opens a terminal, Pause/Resume edit crontab, files open in Orca.
import React, { useState } from 'react'
import {
  ArrowLeft,
  Clock3,
  Cpu,
  FileText,
  Mail,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Timer
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import { XosGoalManage } from './XosGoalManage'
import { XosPersonaStudio } from './XosPersonaStudio'
import { queueSummary, XosGoalQueueList } from './XosQueuePipes'
import { goalIdentity, OpsCastingCostPips, RunBattleMeter, useCardArt } from './XosGoalCard'
import {
  automationBattleStats,
  automationCastingCost,
  automationRunBattleMeter,
  cardToneClasses,
  subagentBadgeLabel,
  type CardThemeSelection
} from './xos-goal-card-logic'
import {
  formatCompactNumber,
  formatCurrency,
  formatDuration,
  formatTimestamp,
  preferredTelemetryValue,
  relativeTime
} from './xos-format'
import {
  Collapsible,
  CronJobRow,
  DetailTile,
  GoalFact,
  GoalRunBar,
  StatusBadge,
  type XosGoalActions
} from './XosGoalViewerParts'

export function XosGoalViewer({
  item,
  project,
  cardTheme,
  actions,
  onBack
}: {
  item: XosGoal
  project: XosProject
  cardTheme: CardThemeSelection
  actions: XosGoalActions
  onBack: () => void
}): React.JSX.Element {
  const isManager = item.goal === item.area.manager
  const isCSuite = item.area.id === 'c-suite'
  const identity = goalIdentity(item, cardTheme)
  const art = useCardArt(project.key, identity)
  const runMeter = automationRunBattleMeter(item)
  const castingCost = automationCastingCost(item)
  const battleStats = automationBattleStats(item)
  const latestRun = item.viewer.latestRun
  const model = preferredTelemetryValue(
    latestRun?.model,
    item.viewer.latestUsage?.model,
    item.viewer.configuredModel
  )
  const reasoning = preferredTelemetryValue(
    latestRun?.reasoning_effort,
    item.viewer.configuredReasoning
  )
  const busy = actions.busy === item.goal
  const recommended = item.status.recommended_command?.replace(/^`|`$/g, '') ?? null
  const [showStudio, setShowStudio] = useState(false)

  if (showStudio) {
    return (
      <XosPersonaStudio
        item={item}
        project={project}
        cardTheme={cardTheme}
        actions={actions}
        onBack={() => setShowStudio(false)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Org chart
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setShowStudio(true)}>
            <Sparkles className="size-4" />
            Persona studio
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || item.running !== null}
            onClick={() => actions.runGoal(item)}
          >
            {item.running ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {item.running
              ? `Running ${formatDuration(item.running.elapsedSeconds) ?? ''}`
              : 'Run now'}
          </Button>
          {item.messages.inboxOpen > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => actions.runGoal(item, { mode: 'reply' })}
            >
              <Mail className="size-4" />
              Reply inbox ({item.messages.inboxOpen})
            </Button>
          )}
          {item.viewer.cron.configured && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => actions.setGoalPaused(item, !item.paused)}
            >
              {item.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {item.paused ? 'Resume schedule' : 'Pause schedule'}
            </Button>
          )}
          {[
            ['GOAL.md', item.viewer.goalPath],
            ['STATUS.md', item.viewer.statusPath],
            ['MEMORY.md', item.viewer.memoryPath],
            ['SOUL.md', item.viewer.soulPath],
            ['LESSONS.md', item.viewer.lessonsPath],
            ['DECISIONS.md', item.viewer.decisionsPath]
          ]
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
            .map(([label, filePath]) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => actions.openFile(filePath)}
              >
                <FileText className="size-4" />
                {label}
              </Button>
            ))}
        </div>
      </div>

      <GoalRunBar item={item} busy={busy} onRun={(options) => actions.runGoal(item, options)} />

      <section
        className={[
          'ops-goal-spell overflow-hidden rounded-lg border',
          isManager || isCSuite ? 'ops-goal-spell-manager' : '',
          ...cardToneClasses(runMeter)
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {art ? (
          <img
            src={art}
            alt=""
            className="ops-goal-spell-art aspect-[7/3] max-h-80 w-full object-cover"
          />
        ) : (
          <div className="ops-goal-spell-art aspect-[7/3] max-h-80 w-full bg-muted/40" />
        )}
        <div className="ops-goal-spell-body border-t p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-normal">{identity.displayName}</h1>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-primary">
                {identity.persona} · {item.title} · {item.area.title}
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {identity.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex gap-1" title={castingCost.label}>
                <OpsCastingCostPips pips={castingCost.pips} />
              </div>
              <RunBattleMeter meter={runMeter} />
              <span className="ops-spell-stat-box" title={battleStats.label}>
                {battleStats.power}/{battleStats.toughness}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <DetailTile label="Contract status" value={item.viewer.contractStatus} />
        <DetailTile
          label="Runner"
          value={latestRun?.runner ?? (item.viewer.agents.join(', ') || 'Unavailable')}
        />
        <DetailTile
          label="Exit code"
          value={
            latestRun?.exit_code === null || latestRun?.exit_code === undefined
              ? 'Unavailable'
              : String(latestRun.exit_code)
          }
          detail={latestRun?.failure_reason ?? undefined}
        />
        <DetailTile
          label="30-day cost"
          value={formatCurrency(item.viewer.usage30d.cost)}
          detail={`${formatCompactNumber(item.viewer.usage30d.tokens)} tokens · ${item.viewer.usage30d.runs} runs`}
        />
        <DetailTile
          label="Subagents"
          value={
            item.viewer.subagents.configured
              ? `${item.viewer.subagents.expectedCount} configured`
              : 'None configured'
          }
          detail={
            item.viewer.subagents.configured
              ? subagentBadgeLabel(item)
              : 'No subagent metadata in GOAL.md'
          }
        />
      </section>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <GoalFact icon={Clock3} label="Last run" value={formatTimestamp(item.lastRun)} />
        <GoalFact
          icon={Clock3}
          label="Next run"
          value={
            item.paused
              ? 'Paused'
              : item.nextRun
                ? `${formatTimestamp(item.nextRun)} (${relativeTime(item.nextRun)})`
                : 'Not scheduled'
          }
        />
        <GoalFact icon={Cpu} label="Model" value={model} />
        <GoalFact icon={Timer} label="Reasoning" value={reasoning} />
        <GoalFact
          icon={Clock3}
          label="Duration"
          value={formatDuration(latestRun?.duration_seconds)}
        />
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-primary">Admin summary</h2>
        <p className="min-h-10 break-words text-sm leading-6 text-muted-foreground">
          {item.adminSummary || item.detail || 'No summary in the latest log.'}
        </p>
      </section>

      {(item.status.primary_action || recommended) && (
        <section className="space-y-2 border-t pt-4">
          <h2 className="text-sm font-semibold text-primary">Recommended action</h2>
          {item.status.primary_action && (
            <p className="text-sm leading-6 text-muted-foreground">{item.status.primary_action}</p>
          )}
          {recommended && (
            <code className="block rounded bg-muted px-2 py-1 text-xs">{recommended}</code>
          )}
        </section>
      )}

      <XosGoalManage item={item} project={project} actions={actions} onArchived={onBack} />

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">Schedules</h2>
          <Badge variant="outline">
            {item.viewer.cron.jobs.length} crontab line
            {item.viewer.cron.jobs.length === 1 ? '' : 's'}
          </Badge>
        </div>
        {item.viewer.cron.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No crontab schedule. Run now still works.</p>
        ) : (
          item.viewer.cron.jobs.map((job) => (
            <CronJobRow key={job.id} job={job} actions={actions} />
          ))
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <h2 className="text-sm font-semibold text-primary">Recent runs</h2>
        {item.viewer.recentRuns.length === 0 ? (
          <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
            No run receipts available.
          </p>
        ) : (
          <div className="grid gap-2">
            {item.viewer.recentRuns.map((run) => (
              <div
                key={`${run.log_path}-${run.started_at}`}
                className="rounded-lg border bg-background/60 p-3 text-sm"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge
                    value={run.failure_reason ? `${run.status}: ${run.failure_reason}` : run.status}
                  />
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(run.started_at) ?? 'Unknown start'}
                  </span>
                </span>
                <span className="mt-2 block truncate font-mono text-xs" title={run.log_path}>
                  {run.log_path || 'Run log unavailable'}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {run.runner ?? 'runner?'} ·{' '}
                  {preferredTelemetryValue(run.model, item.viewer.configuredModel) ??
                    'Unknown model'}{' '}
                  ·{' '}
                  {preferredTelemetryValue(run.reasoning_effort, item.viewer.configuredReasoning) ??
                    'No reasoning level'}{' '}
                  · {formatDuration(run.duration_seconds) ?? 'No duration'}
                  {run.exit_code !== null && run.exit_code !== undefined
                    ? ` · exit ${run.exit_code}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <Collapsible title="Queues" summary={queueSummary(item.queues)}>
        <XosGoalQueueList queues={item.queues} projectKey={project.key} />
      </Collapsible>

      <Collapsible title="Goal logs" summary={`${item.logs.length} recent`}>
        <div className="grid gap-2 md:grid-cols-2">
          {item.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No logs available.</p>
          ) : (
            item.logs.map((entry) => (
              <button
                key={entry.filename}
                type="button"
                onClick={() => actions.openFile(entry.path)}
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

      <Collapsible
        title="Status fields"
        summary={
          item.viewer.statusFields.length === 0
            ? 'No parsed fields'
            : `${item.viewer.statusFields.length} parsed fields`
        }
      >
        <dl className="grid gap-2 md:grid-cols-2">
          {item.viewer.statusFields.map((field) => (
            <div key={field.key} className="rounded-md border bg-background/60 p-2 text-sm">
              <dt className="text-xs font-semibold text-muted-foreground">{field.label}</dt>
              <dd className="break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      </Collapsible>

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
    </div>
  )
}
