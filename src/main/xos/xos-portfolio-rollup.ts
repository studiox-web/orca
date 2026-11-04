// XOS fork: Cross-Project Portfolio rollup (stage G, PF1-PF7). Aggregates the goal board across
// every discovered project: health, active/queued/attention counts, 7d/30d tokens & run success
// rates, top bottleneck queues and deck-pack readiness. Config (modes/sprint/budgets) lives in
// xos-portfolio-config.ts; approvals (PF5) come from the persona studio review queues; versioning
// (PF6) is the project-home git commit; cutover (PF7) compares remaining legacy goal cron lines
// against the crontab fingerprint.
import { join } from 'node:path'
import type { XosGoal, XosProject } from '../../shared/xos-goals-types'
import type { XosQueueTone } from '../../shared/xos-items-types'
import type {
  XosBottleneckQueue,
  XosDeckPack,
  XosPortfolioConfig,
  XosPortfolioRollup,
  XosProjectRollup,
  XosRollupCounts,
  XosRollupRuns,
  XosRollupTokens
} from '../../shared/xos-portfolio-types'
import { buildXosGoalBoard, type XosRepoSource } from './xos-goal-board'
import { readRunReceipts, readTokenUsage } from './xos-goal-receipts'
import { countProjectReviews } from './xos-persona-studio'
import { readPortfolioConfig } from './xos-portfolio-config'
import { hasImportedGoals, readProjectMeta } from './xos-project-home'
import { queueTone, scanProjectQueues } from './xos-work-items'

const DAY_MS = 86_400_000
const SUCCESS_RE = /success|complete|pass|finish/i
const INCONCLUSIVE_RE = /skip|unknown/i
const TONE_RANK: Record<XosQueueTone, number> = { 'backed-up': 0, starved: 1, ok: 2, idle: 3 }
const HEALTH_LABEL = {
  danger: 'Action Needed',
  warning: 'Watch',
  success: 'Healthy',
  neutral: 'No Signal'
} as const

/** Curated starter sets (§3a). Readiness = which of the pack's goals a project already has. */
export const DECK_PACKS: XosDeckPack[] = [
  {
    id: 'content-studio',
    label: 'Content Studio',
    description: 'Research → write → edit → media → publish → retrospective.',
    goals: [
      'content-trend-researcher',
      'content-deep-researcher',
      'content-writer',
      'content-editor',
      'content-line-editor',
      'content-media',
      'content-publisher',
      'content-loop-retrospective'
    ]
  },
  {
    id: 'dev-shop',
    label: 'Dev Shop',
    description: 'Dream → groom → build → QA → fix → retro.',
    goals: [
      'feature-dreamer',
      'feature-backlog-groomer',
      'implement-planned-feature-backlog',
      'staging-qa',
      'fix-qa-bugs',
      'feature-loop-retrospective',
      'feature-dev-manager'
    ]
  },
  {
    id: 'marketplace-ops',
    label: 'Marketplace Ops',
    description: 'Listings, reviews, and host/guest success.',
    goals: [
      'listings-manager',
      'enrich-bc-listings',
      'listing-freshness-maintenance',
      'google-review-scrape-maintenance',
      'host-success-manager',
      'guest-support-manager'
    ]
  },
  {
    id: 'exec-suite',
    label: 'Exec Suite',
    description: 'Ops director, TLDR, people ops, finance, data and legal.',
    goals: [
      'company-ops-director',
      'operator-tldr-summary',
      'people-ops-manager',
      'finance-manager',
      'data-analytics-manager',
      'legal-compliance-manager'
    ]
  }
]

/** Attention mirror of the renderer filter (xos-org-hierarchy): card result, run, or inbox. */
function goalNeedsAttention(goal: XosGoal): boolean {
  const result = goal.result.toLowerCase()
  return (
    result.startsWith('action_needed') ||
    result.startsWith('watch') ||
    goal.messages.inboxOpen > 0 ||
    goal.viewer.latestRun?.status === 'failed'
  )
}

function goalCounts(goals: XosGoal[]): XosRollupCounts {
  return {
    total: goals.length,
    active: goals.filter((goal) => !goal.paused).length,
    queued: goals.filter((goal) => !goal.paused && !goal.running && goal.nextRun).length,
    running: goals.filter((goal) => goal.running).length,
    paused: goals.filter((goal) => goal.paused).length,
    attention: goals.filter(goalNeedsAttention).length
  }
}

function runStats(project: XosProject, now: number): XosRollupRuns {
  const receipts = [...readRunReceipts(join(project.root, 'automations')).values()].flat()
  const window = (days: number) => {
    const runs = receipts.filter(
      (run) => run.started_at && Date.parse(run.started_at) >= now - days * DAY_MS
    )
    const conclusive = runs.filter((run) => !INCONCLUSIVE_RE.test(run.status))
    const succeeded = conclusive.filter((run) => SUCCESS_RE.test(run.status)).length
    return {
      runs: runs.length,
      succeeded,
      rate: conclusive.length ? Math.round((succeeded / conclusive.length) * 1000) / 10 : null
    }
  }
  const w7 = window(7)
  const w30 = window(30)
  return {
    runs7d: w7.runs,
    succeeded7d: w7.succeeded,
    successRate7d: w7.rate,
    runs30d: w30.runs,
    succeeded30d: w30.succeeded,
    successRate30d: w30.rate
  }
}

function tokenStats(project: XosProject, now: number): XosRollupTokens {
  const usage = [...readTokenUsage(join(project.root, 'automations')).values()].flat()
  const sum = (days: number) => {
    const windowed = usage.filter(
      (entry) => entry.ts && Date.parse(entry.ts) >= now - days * DAY_MS
    )
    return {
      tokens: windowed.reduce((total, entry) => total + entry.actual_tokens, 0),
      cost:
        Math.round(
          windowed.reduce((total, entry) => total + entry.estimated_cost_usd, 0) * 10_000
        ) / 10_000
    }
  }
  const w7 = sum(7)
  const w30 = sum(30)
  return { tokens7d: w7.tokens, cost7d: w7.cost, tokens30d: w30.tokens, cost30d: w30.cost }
}

function projectQueues(project: XosProject): XosBottleneckQueue[] {
  const refs: XosBottleneckQueue[] = []
  for (const { type, stages } of scanProjectQueues(project.root, { activeOnly: true })) {
    for (const scanned of stages) {
      const count = scanned.readyCount ?? scanned.files.length
      const oldest = scanned.files.at(-1)
      refs.push({
        typeId: type.id,
        stageId: scanned.stage.id,
        label: scanned.stage.label,
        count,
        readyCount: scanned.readyCount,
        floor: scanned.stage.floor ?? null,
        ceiling: scanned.stage.ceiling ?? null,
        oldestAt: oldest ? new Date(oldest.mtimeMs).toISOString() : null,
        tone: queueTone(count, scanned.stage.floor, scanned.stage.ceiling),
        projectKey: project.key,
        projectName: project.name
      })
    }
  }
  return refs
}

const worstFirst = (a: XosBottleneckQueue, b: XosBottleneckQueue): number =>
  TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
  (a.oldestAt ?? '').localeCompare(b.oldestAt ?? '') ||
  b.count - a.count

/** Same labels as the renderer areaHealth (xos-org-hierarchy). */
function projectHealth(goals: XosGoal[]): { label: string; tone: keyof typeof HEALTH_LABEL } {
  const rank = { danger: 0, warning: 1, neutral: 2, success: 3 } as const
  const tone = goals
    .map((goal) => {
      const result = goal.result.toLowerCase()
      if (result.startsWith('action_needed')) {
        return 'danger' as const
      }
      if (result.startsWith('watch')) {
        return 'warning' as const
      }
      if (['pending', 'unknown', 'unavailable'].some((needle) => result.includes(needle))) {
        return 'neutral' as const
      }
      return 'success' as const
    })
    .sort((a, b) => rank[a] - rank[b])[0]
  const worst = tone ?? 'neutral'
  return { label: HEALTH_LABEL[worst], tone: worst }
}

function projectRollup(
  project: XosProject,
  config: XosPortfolioConfig,
  now: number,
  crontabHash: string,
  queues: XosBottleneckQueue[]
): XosProjectRollup {
  const goals = project.goals
  const health = projectHealth(goals)
  const tokens = tokenStats(project, now)
  const budget = config.budgets[project.key] ?? { weeklyTokens: null, weeklyCostUsd: null }
  const goalNames = goals.map((goal) => goal.goal)
  const imported = hasImportedGoals(project.root)
  const legacyLines = goals.flatMap((goal) => goal.viewer.cron.jobs)
  return {
    projectKey: project.key,
    name: project.name,
    mode: config.modes[project.key] ?? 'active',
    healthLabel: health.label,
    healthTone: health.tone,
    goals: goalCounts(goals),
    runs: runStats(project, now),
    tokens,
    budget: {
      ...budget,
      utilization7d:
        budget.weeklyCostUsd != null && budget.weeklyCostUsd > 0
          ? Math.round((tokens.cost7d / budget.weeklyCostUsd) * 1000) / 10
          : null
    },
    bottleneck: queues.filter((queue) => queue.tone !== 'idle').sort(worstFirst)[0] ?? null,
    reviews: countProjectReviews(project.root, goalNames),
    versioning: {
      imported,
      commitSha: readProjectMeta(project.root)?.commitSha ?? null,
      versionedGoals: imported ? goalNames.length : 0,
      totalGoals: goalNames.length
    },
    cutover: {
      legacyGoalLines: legacyLines.length,
      legacyActiveLines: legacyLines.filter((job) => !job.paused).length,
      fingerprint: crontabHash,
      state: !imported
        ? 'unimported'
        : legacyLines.every((job) => job.paused)
          ? 'complete'
          : 'pending'
    },
    packs: DECK_PACKS.map((pack) => {
      const missing = pack.goals.filter((goal) => !goalNames.includes(goal))
      return {
        packId: pack.id,
        label: pack.label,
        installed: pack.goals.length - missing.length,
        total: pack.goals.length,
        missing,
        ready: missing.length === 0
      }
    })
  }
}

export async function buildPortfolioRollup(repos: XosRepoSource): Promise<XosPortfolioRollup> {
  const board = await buildXosGoalBoard(repos)
  const config = readPortfolioConfig()
  const now = Date.now()
  const queuesByProject = new Map(
    board.projects.map((project) => [project.key, projectQueues(project)])
  )
  const projects = board.projects.map((project) =>
    projectRollup(project, config, now, board.crontabHash, queuesByProject.get(project.key) ?? [])
  )
  const allGoals = board.projects.flatMap((project) => project.goals)
  const rank = { danger: 0, warning: 1, neutral: 2, success: 3 } as const
  const overallTone =
    projects.map((project) => project.healthTone).sort((a, b) => rank[a] - rank[b])[0] ?? 'neutral'
  const addTokens = (a: XosRollupTokens, b: XosRollupTokens): XosRollupTokens => ({
    tokens7d: a.tokens7d + b.tokens7d,
    cost7d: Math.round((a.cost7d + b.cost7d) * 10_000) / 10_000,
    tokens30d: a.tokens30d + b.tokens30d,
    cost30d: Math.round((a.cost30d + b.cost30d) * 10_000) / 10_000
  })
  return {
    generatedAt: new Date(now).toISOString(),
    projects,
    overall: {
      healthLabel: HEALTH_LABEL[overallTone],
      healthTone: overallTone,
      goals: goalCounts(allGoals),
      tokens: projects.reduce((totals, project) => addTokens(totals, project.tokens), {
        tokens7d: 0,
        cost7d: 0,
        tokens30d: 0,
        cost30d: 0
      }),
      reviews: projects.reduce(
        (totals, project) => ({
          pending: totals.pending + project.reviews.pending,
          accepted: totals.accepted + project.reviews.accepted,
          rejected: totals.rejected + project.reviews.rejected
        }),
        { pending: 0, accepted: 0, rejected: 0 }
      )
    },
    topBottlenecks: [...queuesByProject.values()].flat().sort(worstFirst).slice(0, 5),
    packs: DECK_PACKS,
    config
  }
}
