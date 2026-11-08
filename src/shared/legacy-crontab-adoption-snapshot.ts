import { createHash } from 'node:crypto'
import type { AutomationOwnerRef } from './automation-owner-ref'
import { parseCronExpression } from './automation-schedule-parsing'

export type LegacyCrontabScope = {
  authority: AutomationOwnerRef
  user: string
  managerId: string
}

export type LegacyCrontabPauseProvenance =
  | { kind: 'orca'; marker: '#orca-xos-paused#' }
  | { kind: 'migration'; marker: string }

export type LegacyCrontabTimezoneProvenance =
  | { kind: 'host-default' }
  | {
      kind: 'cron-tz'
      lineIndex: number
      rawLineDigest: string
      pause: LegacyCrontabPauseProvenance | null
    }

export type LegacyCrontabSchedule = {
  format: 'cron' | 'macro'
  expression: string
  normalizedExpression: string | null
  support: 'supported' | 'unsupported-dialect' | 'unsupported-macro'
  unsupportedReason: string | null
}

export type LegacyCrontabOccurrenceIdentity = LegacyCrontabScope & {
  sourceRevision: string
  lineIndex: number
  occurrenceOrdinal: number
  rawLineDigest: string
}

export type LegacyCrontabOccurrence = {
  identity: LegacyCrontabOccurrenceIdentity
  identicalOccurrenceCount: number
  state: 'enabled' | 'paused'
  pause: LegacyCrontabPauseProvenance | null
  schedule: LegacyCrontabSchedule
  timezone: {
    value: string | null
    provenance: LegacyCrontabTimezoneProvenance
  }
  command: {
    display: string
    digest: string
    cwd: string | null
  }
}

export type LegacyCrontabSnapshot = {
  scope: LegacyCrontabScope
  revision: string
  occurrences: LegacyCrontabOccurrence[]
}

type TimezoneDirective = {
  value: string
  lineIndex: number
  rawLineDigest: string
  pause: LegacyCrontabPauseProvenance | null
}

const ORCA_PAUSE_PREFIX = '#orca-xos-paused# '
const MIGRATION_PAUSE = /^(#\s*PAUSED FOR ORCA MIGRATION(?:\s+[^:]+)?:\s*)/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\s*=/
const CRON_TZ_ASSIGNMENT = /^CRON_TZ\s*=\s*(.*?)\s*$/
const MACRO_EXPRESSIONS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function unquote(value: string): string {
  const trimmed = value.trim()
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed
}

function pauseProvenance(
  line: string
): { body: string; pause: LegacyCrontabPauseProvenance } | null {
  if (line.startsWith(ORCA_PAUSE_PREFIX)) {
    return {
      body: line.slice(ORCA_PAUSE_PREFIX.length),
      pause: { kind: 'orca', marker: '#orca-xos-paused#' }
    }
  }
  const migration = MIGRATION_PAUSE.exec(line)
  return migration
    ? {
        body: line.slice(migration[1].length),
        pause: { kind: 'migration', marker: migration[1].trimEnd() }
      }
    : null
}

function parseScheduleAndCommand(
  body: string
): { schedule: LegacyCrontabSchedule; command: string } | null {
  const trimmed = body.trim()
  if (trimmed.startsWith('@')) {
    const match = /^(@\S+)\s+(.+)$/.exec(trimmed)
    if (!match) {
      return null
    }
    const normalizedExpression = MACRO_EXPRESSIONS[match[1]] ?? null
    return {
      schedule: {
        format: 'macro',
        expression: match[1],
        normalizedExpression,
        support: normalizedExpression ? 'supported' : 'unsupported-macro',
        unsupportedReason: normalizedExpression ? null : `Unsupported crontab macro ${match[1]}.`
      },
      command: match[2]
    }
  }
  const extended = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(trimmed)
  if (extended && /^(?:\*|\?|[0-9*/?,#L-]+)$/i.test(extended[6])) {
    const expression = extended.slice(1, 7).join(' ')
    return {
      schedule: {
        format: 'cron',
        expression,
        normalizedExpression: null,
        support: 'unsupported-dialect',
        unsupportedReason: 'Cron schedules must use the five-field crontab dialect.'
      },
      command: extended[7]
    }
  }
  const match = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(trimmed)
  if (!match) {
    return null
  }
  const expression = match.slice(1, 6).join(' ')
  let unsupportedReason: string | null = null
  try {
    parseCronExpression(expression)
  } catch (error) {
    unsupportedReason = error instanceof Error ? error.message : String(error)
  }
  return {
    schedule: {
      format: 'cron',
      expression,
      normalizedExpression: unsupportedReason ? null : expression,
      support: unsupportedReason ? 'unsupported-dialect' : 'supported',
      unsupportedReason
    },
    command: match[6]
  }
}

function commandParts(command: string): { display: string; cwd: string | null } {
  let executableText = command.trim()
  let cwd: string | null = null
  const cd = /^cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)\s*(.*)$/.exec(executableText)
  if (cd) {
    cwd = unquote(cd[1])
    executableText = cd[2].trim()
  }
  const tokens = executableText.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []
  let index = tokens[0] === 'env' || tokens[0] === '/usr/bin/env' ? 1 : 0
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1
  }
  const executable = unquote(tokens[index] ?? '')
  const basename = executable.split(/[\\/]/).at(-1) ?? ''
  const safeName = /^[A-Za-z0-9._+-]+$/.test(basename) ? basename : '[redacted command]'
  return {
    display: tokens.length > index + 1 ? `${safeName} …` : safeName,
    cwd
  }
}

function timezoneFor(
  lineIndex: number,
  pause: LegacyCrontabPauseProvenance | null,
  active: TimezoneDirective | null,
  paused: ReadonlyMap<LegacyCrontabPauseProvenance['kind'], TimezoneDirective>
): LegacyCrontabOccurrence['timezone'] {
  const pausedDirective = pause ? paused.get(pause.kind) : null
  const directive =
    pausedDirective &&
    pausedDirective.lineIndex < lineIndex &&
    pausedDirective.lineIndex > (active?.lineIndex ?? -1)
      ? pausedDirective
      : active
  return directive
    ? {
        value: directive.value,
        provenance: {
          kind: 'cron-tz',
          lineIndex: directive.lineIndex,
          rawLineDigest: directive.rawLineDigest,
          pause: directive.pause
        }
      }
    : { value: null, provenance: { kind: 'host-default' } }
}

export function parseLegacyCrontabSnapshot(args: {
  text: string
  scope: LegacyCrontabScope
}): LegacyCrontabSnapshot {
  const revision = digest(args.text)
  const occurrences: LegacyCrontabOccurrence[] = []
  const ordinals = new Map<string, number>()
  const pausedTimezones = new Map<LegacyCrontabPauseProvenance['kind'], TimezoneDirective>()
  let activeTimezone: TimezoneDirective | null = null

  args.text.split(/\r\n|\n|\r/).forEach((rawLine, lineIndex) => {
    const pausedLine = pauseProvenance(rawLine)
    const pause = pausedLine?.pause ?? null
    const body = pausedLine?.body ?? rawLine
    const trimmed = body.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }
    const timezone = CRON_TZ_ASSIGNMENT.exec(trimmed)
    if (timezone) {
      const directive = {
        value: unquote(timezone[1]),
        lineIndex,
        rawLineDigest: digest(rawLine),
        pause
      }
      if (pause) {
        pausedTimezones.set(pause.kind, directive)
      } else {
        activeTimezone = directive
      }
      return
    }
    if (ENV_ASSIGNMENT.test(trimmed)) {
      return
    }
    const parsed = parseScheduleAndCommand(body)
    if (!parsed) {
      return
    }
    const rawLineDigest = digest(rawLine)
    const occurrenceOrdinal = ordinals.get(rawLineDigest) ?? 0
    ordinals.set(rawLineDigest, occurrenceOrdinal + 1)
    const command = commandParts(parsed.command)
    occurrences.push({
      identity: {
        ...args.scope,
        sourceRevision: revision,
        lineIndex,
        occurrenceOrdinal,
        rawLineDigest
      },
      identicalOccurrenceCount: 0,
      state: pause ? 'paused' : 'enabled',
      pause,
      schedule: parsed.schedule,
      timezone: timezoneFor(lineIndex, pause, activeTimezone, pausedTimezones),
      command: {
        display: command.display,
        digest: digest(parsed.command),
        cwd: command.cwd
      }
    })
  })

  const duplicateCounts = new Map<string, number>()
  for (const occurrence of occurrences) {
    const key = occurrence.identity.rawLineDigest
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1)
  }
  return {
    scope: args.scope,
    revision,
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      identicalOccurrenceCount: duplicateCounts.get(occurrence.identity.rawLineDigest) ?? 1
    }))
  }
}
