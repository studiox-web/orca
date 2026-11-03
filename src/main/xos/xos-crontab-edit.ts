// XOS fork: §3d crontab CRUD for legacy cron jobs: edit a line's schedule/command, remove lines,
// and add a goal schedule. All writes go through rewriteCrontab (hash guard, backup, audit).
import { parseCrontab } from '../automations/external-crontab-jobs'
import { nextAutomationOccurrenceAfter } from '../../shared/automation-schedule-occurrences'
import {
  parseCrontabWithPaused,
  PAUSED_MARKER,
  rewriteCrontab,
  type CrontabWriteResult
} from './xos-crontab'

export const MANAGED_COMMENT = '# orca-xos managed'
const GOAL_LINE =
  /run-goal(?:-cron)?\.sh\s+[A-Za-z0-9_-]+(?:\s+(?:codex|claude|gemini|opencode|agy))?/
const RUNNERS = new Set(['codex', 'claude', 'gemini', 'opencode', 'agy'])

function schedulable(expression: string | null): boolean {
  if (!expression) {
    return false
  }
  try {
    return Number.isFinite(nextAutomationOccurrenceAfter(expression, 0, Date.now()))
  } catch {
    return false
  }
}

/** Checks that `<schedule> <command>` is one valid crontab line; returns the line or an error. */
export function validateCronLine(schedule: string, command: string): string | { error: string } {
  const cleanSchedule = schedule.trim().replace(/\s+/g, ' ')
  const cleanCommand = command.trim()
  if (/[\r\n]/.test(cleanSchedule) || /[\r\n]/.test(cleanCommand)) {
    return { error: 'The schedule and command must each be a single line.' }
  }
  if (!cleanCommand) {
    return { error: 'The command is empty.' }
  }
  if (cleanCommand.startsWith('#')) {
    return { error: 'The command cannot start with "#".' }
  }
  const line = `${cleanSchedule} ${cleanCommand}`
  const [entry] = parseCrontab(line)
  if (!entry || entry.command !== cleanCommand || !schedulable(entry.cronExpression)) {
    return {
      error: `"${cleanSchedule}" is not a crontab schedule (five fields, e.g. "25 10 * * *", or @daily).`
    }
  }
  return line
}

export function editCronLine(args: {
  id: string
  schedule: string
  command: string
  expectedHash: string
  reason: string
}): Promise<CrontabWriteResult> {
  const line = validateCronLine(args.schedule, args.command)
  if (typeof line !== 'string') {
    return Promise.resolve({ ok: false, error: line.error })
  }
  return rewriteCrontab({
    expectedHash: args.expectedHash,
    audit: { action: 'cron.edit', reason: args.reason, to: line },
    edit: (text) => {
      const entry = parseCrontabWithPaused(text).find((candidate) => candidate.id === args.id)
      if (!entry) {
        return { error: 'That crontab line no longer exists. Refresh the board.' }
      }
      const lines = text.split('\n')
      const before = lines[entry.lineIndex]
      // A paused line stays paused after an edit.
      const after = entry.paused ? `${PAUSED_MARKER}${line}` : line
      if (before === after) {
        return { next: text, changed: [] }
      }
      lines[entry.lineIndex] = after
      return { next: lines.join('\n'), changed: [`${before} → ${after}`] }
    }
  })
}

/** Removes lines (and an orca-xos managed comment directly above them). */
export function removeCronLines(args: {
  ids: ReadonlySet<string>
  expectedHash: string
  reason: string
}): Promise<CrontabWriteResult> {
  return rewriteCrontab({
    expectedHash: args.expectedHash,
    audit: { action: 'cron.remove', reason: args.reason },
    edit: (text) => {
      const lines = text.split('\n')
      const targets = parseCrontabWithPaused(text).filter((entry) => args.ids.has(entry.id))
      const drop = new Set<number>()
      for (const entry of targets) {
        drop.add(entry.lineIndex)
        if (lines[entry.lineIndex - 1]?.startsWith(MANAGED_COMMENT)) {
          drop.add(entry.lineIndex - 1)
        }
      }
      return {
        next: lines.filter((_, index) => !drop.has(index)).join('\n'),
        changed: targets.map((entry) => lines[entry.lineIndex])
      }
    }
  })
}

/**
 * The command for a new goal schedule. It copies an existing goal line from the same project
 * (keeping its cd, PATH and wrapper) so the new line runs exactly like its siblings.
 */
export function goalScheduleCommand(args: {
  root: string
  goal: string
  runner: string
  siblingCommands: string[]
}): string | { error: string } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.goal)) {
    return { error: `"${args.goal}" is not a goal folder name.` }
  }
  if (!RUNNERS.has(args.runner)) {
    return { error: `Unknown runner "${args.runner}".` }
  }
  const sibling = args.siblingCommands.find((command) => GOAL_LINE.test(command))
  if (sibling) {
    return sibling
      .replace(GOAL_LINE, `run-goal-cron.sh ${args.goal} ${args.runner}`)
      .replace(/\s+>>\s*\S+\s+2>&1\s*$/, '')
  }
  return `cd ${JSON.stringify(args.root)} && ./automations/bin/run-goal-cron.sh ${args.goal} ${args.runner}`
}

export function appendManagedCronLine(args: {
  label: string
  schedule: string
  command: string
  expectedHash: string
  reason: string
}): Promise<CrontabWriteResult> {
  const line = validateCronLine(args.schedule, args.command)
  if (typeof line !== 'string') {
    return Promise.resolve({ ok: false, error: line.error })
  }
  return rewriteCrontab({
    expectedHash: args.expectedHash,
    audit: { action: 'cron.add', reason: args.reason },
    edit: (text) => {
      const body = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`
      return { next: `${body}${MANAGED_COMMENT}: ${args.label}\n${line}\n`, changed: [line] }
    }
  })
}
