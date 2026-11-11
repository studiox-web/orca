// XOS fork: card rank/relic classification calculations ported from DJVibe automations.
import type { AutomationCardTheme, AutomationCardImageMode } from './xos-card-identities-types'

export type AutomationCardIdentityInput = {
  goal: string
  role: string
  areaTitle: string
  isManager: boolean
  isCSuite: boolean
  costPips?: number
  power?: number
  toughness?: number
  runs7d?: number
  runs30d?: number
  tokens30d?: number
  successStreak?: number
  recentFailures?: number
  hasCurrentIssue?: boolean
  theme?: AutomationCardTheme
  imageMode?: AutomationCardImageMode
}

export function automationCardClassification({
  goal,
  role,
  areaTitle,
  isManager,
  isCSuite,
  costPips = 0,
  power = 0,
  toughness = 0,
  runs7d = 0,
  runs30d = 0,
  tokens30d = 0,
  successStreak = 0,
  recentFailures = 0,
  hasCurrentIssue = false
}: AutomationCardIdentityInput): string {
  if (isCSuite) {
    return power + toughness >= 18 ? 'Neon Sovereign' : 'Skyline Regent'
  }

  if (isManager) {
    return managerClassification(goal, areaTitle, power + toughness)
  }

  return relicClassification(
    goal,
    role,
    costPips,
    power + toughness,
    runs7d,
    runs30d,
    tokens30d,
    successStreak,
    recentFailures,
    hasCurrentIssue
  )
}

function managerClassification(goal: string, areaTitle: string, statTotal: number): string {
  const specific: Record<string, string> = {
    'platform-ops-manager': 'Signal Marshal',
    'feature-dev-manager': 'Forge Marshal',
    'listings-manager': 'Atlas Marshal',
    'marketing-growth-manager': 'Beacon Marshal',
    'sales-partnerships-manager': 'Pact Marshal',
    'special-projects-manager': 'Pilot Marshal'
  }

  if (specific[goal]) {
    return specific[goal]
  }

  if (areaTitle.toLowerCase().includes('content')) {
    return 'Editorial Marshal'
  }

  if (statTotal >= 18) {
    return 'Prime Marshal'
  }

  return 'Sector Marshal'
}

function relicClassification(
  goal: string,
  role: string,
  costPips: number,
  statTotal: number,
  runs7d: number,
  runs30d: number,
  tokens30d: number,
  successStreak: number,
  recentFailures: number,
  hasCurrentIssue: boolean
): string {
  const text = `${goal} ${role}`.toLowerCase()
  const rarity = relicRarity(
    costPips,
    statTotal,
    runs7d,
    runs30d,
    tokens30d,
    successStreak,
    recentFailures,
    hasCurrentIssue
  )
  const relicSuffix = ' — Relic'

  if (text.includes('deploy') || text.includes('gate')) {
    return `${rarity} Gateblade${relicSuffix}`
  }

  if (text.includes('qa') || text.includes('bug')) {
    return `${rarity} Nightblade${relicSuffix}`
  }

  if (text.includes('research') || text.includes('scrape') || text.includes('review')) {
    return `${rarity} Lens${relicSuffix}`
  }

  if (text.includes('groomer') || text.includes('retrospective') || text.includes('janitor')) {
    return `${rarity} Ledger${relicSuffix}`
  }

  if (
    text.includes('writer') ||
    text.includes('editor') ||
    text.includes('publisher') ||
    text.includes('journalist') ||
    text.includes('content')
  ) {
    return `${rarity} Quill${relicSuffix}`
  }

  if (text.includes('listing') || text.includes('enrich') || text.includes('freshness')) {
    return `${rarity} Compass${relicSuffix}`
  }

  if (text.includes('dreamer') || text.includes('feature')) {
    return `${rarity} Starforged Key${relicSuffix}`
  }

  if (text.includes('summary') || text.includes('tldr')) {
    return `${rarity} Oracle Plate${relicSuffix}`
  }

  return `${rarity} Core${relicSuffix}`
}

function relicRarity(
  costPips: number,
  statTotal: number,
  runs7d: number,
  runs30d: number,
  tokens30d: number,
  successStreak: number,
  recentFailures: number,
  hasCurrentIssue: boolean
): string {
  const usageWeight =
    Math.min(1, Math.floor(runs7d / 8)) +
    Math.min(1, Math.floor(runs30d / 20)) +
    Math.min(1, Math.floor(tokens30d / 1000000))
  const performanceWeight = Math.min(5, successStreak * 2) - recentFailures * 4
  const issuePenalty = hasCurrentIssue ? 5 : 0
  const weight =
    costPips + Math.floor(statTotal / 5) + usageWeight + performanceWeight - issuePenalty

  if (!hasCurrentIssue && recentFailures === 0 && successStreak >= 5 && weight >= 14) {
    return 'Mythic'
  }

  if (!hasCurrentIssue && recentFailures === 0 && weight >= 8) {
    return 'Gilded'
  }

  if (recentFailures <= 1 && weight >= 5) {
    return 'Polished'
  }

  return 'Chrome'
}
