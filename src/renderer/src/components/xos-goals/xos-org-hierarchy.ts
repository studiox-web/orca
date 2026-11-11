// XOS fork: filters and the director → manager → worker hierarchy, ported from DJVibe
// resources/js/lib/operations-dashboard.ts.
import type { XosGoal } from '../../../../shared/xos-goals-types'

export type OrgFilter =
  | 'all'
  | 'attention'
  | 'issues'
  | 'warnings'
  | 'messages'
  | 'running'
  | 'paused'

export type OrgChartNode = {
  id: string
  title: string
  subtitle: string
  kind: 'director' | 'manager' | 'worker' | 'group'
  item: XosGoal | null
  children: OrgChartNode[]
  counts: {
    cards: number
    attention: number
    issues: number
    warnings: number
    messages: number
  }
}

const issueNeedles = [
  'action_needed',
  'action needed',
  'blocked',
  'blocker',
  'failed',
  'failure',
  'error',
  'red',
  'usage_limit'
]
const warningNeedles = ['warning', 'warn', 'watch', 'skip', 'skipped', 'stale', 'noisy', 'yellow']

function searchableSignal(item: XosGoal): string {
  return [
    item.result,
    item.detail,
    item.adminSummary ?? '',
    Object.values(item.status ?? {}).join(' '),
    item.viewer.latestRun?.status ?? '',
    item.viewer.latestRun?.failure_reason ?? '',
    item.viewer.recentRuns
      .slice(0, 5)
      .map((run) => `${run.status} ${run.failure_reason ?? ''}`)
      .join(' ')
  ]
    .join(' ')
    .toLowerCase()
}

const containsAny = (value: string, needles: string[]): boolean =>
  needles.some((needle) => value.includes(needle))

export function goalHasIssue(item: XosGoal): boolean {
  const latest = item.viewer.latestRun
  return (
    containsAny(searchableSignal(item), issueNeedles) ||
    latest?.status === 'failed' ||
    (latest?.exit_code ?? 0) > 0
  )
}

export function goalHasWarning(item: XosGoal): boolean {
  return containsAny(searchableSignal(item), warningNeedles)
}

export const goalHasMessages = (item: XosGoal): boolean => item.messages.inboxOpen > 0

export function goalNeedsAttention(item: XosGoal): boolean {
  return goalHasIssue(item) || goalHasWarning(item) || goalHasMessages(item)
}

export function goalMatchesFilter(item: XosGoal, filter: OrgFilter): boolean {
  switch (filter) {
    case 'attention':
      return goalNeedsAttention(item)
    case 'issues':
      return goalHasIssue(item)
    case 'warnings':
      return goalHasWarning(item)
    case 'messages':
      return goalHasMessages(item)
    case 'running':
      return item.running !== null
    case 'paused':
      return item.paused
    default:
      return true
  }
}

export function filterOptions(
  goals: XosGoal[]
): { value: OrgFilter; label: string; count: number }[] {
  const options: { value: OrgFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: goals.length },
    {
      value: 'attention',
      label: 'Needs attention',
      count: goals.filter(goalNeedsAttention).length
    },
    {
      value: 'issues',
      label: 'Issues',
      count: goals.filter(goalHasIssue).length
    },
    {
      value: 'warnings',
      label: 'Warnings',
      count: goals.filter(goalHasWarning).length
    }
  ]
  const optional: [OrgFilter, string, (goal: XosGoal) => boolean][] = [
    ['running', 'Running', (goal) => goal.running !== null],
    ['paused', 'Paused', (goal) => goal.paused],
    ['messages', 'New messages', goalHasMessages]
  ]
  for (const [value, label, test] of optional) {
    const count = goals.filter(test).length
    if (count > 0) {
      options.push({ value, label, count })
    }
  }
  return options
}

const emptyCounts = (): OrgChartNode['counts'] => ({
  cards: 0,
  attention: 0,
  issues: 0,
  warnings: 0,
  messages: 0
})

function countsForItem(item: XosGoal): OrgChartNode['counts'] {
  return {
    cards: 1,
    attention: goalNeedsAttention(item) ? 1 : 0,
    issues: goalHasIssue(item) ? 1 : 0,
    warnings: goalHasWarning(item) ? 1 : 0,
    messages: goalHasMessages(item) ? 1 : 0
  }
}

function nodeCounts(node: OrgChartNode): OrgChartNode['counts'] {
  return node.children.reduce(
    (counts, child) => ({
      cards: counts.cards + child.counts.cards,
      attention: counts.attention + child.counts.attention,
      issues: counts.issues + child.counts.issues,
      warnings: counts.warnings + child.counts.warnings,
      messages: counts.messages + child.counts.messages
    }),
    node.item ? countsForItem(node.item) : emptyCounts()
  )
}

function cardNode(item: XosGoal): OrgChartNode {
  return {
    id: item.goal,
    title: item.title,
    subtitle: item.area.title,
    kind: item.goal === item.area.manager ? 'manager' : 'worker',
    item,
    children: [],
    counts: countsForItem(item)
  }
}

export function buildOrgHierarchy(goals: XosGoal[], projectName: string): OrgChartNode {
  const director =
    goals.find((item) => item.area.id === 'c-suite' && item.goal === item.area.manager) ??
    goals.find((item) => item.area.id === 'c-suite') ??
    null
  const root: OrgChartNode = {
    id: director?.goal ?? 'company-operations',
    title: director?.title ?? `${projectName} operations`,
    subtitle: 'Org chart',
    kind: 'director',
    item: director,
    children: [],
    counts: emptyCounts()
  }
  const consumed = new Set<string>(director ? [director.goal] : [])
  const areas = [...new Map(goals.map((item) => [item.area.id, item.area])).values()]
  for (const area of areas) {
    if (area.id === 'c-suite') {
      const cSuite = goals
        .filter((item) => item.area.id === area.id && !consumed.has(item.goal))
        .map(cardNode)
      root.children.push(...cSuite)
      cSuite.forEach((node) => consumed.add(node.id))
      continue
    }
    const areaItems = goals.filter((item) => item.area.id === area.id)
    const manager = area.manager ? areaItems.find((item) => item.goal === area.manager) : undefined
    const areaNode: OrgChartNode = manager
      ? { ...cardNode(manager), subtitle: area.title, children: [] }
      : {
          id: `area:${area.id}`,
          title: area.title,
          subtitle: area.description || 'No manager goal',
          kind: 'group',
          item: null,
          children: [],
          counts: emptyCounts()
        }
    if (manager) {
      consumed.add(manager.goal)
    }
    areaNode.children = areaItems
      .filter((item) => item.goal !== manager?.goal)
      .map((item) => {
        consumed.add(item.goal)
        return cardNode(item)
      })
    areaNode.counts = nodeCounts(areaNode)
    root.children.push(areaNode)
  }
  root.counts = nodeCounts(root)
  return root
}

export type AreaHealth = {
  label: 'Action Needed' | 'Watch' | 'Healthy' | 'No Signal'
  tone: 'danger' | 'warning' | 'success' | 'neutral'
}

export function areaHealth(items: XosGoal[]): AreaHealth {
  const results = items.map((item) => item.result.toLowerCase())
  const signal = results.filter(
    (result) => !['pending', 'unknown', 'unavailable'].some((needle) => result.includes(needle))
  )
  if (
    results.some((result) =>
      ['action_needed', 'action needed', 'fail', 'error', 'blocked'].some((needle) =>
        result.includes(needle)
      )
    )
  ) {
    return { label: 'Action Needed', tone: 'danger' }
  }
  if (
    results.some((result) => ['skip', 'noisy', 'watch'].some((needle) => result.includes(needle)))
  ) {
    return { label: 'Watch', tone: 'warning' }
  }
  if (
    signal.length > 0 &&
    signal.every((result) =>
      ['success', 'pass', 'finished', 'healthy', 'complete', 'published'].some((needle) =>
        result.includes(needle)
      )
    )
  ) {
    return { label: 'Healthy', tone: 'success' }
  }
  return { label: 'No Signal', tone: 'neutral' }
}
