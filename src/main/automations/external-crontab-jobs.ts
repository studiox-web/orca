import { createHash } from 'node:crypto'
import { isAbsolute, join, posix } from 'node:path'
import type { ExternalAutomationJob, ExternalAutomationRun } from '../../shared/automations-types'
import { nextAutomationOccurrenceAfter } from '../../shared/automation-schedule-occurrences'

/** One schedulable line from `crontab -l`, with the shell plumbing peeled off for display. */
export type CrontabEntry = {
  /** Stable across unrelated crontab edits: derived from the schedule and command only. */
  id: string
  rawSchedule: string
  /** Five-field expression the shared cron engine can evaluate; null for `@reboot`. */
  cronExpression: string | null
  command: string
  name: string
  /** The nearest `# BEGIN <section>` marker or comment above the line, if any. */
  section: string | null
  workdir: string | null
  /** First stdout redirect target (`>> file` / `> file`), resolved against `workdir`. */
  logPath: string | null
}

/** Last-run evidence for one entry; supplied by the caller so parsing stays pure. */
export type CrontabRunEvidence = {
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  runs: Omit<ExternalAutomationRun, 'managerId' | 'provider' | 'jobId'>[]
}

const CRON_MACROS: Record<string, string | null> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@reboot': null
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const NAME_TOKEN_LIMIT = 3

function stableId(schedule: string, command: string): string {
  return `cron-${createHash('sha256').update(`${schedule}\n${command}`).digest('hex').slice(0, 12)}`
}

function splitScheduleAndCommand(
  line: string
): { rawSchedule: string; cronExpression: string | null; command: string } | null {
  const trimmed = line.trim()
  if (trimmed.startsWith('@')) {
    const match = /^(@\S+)\s+(.+)$/.exec(trimmed)
    if (!match || !Object.hasOwn(CRON_MACROS, match[1])) {
      return null
    }
    return { rawSchedule: match[1], cronExpression: CRON_MACROS[match[1]], command: match[2] }
  }
  const match = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(trimmed)
  if (!match) {
    return null
  }
  const expression = match.slice(1, 6).join(' ')
  return { rawSchedule: expression, cronExpression: expression, command: match[6] }
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

/** Peels `cd <dir> &&`, `/usr/bin/env VAR=...`, and redirections so the name shows the real program. */
function describeCommand(command: string): {
  workdir: string | null
  logTarget: string | null
  name: string
} {
  let rest = command.trim()
  let workdir: string | null = null
  const cdMatch = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*(.*)$/.exec(rest)
  if (cdMatch) {
    workdir = unquote(cdMatch[1])
    rest = cdMatch[2]
  }
  const redirect = /(?:^|\s)(?:1)?>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/.exec(rest)
  const logTarget = redirect ? unquote(redirect[1]) : null
  const tokens = rest
    .replace(/\s\d?>>?\s*\S+/g, ' ')
    .replace(/\s\d?>&\d/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  let index = 0
  if (tokens[index] === '/usr/bin/env' || tokens[index] === 'env') {
    index += 1
  }
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index])) {
    index += 1
  }
  const program = tokens
    .slice(index, index + NAME_TOKEN_LIMIT)
    .map((token, position) => (position === 0 ? posix.basename(unquote(token)) : unquote(token)))
  return { workdir, logTarget, name: program.join(' ') || command.trim() }
}

function resolveLogPath(target: string | null, workdir: string | null): string | null {
  if (!target || target === '/dev/null') {
    return null
  }
  if (target.startsWith('~/')) {
    return null
  }
  if (isAbsolute(target)) {
    return target
  }
  return workdir ? join(workdir, target) : null
}

/** Parses `crontab -l` text; comments, blank lines, and environment lines are not jobs. */
export function parseCrontab(text: string): CrontabEntry[] {
  const entries: CrontabEntry[] = []
  let section: string | null = null
  let lastComment: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      lastComment = null
      continue
    }
    if (trimmed.startsWith('#')) {
      const body = trimmed.replace(/^#+\s*/, '')
      const begin = /^BEGIN\s+(.+)$/.exec(body)
      if (begin) {
        section = begin[1].trim()
        lastComment = null
      } else if (/^END\b/.test(body)) {
        section = null
        lastComment = null
      } else if (body) {
        lastComment = body
      }
      continue
    }
    if (ENV_ASSIGNMENT.test(trimmed)) {
      continue
    }
    const parsed = splitScheduleAndCommand(trimmed)
    if (!parsed) {
      continue
    }
    const described = describeCommand(parsed.command)
    entries.push({
      id: stableId(parsed.rawSchedule, parsed.command),
      rawSchedule: parsed.rawSchedule,
      cronExpression: parsed.cronExpression,
      command: parsed.command,
      name: described.name,
      section: section ?? lastComment,
      workdir: described.workdir,
      logPath: resolveLogPath(described.logTarget, described.workdir)
    })
  }
  return entries
}

function nextRunAt(entry: CrontabEntry, now: number): string | null {
  if (!entry.cronExpression) {
    return null
  }
  try {
    return new Date(nextAutomationOccurrenceAfter(entry.cronExpression, 0, now)).toISOString()
  } catch {
    return null
  }
}

export function mapCrontabJobs(args: {
  managerId: string
  entries: CrontabEntry[]
  now: number
  evidence: ReadonlyMap<string, CrontabRunEvidence>
}): ExternalAutomationJob[] {
  return args.entries.map((entry) => {
    const evidence = args.evidence.get(entry.id)
    const preview = entry.section ? `${entry.section} · ${entry.command}` : entry.command
    return {
      id: entry.id,
      managerId: args.managerId,
      provider: 'crontab',
      name: entry.name,
      schedule: entry.cronExpression ? `cron ${entry.cronExpression}` : entry.rawSchedule,
      rawSchedule: entry.cronExpression,
      enabled: true,
      state: evidence?.lastStatus ?? 'idle',
      prompt: entry.command,
      promptPreview: preview.length > 120 ? `${preview.slice(0, 117)}...` : preview,
      nextRunAt: nextRunAt(entry, args.now),
      lastRunAt: evidence?.lastRunAt ?? null,
      lastStatus: evidence?.lastStatus ?? null,
      lastError: evidence?.lastError ?? null,
      workdir: entry.workdir,
      runCount: evidence?.runs.length ?? 0,
      runs: (evidence?.runs ?? []).map((run) => ({
        ...run,
        managerId: args.managerId,
        provider: 'crontab',
        jobId: entry.id
      }))
    }
  })
}
