// XOS fork: portfolio config persistence (stage G). ~/.orca-xos/portfolio.json holds the
// per-project modes (PF2), the focus sprint (PF3) and the weekly token budgets (PF4). Every write
// is audited; unknown shape is discarded rather than trusted.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  XosDeckPack,
  XosPortfolioConfig,
  XosPortfolioMutation,
  XosProjectBudget,
  XosProjectMode
} from '../../shared/xos-portfolio-types'
import type { XosActionResult } from '../../shared/xos-goals-types'
import { audit, xosHome } from './xos-crontab'

function configPath(): string {
  return join(xosHome(), 'portfolio.json')
}

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

export function readPortfolioConfig(): XosPortfolioConfig {
  const empty: XosPortfolioConfig = { modes: {}, sprint: null, budgets: {} }
  try {
    const raw: Partial<XosPortfolioConfig> = JSON.parse(readFileSync(configPath(), 'utf8'))
    const modes: Record<string, XosProjectMode> = {}
    for (const [key, value] of Object.entries(raw.modes ?? {})) {
      if (
        value === 'focus' ||
        value === 'active' ||
        value === 'maintenance' ||
        value === 'paused'
      ) {
        modes[key] = value
      }
    }
    const budgets: Record<string, XosProjectBudget> = {}
    for (const [key, budget] of Object.entries(raw.budgets ?? {})) {
      if (budget && typeof budget === 'object') {
        budgets[key] = {
          weeklyTokens: typeof budget.weeklyTokens === 'number' ? budget.weeklyTokens : null,
          weeklyCostUsd: typeof budget.weeklyCostUsd === 'number' ? budget.weeklyCostUsd : null
        }
      }
    }
    const sprint = raw.sprint ?? null
    return {
      modes,
      budgets,
      sprint:
        sprint &&
        typeof sprint.projectKey === 'string' &&
        (sprint.capacity === 'focused' ||
          sprint.capacity === 'balanced' ||
          sprint.capacity === 'expanded')
          ? {
              projectKey: sprint.projectKey,
              startedAt:
                typeof sprint.startedAt === 'string' ? sprint.startedAt : new Date(0).toISOString(),
              capacity: sprint.capacity,
              reservePercent: typeof sprint.reservePercent === 'number' ? sprint.reservePercent : 10
            }
          : null
    }
  } catch {
    return empty
  }
}

export function applyPortfolioMutation(mutation: XosPortfolioMutation): XosActionResult {
  const config = readPortfolioConfig()
  switch (mutation.kind) {
    case 'set-mode':
      if (mutation.mode === 'active') {
        delete config.modes[mutation.projectKey]
      } else {
        config.modes[mutation.projectKey] = mutation.mode
      }
      break
    case 'set-sprint':
      config.sprint = mutation.sprint
      break
    case 'set-budget': {
      const tokens = mutation.budget.weeklyTokens
      const cost = mutation.budget.weeklyCostUsd
      if (tokens == null && cost == null) {
        return { ok: false, error: 'Budget needs a weekly token or cost limit.' }
      }
      if ((tokens != null && tokens <= 0) || (cost != null && cost <= 0)) {
        return { ok: false, error: 'Budget limits must be positive numbers.' }
      }
      config.budgets[mutation.projectKey] = { weeklyTokens: tokens, weeklyCostUsd: cost }
      break
    }
  }
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  audit({ action: `portfolio.${mutation.kind}`, ...mutation })
  return { ok: true, message: `Portfolio: ${mutation.kind} saved.` }
}
