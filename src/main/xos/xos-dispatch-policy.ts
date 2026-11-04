// XOS fork: Stage G controls that actually constrain dispatch (PF2-PF4). Every path that starts
// work asks here first. An operator's explicit run always passes: the policy limits what runs by
// itself, not what a person asks for.
import { join } from 'node:path'
import { readTokenUsage } from './xos-goal-receipts'
import { readPortfolioConfig } from './xos-portfolio-config'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type XosDispatchSource = 'operator' | 'schedule' | 'event'

export type XosDispatchDecision = { allowed: true } | { allowed: false; reason: string }

function weeklyUsage(repoRoot: string, nowMs: number): { tokens: number; cost: number } {
  const usage = [...readTokenUsage(join(repoRoot, 'automations')).values()].flat()
  const recent = usage.filter((entry) => entry.ts && Date.parse(entry.ts) >= nowMs - WEEK_MS)
  return {
    tokens: recent.reduce((total, entry) => total + entry.actual_tokens, 0),
    cost: recent.reduce((total, entry) => total + entry.estimated_cost_usd, 0)
  }
}

export function checkDispatchPolicy(args: {
  repoRoot: string
  source: XosDispatchSource
  nowMs?: number
}): XosDispatchDecision {
  if (args.source === 'operator') {
    return { allowed: true }
  }
  const config = readPortfolioConfig()
  const mode = config.modes[args.repoRoot] ?? 'active'
  if (mode === 'paused') {
    return { allowed: false, reason: 'The project is paused in Portfolio.' }
  }
  if (mode === 'maintenance' && args.source === 'event') {
    return { allowed: false, reason: 'The project is in maintenance: queue events are held.' }
  }
  const sprint = config.sprint
  if (sprint?.capacity === 'focused' && sprint.projectKey !== args.repoRoot) {
    return { allowed: false, reason: 'A focused sprint on another project is holding this run.' }
  }
  const budget = config.budgets[args.repoRoot]
  if (budget) {
    const used = weeklyUsage(args.repoRoot, args.nowMs ?? Date.now())
    if (budget.weeklyTokens != null && used.tokens >= budget.weeklyTokens) {
      return { allowed: false, reason: `Weekly token budget used (${used.tokens}).` }
    }
    if (budget.weeklyCostUsd != null && used.cost >= budget.weeklyCostUsd) {
      return { allowed: false, reason: `Weekly cost budget used ($${used.cost.toFixed(2)}).` }
    }
  }
  return { allowed: true }
}

/** PF3: a sprint's operations reserve applies to Auto on top of the automation's own. */
export function effectiveReservePercent(ownReserve: number): number {
  return Math.max(ownReserve, readPortfolioConfig().sprint?.reservePercent ?? 0)
}
