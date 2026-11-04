// XOS fork: Cross-Project Portfolio rollup (stage G, PF1-PF7). One control plane over every
// discovered XOS project: per-project modes and hierarchical pause (PF2), focus sprints (PF3),
// token budgets (PF4), approvals as pending media reviews (PF5), versioned definitions (PF6) and
// cutover safety vs. legacy cron (PF7). Config persists in ~/.orca-xos/portfolio.json.
import type { XosActionResult } from './xos-goals-types'
import type { XosQueueRef } from './xos-items-types'
import type { XosReviewPending } from './xos-persona-types'

export type XosProjectMode = 'focus' | 'active' | 'maintenance' | 'paused'

export type XosCapacityProfile = 'focused' | 'balanced' | 'expanded'

export type XosProjectBudget = { weeklyTokens: number | null; weeklyCostUsd: number | null }

export type XosSprint = {
  projectKey: string
  startedAt: string
  capacity: XosCapacityProfile
  /** Operations reserve kept out of Auto's reach, percent of the weekly window (PF3). */
  reservePercent: number
} | null

export type XosPortfolioConfig = {
  modes: Record<string, XosProjectMode>
  sprint: XosSprint
  budgets: Record<string, XosProjectBudget>
}

/** A curated starter set (§3a): which goals a project needs for the loop to run. */
export type XosDeckPack = {
  id: string
  label: string
  description: string
  goals: string[]
}

export type XosPackReadiness = {
  packId: string
  label: string
  installed: number
  total: number
  missing: string[]
  ready: boolean
}

export type XosRollupCounts = {
  total: number
  /** Not paused and scheduled (or running). */
  active: number
  /** Active but waiting for their next slot. */
  queued: number
  running: number
  paused: number
  attention: number
}

export type XosRollupRuns = {
  runs7d: number
  succeeded7d: number
  /** Null when no runs in the window. */
  successRate7d: number | null
  runs30d: number
  succeeded30d: number
  successRate30d: number | null
}

export type XosRollupTokens = {
  tokens7d: number
  cost7d: number
  tokens30d: number
  cost30d: number
}

export type XosVersioning = {
  imported: boolean
  commitSha: string | null
  versionedGoals: number
  totalGoals: number
}

export type XosCutover = {
  /** Goal cron lines still in the crontab for this project. */
  legacyGoalLines: number
  /** Of those, lines still active (not paused) — double-run risk until removed. */
  legacyActiveLines: number
  /** Crontab fingerprint the board was built from (PF7 cutover check). */
  fingerprint: string | null
  state: 'complete' | 'pending' | 'unimported'
}

export type XosProjectRollup = {
  projectKey: string
  name: string
  mode: XosProjectMode
  healthLabel: string
  healthTone: 'danger' | 'warning' | 'success' | 'neutral'
  goals: XosRollupCounts
  runs: XosRollupRuns
  tokens: XosRollupTokens
  budget: XosProjectBudget & { utilization7d: number | null }
  /** Worst active queue in this project (starved or backed-up first). */
  bottleneck: XosQueueRef | null
  reviews: XosReviewPending
  versioning: XosVersioning
  cutover: XosCutover
  packs: XosPackReadiness[]
}

export type XosBottleneckQueue = XosQueueRef & {
  projectKey: string
  projectName: string
}

export type XosPortfolioRollup = {
  generatedAt: string
  projects: XosProjectRollup[]
  overall: {
    healthLabel: string
    healthTone: 'danger' | 'warning' | 'success' | 'neutral'
    goals: XosRollupCounts
    tokens: XosRollupTokens
    reviews: XosReviewPending
  }
  topBottlenecks: XosBottleneckQueue[]
  packs: XosDeckPack[]
  config: XosPortfolioConfig
}

export type XosPortfolioMutation =
  | { kind: 'set-mode'; projectKey: string; mode: XosProjectMode }
  | { kind: 'set-sprint'; sprint: XosSprint }
  | { kind: 'set-budget'; projectKey: string; budget: XosProjectBudget }

export type XosPortfolioApi = {
  getRollup: () => Promise<XosPortfolioRollup>
  mutatePortfolio: (mutation: XosPortfolioMutation) => Promise<XosActionResult>
}
