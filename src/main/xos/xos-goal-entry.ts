// XOS fork: build one goal card (XosGoal) from its folder, receipts, usage and cron lines.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  XosCronJob,
  XosGoal,
  XosGoalRun,
  XosGoalUsage,
  XosRunningJob
} from '../../shared/xos-goals-types'
import {
  adminSummaryFromLog,
  countOpenInbox,
  frontmatterList,
  frontmatterString,
  listGoalLogs,
  markdownTitle,
  mtimeIso,
  parseFrontmatter,
  parseStatusFields,
  readHead,
  safeReaddir
} from './xos-goal-files'
import type { XosGoalQueues } from '../../shared/xos-items-types'
import { areaForGoal, type XosOrg } from './xos-goal-org'
import { resolveProjectGoalsDir } from './xos-project-home'

const DAY_MS = 86_400_000

export type GoalProject = { root: string; goalsDir?: string }

function optionalDocPath(goalDir: string, filename: string): string | null {
  const full = join(goalDir, filename)
  return existsSync(full) ? full : null
}

function cardResult(
  status: Record<string, string>,
  latest: XosGoalRun | null
): { result: string; detail: string } {
  const latestStatus = (latest?.status ?? '').toLowerCase()
  if (latestStatus.includes('fail') || latestStatus.includes('error')) {
    return latest?.failure_reason === 'usage_limit'
      ? {
          result: 'action_needed: usage_limit',
          detail:
            'Latest automation run hit a model usage limit and needs operator action before the goal can resume.'
        }
      : {
          result: 'action_needed: run_failed',
          detail:
            'Latest automation run failed. Inspect the run log before trusting the goal status.'
        }
  }
  if (latestStatus.includes('unknown')) {
    return {
      result: 'watch: run_unknown',
      detail: 'Latest automation run did not write a clear success, skipped, or failed marker.'
    }
  }
  if (latestStatus.includes('skip')) {
    return {
      result: 'watch: run_skipped',
      detail: 'Latest automation run was skipped, usually because another run held the lock.'
    }
  }
  return {
    result: status.result ?? status.health ?? 'pending',
    detail: status.primary_action ?? status.next_action ?? status.output ?? ''
  }
}

function summarizeUsage(
  usage: XosGoalUsage[],
  now: number
): Pick<XosGoal['viewer'], 'usage7d' | 'usage30d'> {
  const since = (days: number): XosGoalUsage[] =>
    usage.filter((entry) => entry.ts && Date.parse(entry.ts) >= now - days * DAY_MS)
  const week = since(7)
  const month = since(30)
  const largest = [...week].sort((a, b) => b.actual_tokens - a.actual_tokens)[0]
  const priciest = [...week].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)[0]
  return {
    usage7d: {
      runs: week.length,
      tokens: week.reduce((sum, entry) => sum + entry.actual_tokens, 0),
      maxRunTokens: largest?.actual_tokens ?? 0,
      maxRunCost: Math.round((priciest?.estimated_cost_usd ?? 0) * 10_000) / 10_000,
      maxRunModel: priciest?.model ?? null
    },
    usage30d: {
      runs: month.length,
      tokens: month.reduce((sum, entry) => sum + entry.actual_tokens, 0),
      cost:
        Math.round(month.reduce((sum, entry) => sum + entry.estimated_cost_usd, 0) * 10_000) /
        10_000,
      models: [
        ...new Set(
          month
            .flatMap((entry) => entry.model.split(','))
            .map((model) => model.trim())
            .filter((model) => model && model !== 'unknown')
        )
      ]
    }
  }
}

export function buildGoal(args: {
  project: GoalProject
  goal: string
  org: XosOrg
  runs: XosGoalRun[]
  usage: XosGoalUsage[]
  cronJobs: XosCronJob[]
  running: XosRunningJob | null
  queues: XosGoalQueues
  now: number
}): XosGoal {
  const { project, goal, org, runs, usage, cronJobs, running, queues, now } = args
  const goalDir = join(project.goalsDir ?? resolveProjectGoalsDir(project.root), goal)
  const goalPath = join(goalDir, 'GOAL.md')
  const statusPath = join(goalDir, 'STATUS.md')
  const sidecars = safeReaddir(join(goalDir, 'sidecars'))
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort()
  const goalText = readHead(goalPath, 8192)
  const fm = parseFrontmatter(goalText)
  const status = parseStatusFields(readHead(statusPath, 32 * 1024))
  const { logs, latestText } = listGoalLogs(goal, join(goalDir, 'log'))
  const area = areaForGoal(org, goal, frontmatterString(fm, 'area'))
  const recentRuns = runs.slice(0, 5)
  const latestRun = recentRuns[0] ?? null
  const { result, detail } = cardResult(status, latestRun)
  const usageSummary = summarizeUsage(usage, now)
  const subagentNames = frontmatterList(fm, 'subagents')
  const expectedCount = Math.max(subagentNames.length, Number(fm.subagent_expected_count ?? 0) || 0)
  const activeJobs = cronJobs.filter((job) => !job.paused)
  const nextRun =
    activeJobs
      .map((job) => job.nextRunAt)
      .filter((value): value is string => !!value)
      .sort()[0] ?? null
  const statusLastRun =
    status.last_run && /\d{2}:\d{2}/.test(status.last_run) ? status.last_run : null
  return {
    goal,
    title:
      markdownTitle(goalText) ?? goal.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    area,
    status,
    lastRun:
      statusLastRun ?? latestRun?.started_at ?? logs[0]?.filename.replace(/\.md$/, '') ?? null,
    nextRun,
    result,
    detail,
    adminSummary: adminSummaryFromLog(latestText),
    paused: cronJobs.length > 0 && activeJobs.length === 0,
    running,
    viewer: {
      slug: goal,
      goalPath,
      statusPath,
      logDirectory: join(goalDir, 'log'),
      memoryPath: optionalDocPath(goalDir, 'MEMORY.md'),
      soulPath: optionalDocPath(goalDir, 'SOUL.md'),
      lessonsPath: optionalDocPath(goalDir, 'LESSONS.md'),
      decisionsPath: optionalDocPath(goalDir, 'DECISIONS.md'),
      sidecars,
      configuredModel: frontmatterString(fm, 'model'),
      configuredReasoning: frontmatterString(fm, 'model_reasoning_effort'),
      agents: frontmatterList(fm, 'agents'),
      lockLane: frontmatterString(fm, 'lock_lane'),
      estimatedRuntime: frontmatterString(fm, 'estimated_runtime'),
      contractStatus:
        status.status ??
        status.result ??
        latestRun?.status ??
        (Object.keys(status).length ? 'documented' : 'unknown'),
      statusUpdatedAt: mtimeIso(statusPath),
      latestRun,
      recentRuns,
      latestUsage: usage[0] ?? null,
      ...usageSummary,
      subagents: {
        configured: expectedCount > 0,
        heavy:
          expectedCount > 0 &&
          (usageSummary.usage7d.maxRunTokens >= 5_000_000 ||
            usageSummary.usage7d.tokens >= 10_000_000),
        mode: frontmatterString(fm, 'subagent_mode'),
        names: subagentNames,
        expectedCount,
        tokens7d: usageSummary.usage7d.tokens,
        maxRunTokens7d: usageSummary.usage7d.maxRunTokens
      },
      cron: {
        configured: cronJobs.length > 0,
        schedules: cronJobs.map((job) => `${job.schedule}${job.paused ? ' (paused)' : ''}`),
        jobs: cronJobs
      },
      statusFields: Object.entries(status).map(([key, value]) => ({
        key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value
      }))
    },
    logs,
    messages: { inboxOpen: countOpenInbox(join(goalDir, 'inbox')) },
    queues
  }
}
