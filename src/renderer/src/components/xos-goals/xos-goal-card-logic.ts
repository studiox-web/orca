// XOS fork: card maths from the DJVibe/Cascade operations board (resources/js/pages/dashboard.tsx),
// unchanged in behaviour: casting-cost pips, power/toughness, run meter and streaks.
import type { XosGoal } from '../../../../shared/xos-goals-types'
import { modelStrengthScore } from './xos-model-strength'
import {
  formatCompactNumber,
  formatCurrency,
  formatTimestamp,
  preferredTelemetryValue
} from './xos-format'
import type { AutomationCardImageMode, AutomationCardTheme } from './xos-card-identities'

export type AutomationRunTone = 'success' | 'warning' | 'danger'
export type CardThemeSelection = {
  theme: AutomationCardTheme
  imageMode: AutomationCardImageMode
}

export function subagentBadgeLabel(item: XosGoal): string {
  const subagents = item.viewer.subagents
  const names =
    subagents.names.length > 0
      ? subagents.names.join(', ')
      : `${subagents.expectedCount} configured`
  const mode = subagents.mode ? `${subagents.mode} ` : ''
  const pressure = subagents.heavy ? 'heavy recent usage' : 'tracked'
  return `${mode}subagents: ${names}. ${pressure}; ${formatCompactNumber(subagents.tokens7d)} tokens in 7 days, max ${formatCompactNumber(subagents.maxRunTokens7d)} in one run.`
}

function modelOf(item: XosGoal): string | null {
  return preferredTelemetryValue(
    item.viewer.usage7d.maxRunModel?.split(',')[0],
    item.viewer.latestRun?.model,
    item.viewer.latestUsage?.model?.split(',')[0],
    item.viewer.configuredModel,
    ...item.viewer.usage30d.models
  )
}

export function automationModelTone(item: XosGoal): string {
  // The configured runner is the truest signal for which provider a goal spends.
  const runner = (item.viewer.latestRun?.runner ?? item.viewer.agents[0] ?? '').toLowerCase()
  if (runner === 'claude') {
    return 'anthropic'
  }
  if (runner === 'codex') {
    return 'codex'
  }
  if (runner === 'gemini' || runner === 'agy') {
    return 'antigravity'
  }
  const model = modelOf(item)?.toLowerCase()
  if (!model) {
    return 'unknown'
  }
  if (model.includes('gemini') || model.includes('antigravity')) {
    return 'antigravity'
  }
  if (
    ['claude', 'anthropic', 'sonnet', 'haiku', 'opus', 'fable'].some((needle) =>
      model.includes(needle)
    )
  ) {
    return 'anthropic'
  }
  if (['gpt', 'openai', 'codex'].some((needle) => model.includes(needle))) {
    return 'codex'
  }
  return 'unknown'
}

function automationModelLabel(tone: string): string {
  if (tone === 'anthropic') {
    return 'Anthropic model family'
  }
  if (tone === 'codex') {
    return 'Codex/OpenAI model family'
  }
  if (tone === 'antigravity') {
    return 'Google DeepMind model family'
  }
  return 'model family unknown'
}

function castingCostPipCount(cost: number): number {
  if (cost <= 0) {
    return 0
  }
  if (cost < 1) {
    return 1
  }
  if (cost < 5) {
    return 2
  }
  if (cost < 20) {
    return 3
  }
  if (cost < 100) {
    return 4
  }
  return Math.min(99, 5 + Math.floor((cost - 100) / 100))
}

export function automationCastingCost(item: XosGoal): {
  pips: { count?: number; tone: string }[]
  count: number
  label: string
} {
  const cost = item.viewer.usage7d.maxRunCost
  const tokens = item.viewer.usage7d.maxRunTokens
  const filledCount = castingCostPipCount(cost)
  const tone = automationModelTone(item)
  const modelLabel = automationModelLabel(tone)
  return {
    // Unlike the Laravel board, show the provider even before usage exists: the runner is known.
    pips: filledCount > 1 ? [{ count: filledCount - 1, tone: 'numbered' }, { tone }] : [{ tone }],
    count: filledCount,
    label:
      cost > 0
        ? `${filledCount} cost ${filledCount === 1 ? 'pip' : 'pips'} from the most expensive run this week: ${formatCurrency(cost)} (${formatCompactNumber(tokens)} tokens tracked across ${item.viewer.usage7d.runs} ${item.viewer.usage7d.runs === 1 ? 'run' : 'runs'}). ${modelLabel}.`
        : `Casting cost unknown until this goal records token usage. ${modelLabel}.`
  }
}

function reasoningToughnessScore(reasoning: string | null): number {
  const normalized = reasoning?.toLowerCase() ?? ''
  if (normalized === '') {
    return 5
  }
  if (
    normalized.includes('max') ||
    normalized.includes('high') ||
    normalized.includes('extended')
  ) {
    return 10
  }
  if (normalized.includes('medium') || normalized.includes('standard')) {
    return 7
  }
  if (normalized.includes('low') || normalized.includes('minimal')) {
    return 4
  }
  return 6
}

export function automationBattleStats(item: XosGoal): {
  power: number
  toughness: number
  label: string
} {
  const model = modelOf(item)
  const reasoning = preferredTelemetryValue(
    item.viewer.latestRun?.reasoning_effort,
    item.viewer.configuredReasoning
  )
  const modelStrength = modelStrengthScore(model)
  const power = modelStrength.score
  const toughness = reasoningToughnessScore(reasoning)
  return {
    power,
    toughness,
    label: `Model strength ${power}/10 from ${modelStrength.label} (${modelStrength.source}); reasoning depth ${toughness}/10 from ${reasoning ?? 'unknown reasoning effort'}.`
  }
}

export function automationRunSucceeded(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized.includes('success') || normalized.includes('pass') || normalized.includes('finished')
  )
}

export function automationRunFailed(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized.includes('fail') || normalized.includes('error') || normalized.includes('blocked')
  )
}

export function automationRunTone(status: string): AutomationRunTone {
  if (automationRunSucceeded(status)) {
    return 'success'
  }
  if (automationRunFailed(status)) {
    return 'danger'
  }
  return 'warning'
}

export function automationPerformanceProfile(item: XosGoal): {
  successStreak: number
  recentFailures: number
  hasCurrentIssue: boolean
} {
  const successStreak = item.viewer.recentRuns.findIndex(
    (run) => !automationRunSucceeded(run.status)
  )
  const result = item.result.toLowerCase()
  return {
    successStreak: successStreak === -1 ? item.viewer.recentRuns.length : successStreak,
    recentFailures: item.viewer.recentRuns.filter((run) => automationRunFailed(run.status)).length,
    hasCurrentIssue: ['action_needed', 'action needed', 'fail', 'error', 'blocked'].some((needle) =>
      result.includes(needle)
    )
  }
}

export type RunMeter = {
  bars: {
    key: string
    tone: AutomationRunTone
    label: string
    isLatest: boolean
    isEmpty: boolean
  }[]
  latestTone: AutomationRunTone
  label: string
  streakTone: AutomationRunTone | null
}

export function automationRunBattleMeter(item: XosGoal): RunMeter {
  const runs = item.viewer.recentRuns.slice(0, 5)
  const bars = Array.from({ length: 5 }, (_, index) => {
    const run = runs[index] ?? null
    const tone: AutomationRunTone = run ? automationRunTone(run.status) : 'warning'
    const status = run?.status || 'no run recorded'
    const timestamp = run ? run.finished_at || run.started_at || null : null
    return {
      key: run ? `${run.log_path}-${run.started_at}` : `empty-${index}`,
      tone,
      label: `Run ${index + 1}: ${status}${timestamp ? ` at ${formatTimestamp(timestamp)}` : ''}`,
      isLatest: index === 0,
      isEmpty: run === null
    }
  })
  const latestTone = bars[0]?.tone ?? 'warning'
  const streakTone =
    runs.length === 5 && bars.every((bar) => bar.tone === bars[0]?.tone) ? bars[0].tone : null
  const latestStatus = runs[0]?.status || item.result || 'no run recorded'
  const operator =
    item.area.id === 'c-suite' ? 'Regent' : item.goal === item.area.manager ? 'Marshal' : 'operator'
  return {
    bars,
    latestTone,
    streakTone,
    label:
      streakTone === 'success'
        ? 'Last five runs power bar. Locked in: five green runs in a row.'
        : streakTone === 'warning'
          ? `Last five runs power bar. Warning streak: five yellow runs in a row. ${operator} should inspect the pattern.`
          : streakTone === 'danger'
            ? `Last five runs power bar. Fire streak: five red runs in a row. ${operator} should step in now.`
            : latestTone === 'success'
              ? `Last five runs power bar. Latest run is green: ${latestStatus}.`
              : `Last five runs power bar. Latest run is ${latestTone === 'danger' ? 'red' : 'yellow'}: ${latestStatus}. ${operator} should step in.`
  }
}

/** Card class list shared by the board card and the Goal Viewer hero. */
export function cardToneClasses(meter: RunMeter): string[] {
  return [
    meter.latestTone === 'danger' ? 'ops-spell-card-fire' : '',
    meter.latestTone === 'warning' ? 'ops-spell-card-watch' : '',
    meter.streakTone === 'success' ? 'ops-spell-card-locked-in' : '',
    meter.streakTone === 'warning' ? 'ops-spell-card-warning-streak' : '',
    meter.streakTone === 'danger' ? 'ops-spell-card-fire-streak' : ''
  ].filter(Boolean)
}
