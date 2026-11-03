// XOS fork: legacy crontab lines as goal schedules, with guarded pause/resume.
// Pausing comments a line out with a marker (never deletes it), every write is preceded by a
// backup, refused when the crontab changed since the board read it, and recorded in the audit log.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseCrontab, type CrontabEntry } from '../automations/external-crontab-jobs'
import { nextAutomationOccurrenceAfter } from '../../shared/automation-schedule-occurrences'
import type { XosCronJob } from '../../shared/xos-goals-types'

export const PAUSED_MARKER = '#orca-xos-paused# '
const BACKUP_KEEP = 50

export function xosHome(): string {
  return process.env.ORCA_XOS_HOME ?? join(homedir(), '.orca-xos')
}

function run(
  program: string,
  args: string[],
  input?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      program,
      args,
      { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
}

export async function readCrontabText(): Promise<string> {
  const result = await run('crontab', ['-l'])
  // `crontab -l` exits non-zero with "no crontab for <user>" when none is installed.
  return result.code === 0 ? result.stdout : ''
}

export function hashCrontab(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export type ParsedCronLine = CrontabEntry & {
  paused: boolean
  lineIndex: number
}

/** Parses active and XOS-paused lines; ids are the same in both states. */
export function parseCrontabWithPaused(text: string): ParsedCronLine[] {
  const lines = text.split('\n')
  const out: ParsedCronLine[] = []
  lines.forEach((line, lineIndex) => {
    const paused = line.startsWith(PAUSED_MARKER)
    const body = paused ? line.slice(PAUSED_MARKER.length) : line
    if (!body.trim() || body.trim().startsWith('#')) {
      return
    }
    const [entry] = parseCrontab(body)
    if (entry) {
      out.push({ ...entry, paused, lineIndex })
    }
  })
  // Section labels come from comments above a line; keep parseCrontab's for active lines.
  const sections = new Map(parseCrontab(text).map((entry) => [entry.id, entry.section]))
  return out.map((entry) => ({
    ...entry,
    section: sections.get(entry.id) ?? entry.section
  }))
}

const GOAL_COMMAND =
  /run-goal(?:-cron)?\.sh\s+([A-Za-z0-9_-]+)(?:\s+(codex|claude|gemini|opencode|agy))?/
const GOAL_WRAPPER = /automations\/bin\/run-([A-Za-z0-9_-]+)-cron\.sh/

/** Goal a cron line runs: `run-goal(-cron).sh <goal>` or a `run-<goal>-cron.sh` preflight wrapper. */
export function goalForCommand(
  command: string,
  knownGoals: ReadonlySet<string>
): { goal: string | null; runner: string | null } {
  const direct = GOAL_COMMAND.exec(command)
  if (direct) {
    return { goal: direct[1], runner: direct[2] ?? null }
  }
  const wrapper = GOAL_WRAPPER.exec(command)
  if (wrapper && knownGoals.has(wrapper[1])) {
    return { goal: wrapper[1], runner: null }
  }
  return { goal: null, runner: null }
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

export function toCronJob(
  entry: ParsedCronLine,
  knownGoals: ReadonlySet<string>,
  now: number
): XosCronJob {
  const { goal, runner } = goalForCommand(entry.command, knownGoals)
  return {
    id: entry.id,
    schedule: entry.rawSchedule,
    command: entry.command,
    name: entry.section && !goal ? `${entry.name}` : entry.name,
    workdir: entry.workdir,
    logPath: entry.logPath,
    goal,
    runner,
    paused: entry.paused,
    nextRunAt: entry.paused ? null : nextRunAt(entry, now)
  }
}

export function audit(event: Record<string, unknown>): void {
  try {
    mkdirSync(xosHome(), { recursive: true })
    appendFileSync(
      join(xosHome(), 'audit.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`
    )
  } catch (error) {
    console.warn('[xos] audit write failed', error)
  }
}

function backupCrontab(text: string): string {
  const dir = join(xosHome(), 'crontab-backups')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `crontab-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
  writeFileSync(path, text, { mode: 0o600 })
  const old = readdirSync(dir)
    .filter((name) => name.startsWith('crontab-'))
    .sort()
    .toReversed()
    .slice(BACKUP_KEEP)
  for (const name of old) {
    rmSync(join(dir, name), { force: true })
  }
  return path
}

/**
 * Pauses or resumes the given line ids. Refuses when the crontab no longer matches the hash the
 * caller saw, so an edit made elsewhere (crontab -e, an installer script) is never overwritten.
 */
export async function setCronLinesPaused(args: {
  ids: ReadonlySet<string>
  paused: boolean
  expectedHash: string
  reason: string
}): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const text = await readCrontabText()
  if (hashCrontab(text) !== args.expectedHash) {
    return {
      ok: false,
      error: 'The crontab changed since the board loaded. Refresh and try again.'
    }
  }
  const lines = text.split('\n')
  const targets = parseCrontabWithPaused(text).filter(
    (entry) => args.ids.has(entry.id) && entry.paused !== args.paused
  )
  if (targets.length === 0) {
    return { ok: true, changed: 0 }
  }
  for (const entry of targets) {
    const line = lines[entry.lineIndex]
    lines[entry.lineIndex] = args.paused
      ? `${PAUSED_MARKER}${line}`
      : line.slice(PAUSED_MARKER.length)
  }
  let next = lines.join('\n')
  if (!next.endsWith('\n')) {
    next += '\n'
  }
  const backup = backupCrontab(text)
  const write = await run('crontab', ['-'], next)
  if (write.code !== 0) {
    return {
      ok: false,
      error: `crontab refused the update: ${write.stderr.trim() || `exit ${write.code}`}`
    }
  }
  audit({
    action: args.paused ? 'cron.pause' : 'cron.resume',
    reason: args.reason,
    lines: targets.map((entry) => entry.command),
    backup
  })
  return { ok: true, changed: targets.length }
}
