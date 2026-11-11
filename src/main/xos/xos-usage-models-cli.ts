// XOS fork: Stage C Agent-facing CLI backend (§2.3a) for `orca usage summary`, `orca models list`, and `orca goals` helpers.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { XosGoalBoard } from '../../shared/xos-goals-types'
import type { XosCatalogModel } from '../../shared/xos-runtime-types'
import {
  findBoardGoal,
  matchesAreaFilter,
  matchesProjectFilter,
  resolveTargetProject
} from './xos-goal-cli'
import { applyCronMutation } from './xos-goal-crud'
import { readRunReceipts, readTokenUsage } from './xos-goal-receipts'
import { inferTier, tierKey } from './xos-model-tier'
import { readTierEdits } from './xos-runtime-store'

const DAY_MS = 86_400_000
const EFFORTS_3 = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
]

const FALLBACK_CATALOG: Record<string, XosCatalogModel[]> = {
  claude: [
    {
      id: 'opus',
      label: 'Claude Opus',
      isDefault: false,
      defaultEffort: 'high',
      efforts: EFFORTS_3
    },
    {
      id: 'sonnet',
      label: 'Claude Sonnet',
      isDefault: true,
      defaultEffort: 'medium',
      efforts: EFFORTS_3
    },
    {
      id: 'haiku',
      label: 'Claude Haiku',
      isDefault: false,
      defaultEffort: 'low',
      efforts: [{ value: 'low', label: 'Low' }]
    }
  ],
  codex: [
    { id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true, defaultEffort: 'high', efforts: EFFORTS_3 },
    {
      id: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      isDefault: false,
      defaultEffort: 'medium',
      efforts: EFFORTS_3
    },
    {
      id: 'gpt-5.3-codex-spark',
      label: 'GPT-5.3 Codex Spark',
      isDefault: false,
      defaultEffort: 'low',
      efforts: EFFORTS_3.slice(0, 2)
    }
  ],
  gemini: [
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', isDefault: true, efforts: [] },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', isDefault: false, efforts: [] }
  ],
  grok: [{ id: 'grok-4', label: 'Grok 4', isDefault: true, efforts: [] }]
}

function readAgentModelsForCli(agent: string): XosCatalogModel[] {
  const userDataDir = process.env.ORCA_USER_DATA_PATH ?? join(homedir(), '.config', 'orca')
  try {
    const raw: {
      entries?: {
        agent?: string
        discovered?: { models?: XosCatalogModel[] }
        live?: { models?: XosCatalogModel[] }
      }[]
    } = JSON.parse(readFileSync(join(userDataDir, 'agent-model-catalog.json'), 'utf8'))
    const entry = raw.entries?.find((c) => c.agent === agent)
    const models = entry?.discovered?.models ?? entry?.live?.models
    if (Array.isArray(models) && models.length > 0) {
      return models
    }
  } catch {
    // Fall back to static defaults when no persisted catalog exists.
  }
  return FALLBACK_CATALOG[agent] ?? []
}

export function listCliGoals(args: {
  board: XosGoalBoard
  projectFilter?: string
  areaFilter?: string
  cwd: string
}) {
  return args.board.projects
    .filter((p) => matchesProjectFilter(p, args.projectFilter, args.cwd))
    .flatMap((p) =>
      p.goals
        .filter((g) => matchesAreaFilter(g.area, args.areaFilter))
        .map((g) => {
          const jobs = g.viewer.cron.jobs
          return {
            project: p.name,
            projectRoot: p.root,
            goal: g.goal,
            title: g.title,
            area: g.area,
            activeCount: jobs.filter((j) => !j.paused).length,
            pausedCount: jobs.filter((j) => j.paused).length,
            schedules: jobs.map((j) => ({
              schedule: j.schedule,
              paused: j.paused,
              runner: j.runner,
              nextRunAt: j.nextRunAt
            })),
            model: g.viewer.configuredModel,
            effort: g.viewer.configuredReasoning,
            lockLane: g.viewer.lockLane,
            lastRun: g.viewer.latestRun
          }
        })
    )
}

export async function toggleCliGoalEnabled(args: {
  board: XosGoalBoard
  goalName?: string
  projectFilter?: string
  cwd: string
  enabled: boolean
}): Promise<
  { ok: true; project: string; goal?: string; enabled: boolean } | { ok: false; error: string }
> {
  if (args.goalName) {
    const found = findBoardGoal(args.board, args.goalName, args.projectFilter, args.cwd)
    if (!found) {
      return { ok: false, error: `Goal "${args.goalName}" not found.` }
    }
    const res = await applyCronMutation(args.board, {
      kind: args.enabled ? 'resume-goal' : 'pause-goal',
      projectKey: found.project.key,
      goal: found.goal.goal,
      crontabHash: args.board.crontabHash
    })
    if (!res.ok) {
      return res
    }
    return { ok: true, project: found.project.name, goal: found.goal.goal, enabled: args.enabled }
  }
  const project = resolveTargetProject(args.board, args.projectFilter, args.cwd)
  if (!project) {
    return { ok: false, error: 'Target project not found.' }
  }
  const res = await applyCronMutation(args.board, {
    kind: args.enabled ? 'resume-project' : 'pause-project',
    projectKey: project.key,
    crontabHash: args.board.crontabHash
  })
  if (!res.ok) {
    return res
  }
  return { ok: true, project: project.name, enabled: args.enabled }
}

export type XosCliUsageGoalRow = {
  project: string
  goal: string
  runs: number
  tokens: number
  costUsd: number
  models: string[]
}

export type XosCliUsageSummary = {
  days: number
  totalRuns: number
  totalTokens: number
  totalCostUsd: number
  byGoal: XosCliUsageGoalRow[]
  byModel: { model: string; runs: number; tokens: number; costUsd: number }[]
}

export function buildCliUsageSummary(args: {
  board: XosGoalBoard
  projectFilter?: string
  goalFilter?: string
  days?: number
  cwd: string
  nowMs?: number
}): XosCliUsageSummary {
  const days = Math.max(1, args.days ?? 7)
  const cutoff = (args.nowMs ?? Date.now()) - days * DAY_MS
  const byGoal: XosCliUsageGoalRow[] = []
  const modelMap = new Map<string, { runs: number; tokens: number; costUsd: number }>()
  for (const project of args.board.projects) {
    if (!matchesProjectFilter(project, args.projectFilter, args.cwd)) {
      continue
    }
    const usageMap = readTokenUsage(join(project.root, 'automations'))
    const runsMap = readRunReceipts(join(project.root, 'automations'))
    for (const goal of project.goals) {
      if (args.goalFilter && goal.goal !== args.goalFilter) {
        continue
      }
      const usageEntries = (usageMap.get(goal.goal) ?? []).filter(
        (u) => !u.ts || Date.parse(u.ts) >= cutoff
      )
      const runEntries = (runsMap.get(goal.goal) ?? []).filter(
        (r) => !r.started_at || Date.parse(r.started_at) >= cutoff
      )
      const tokens = usageEntries.reduce((s, u) => s + u.actual_tokens, 0)
      const costUsd =
        Math.round(usageEntries.reduce((s, u) => s + u.estimated_cost_usd, 0) * 10_000) / 10_000
      const runs = Math.max(usageEntries.length, runEntries.length)
      const models = [...new Set(usageEntries.map((u) => u.model).filter(Boolean))]
      byGoal.push({ project: project.name, goal: goal.goal, runs, tokens, costUsd, models })
      for (const u of usageEntries) {
        const key = u.model || 'unknown'
        const cur = modelMap.get(key) ?? { runs: 0, tokens: 0, costUsd: 0 }
        cur.runs += 1
        cur.tokens += u.actual_tokens
        cur.costUsd = Math.round((cur.costUsd + u.estimated_cost_usd) * 10_000) / 10_000
        modelMap.set(key, cur)
      }
    }
  }
  return {
    days,
    totalRuns: byGoal.reduce((s, g) => s + g.runs, 0),
    totalTokens: byGoal.reduce((s, g) => s + g.tokens, 0),
    totalCostUsd: Math.round(byGoal.reduce((s, g) => s + g.costUsd, 0) * 10_000) / 10_000,
    byGoal,
    byModel: [...modelMap.entries()].map(([model, v]) => ({ model, ...v }))
  }
}

export async function listCliModels(agentFilter?: string) {
  const agents = agentFilter ? [agentFilter] : ['claude', 'codex', 'gemini', 'grok']
  const edits = readTierEdits()
  const models = agents.flatMap((agent) =>
    readAgentModelsForCli(agent).map((model) => {
      const key = tierKey(agent, model.id)
      const edited = key in edits
      return {
        agent,
        id: model.id,
        label: model.label,
        tier: edited ? edits[key] : inferTier(model.id),
        edited,
        isDefault: model.isDefault,
        ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
        efforts: model.efforts
      }
    })
  )
  return { agents, models, tierEdits: edits }
}
