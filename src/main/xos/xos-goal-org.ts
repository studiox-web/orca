// XOS fork: business areas and reporting lines for a project's org chart.
// Source order: ~/.orca-xos/projects/<slug>/org.json, then GOAL.md `area:` frontmatter, then the
// Cascade defaults (formerly hard-coded constants in CommandCentreController).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { XosGoalArea } from '../../shared/xos-goals-types'
import { xosHome } from './xos-crontab'

type OrgFileArea = XosGoalArea & { goals?: string[] }
export type XosOrg = { source: 'org.json' | 'default'; areas: OrgFileArea[] }

const DEFAULT_AREAS: OrgFileArea[] = [
  {
    id: 'c-suite',
    title: 'C-Suite',
    description:
      'Director-level planning, manager review, company health, and cross-area priorities.',
    manager: 'company-ops-director',
    goals: ['company-ops-director']
  },
  {
    id: 'platform-ops',
    title: 'Platform Operations',
    description: 'Deploys, staging QA, operator summaries, and other system-level checks.',
    manager: 'platform-ops-manager',
    goals: [
      'platform-ops-manager',
      'staging-deploy',
      'staging-qa',
      'staging-log-review',
      'operator-tldr-summary',
      'worktree-janitor',
      'trust-safety-quality-manager',
      'production-deploy'
    ]
  },
  {
    id: 'feature-dev',
    title: 'Feature Development',
    description: 'Feature ideation, grooming, implementation, retrospectives, and QA bug work.',
    manager: 'feature-dev-manager',
    goals: [
      'feature-dev-manager',
      'fix-qa-bugs',
      'implement-planned-feature-backlog',
      'feature-loop-retrospective',
      'feature-dreamer',
      'feature-backlog-groomer',
      'product-engineering-manager'
    ]
  },
  {
    id: 'listings-management',
    title: 'Listings Management',
    description: 'Listing enrichment, Google review maintenance, and marketplace data quality.',
    manager: 'listings-manager',
    goals: [
      'listings-manager',
      'google-review-scrape-maintenance',
      'listing-freshness-maintenance',
      'enrich-bc-listings'
    ]
  },
  {
    id: 'marketing-growth',
    title: 'Marketing & Growth',
    description: 'Content, SEO, campaign readiness, and demand-generation automations.',
    manager: 'marketing-growth-manager',
    goals: [
      'marketing-growth-manager',
      'content-editor',
      'content-trend-researcher',
      'content-deep-researcher',
      'marketplace-content-analyst',
      'content-writers-room',
      'content-backlog-groomer',
      'content-writer',
      'content-publisher',
      'photo-journalist',
      'content-loop-retrospective',
      'content-line-editor'
    ]
  },
  {
    id: 'sales',
    title: 'Sales & Partnerships',
    description:
      'Lead pipeline, partner categories, follow-up readiness, and relationship-development automations.',
    manager: 'sales-partnerships-manager',
    goals: ['sales-partnerships-manager', 'sales-pipeline-health-reporter']
  },
  {
    id: 'host-success',
    title: 'Host Success',
    description:
      'Host onboarding, readiness, listing completeness, responsiveness, bookings, and review health.',
    manager: 'host-success-manager',
    goals: ['host-success-manager']
  },
  {
    id: 'guest-support',
    title: 'Guest Support',
    description:
      'Booking pipeline, checkout, cancellation, messaging, and support-coverage visibility.',
    manager: 'guest-support-manager',
    goals: ['guest-support-manager']
  },
  {
    id: 'special-projects',
    title: 'Special Projects',
    description:
      'Pop-up, mobile, pilot, and local activation planning before any real-world commitments.',
    manager: 'special-projects-manager',
    goals: ['special-projects-manager']
  },
  {
    id: 'people-ops',
    title: 'People Ops',
    description: 'Automation-role onboarding quality, setup consistency, and HR process checks.',
    manager: 'people-ops-manager',
    goals: ['people-ops-manager']
  },
  {
    id: 'data-analytics',
    title: 'Data & Analytics',
    description: 'KPIs, cohorts, performance, and data-quality coverage.',
    manager: 'data-analytics-manager',
    goals: ['data-analytics-manager', 'finance-manager']
  },
  {
    id: 'legal-compliance',
    title: 'Legal / Compliance',
    description: 'Policy, privacy, regional obligations, and public-claim review gaps.',
    manager: 'legal-compliance-manager',
    goals: ['legal-compliance-manager']
  }
]

const UNASSIGNED: XosGoalArea = {
  id: 'unassigned',
  title: 'Unassigned',
  description: 'Goals with no area in org.json, GOAL.md frontmatter, or the defaults.',
  manager: ''
}

export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  )
}

export function orgFilePath(projectName: string): string {
  return join(xosHome(), 'projects', projectSlug(projectName), 'org.json')
}

export function loadOrg(projectName: string): XosOrg {
  try {
    const parsed = JSON.parse(readFileSync(orgFilePath(projectName), 'utf8')) as { areas?: unknown }
    if (Array.isArray(parsed.areas)) {
      const areas = parsed.areas.filter(
        (area): area is OrgFileArea =>
          !!area && typeof area === 'object' && typeof (area as OrgFileArea).id === 'string'
      )
      return {
        source: 'org.json',
        areas: areas.map((area) => ({
          id: area.id,
          title: area.title ?? area.id,
          description: area.description ?? '',
          manager: area.manager ?? '',
          goals: Array.isArray(area.goals) ? area.goals : []
        }))
      }
    }
  } catch {
    // No org file (or unreadable): fall back to defaults.
  }
  return { source: 'default', areas: DEFAULT_AREAS }
}

export function areaForGoal(
  org: XosOrg,
  goal: string,
  frontmatterArea: string | null
): XosGoalArea {
  const strip = ({ goals: _goals, ...area }: OrgFileArea): XosGoalArea => area
  const listed = org.areas.find((area) => area.goals?.includes(goal))
  if (listed) {
    return strip(listed)
  }
  const byId = frontmatterArea ? org.areas.find((area) => area.id === frontmatterArea) : undefined
  if (byId) {
    return strip(byId)
  }
  if (org.source === 'org.json') {
    const fallback = DEFAULT_AREAS.find((area) => area.goals?.includes(goal))
    if (fallback && fallback.id === 'c-suite') {
      return strip(fallback)
    }
  }
  return UNASSIGNED
}

/** Sort key: area order, then the order goals are listed within the area. */
export function goalSortKey(
  org: XosOrg,
  area: XosGoalArea,
  goal: string
): [number, number, string] {
  const areaIndex = org.areas.findIndex((candidate) => candidate.id === area.id)
  const goals = org.areas[areaIndex]?.goals ?? []
  const goalIndex = goal === area.manager ? -1 : goals.indexOf(goal)
  return [areaIndex === -1 ? 999 : areaIndex, goalIndex === -1 ? 999 : goalIndex, goal]
}
