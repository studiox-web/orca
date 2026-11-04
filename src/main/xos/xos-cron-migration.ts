// XOS fork: C2. A read-only map from crontab lines to what replaces them, and the cutover rules.
// Replacements are always created disabled; nothing here enables a schedule or edits the crontab.
import type { XosAutomationRunConfig } from '../../shared/xos-runtime-types'
import { goalForCommand, parseCrontabWithPaused, type ParsedCronLine } from './xos-crontab'
import { listProjectGoals } from './xos-project-home'

export type XosMigrationState =
  /** Still scheduled by cron: a replacement would be skipped until the line is paused. */
  | 'legacy-active'
  /** Paused, nothing replaces it yet: this job is not running anywhere. */
  | 'not-running'
  /** A bound automation exists; enable it once it was reviewed. */
  | 'replacement-ready'

export type XosMigrationEntry = {
  id: string
  schedule: string
  cronExpression: string | null
  command: string
  workdir: string | null
  kind: 'goal' | 'script'
  goal: string | null
  runner: string | null
  pausedBy: ParsedCronLine['pausedBy']
  replacementAutomationId: string | null
  state: XosMigrationState
}

export type XosMigrationPlan = {
  entries: XosMigrationEntry[]
  /** Paused directives such as CRON_TZ: not jobs, but they change when the jobs run. */
  pausedDirectives: string[]
  timezone: string | null
}

function replacementFor(
  line: ParsedCronLine,
  goal: string | null,
  configs: Record<string, XosAutomationRunConfig>
): string | null {
  for (const [id, config] of Object.entries(configs)) {
    if (config.script?.replacesCronCommand === line.command) {
      return id
    }
    if (goal && config.goal?.goal === goal && line.workdir?.startsWith(config.goal.repoRoot)) {
      return id
    }
  }
  return null
}

function directives(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^#.*?:\s*([A-Za-z_][A-Za-z0-9_]*=.*)$/.exec(line)?.[1])
    .filter((line): line is string => Boolean(line))
}

export function buildMigrationPlan(
  text: string,
  configs: Record<string, XosAutomationRunConfig>
): XosMigrationPlan {
  const pausedDirectives = directives(text)
  const timezone =
    /^CRON_TZ=(.+)$/m.exec(text)?.[1]?.trim() ??
    pausedDirectives
      .find((line) => line.startsWith('CRON_TZ='))
      ?.slice('CRON_TZ='.length)
      .trim() ??
    null
  const entries = parseCrontabWithPaused(text).map((line): XosMigrationEntry => {
    const known = new Set(line.workdir ? listProjectGoals(line.workdir) : [])
    const { goal, runner } = goalForCommand(line.command, known)
    const replacementAutomationId = replacementFor(line, goal, configs)
    return {
      id: line.id,
      schedule: line.rawSchedule,
      cronExpression: line.cronExpression,
      command: line.command,
      workdir: line.workdir,
      kind: goal ? 'goal' : 'script',
      goal,
      runner,
      pausedBy: line.pausedBy,
      replacementAutomationId,
      state: !line.paused
        ? 'legacy-active'
        : replacementAutomationId
          ? 'replacement-ready'
          : 'not-running'
    }
  })
  return { entries, pausedDirectives, timezone }
}
