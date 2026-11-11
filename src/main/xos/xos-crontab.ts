// XOS fork: legacy crontab lines as goal schedules, with guarded pause/resume.
// Pausing comments a line out with a marker (never deletes it), every write is preceded by a
// backup, refused when the crontab changed since the board read it, and recorded in the audit log.
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { parseCrontab, type CrontabEntry } from '../automations/external-crontab-jobs'
import { nextAutomationOccurrenceAfter } from '../../shared/automation-schedule-occurrences'
import type { XosCronJob } from '../../shared/xos-goals-types'
import { guardCronWrite } from './xos-crontab-adoption'
import { xosHome } from './xos-home'

export { xosHome }

export const PAUSED_MARKER = '#orca-xos-paused# '
/** Lines the operator paused by hand for the migration; visible, never bulk-resumed (C2). */
const MIGRATION_PAUSE = /^#\s*PAUSED FOR ORCA MIGRATION [\d-]+:\s*/
const BACKUP_KEEP = 50

async function run(
  program: string,
  args: string[],
  input?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await runProcess({
      program,
      args,
      input,
      timeoutMs: 10_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { code: 1, stdout: '', stderr: String(error) }
  }
}

/** Throws when unreadable: an unread table must never look like an empty one (M13). */
export async function readCrontabText(): Promise<string> {
  const result = await run('crontab', ['-l'])
  if (result.code === 0) {
    return result.stdout
  }
  // `crontab -l` exits non-zero with "no crontab for <user>" when none is installed.
  if (/no crontab for/i.test(result.stderr)) {
    return ''
  }
  throw new Error(`Could not read the crontab: ${result.stderr.trim() || `exit ${result.code}`}`)
}

export function hashCrontab(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export type XosCronPausedBy = 'orca' | 'migration'

export type ParsedCronLine = CrontabEntry & {
  paused: boolean
  pausedBy: XosCronPausedBy | null
  lineIndex: number
}

function pauseOf(line: string): { by: XosCronPausedBy; body: string } | null {
  if (line.startsWith(PAUSED_MARKER)) {
    return { by: 'orca', body: line.slice(PAUSED_MARKER.length) }
  }
  const migration = MIGRATION_PAUSE.exec(line)
  return migration ? { by: 'migration', body: line.slice(migration[0].length) } : null
}

/** Parses active and XOS-paused lines; ids are the same in both states. */
export function parseCrontabWithPaused(text: string): ParsedCronLine[] {
  const lines = text.split('\n')
  const out: ParsedCronLine[] = []
  lines.forEach((line, lineIndex) => {
    const pause = pauseOf(line)
    const body = pause?.body ?? line
    if (!body.trim() || body.trim().startsWith('#')) {
      return
    }
    const [entry] = parseCrontab(body)
    if (entry) {
      out.push({ ...entry, paused: pause !== null, pausedBy: pause?.by ?? null, lineIndex })
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
    pausedBy: entry.pausedBy,
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

export type CrontabWriteResult = { ok: true; changed: number } | { ok: false; error: string }

/**
 * The one guarded write path: refuses when the crontab no longer matches the hash the caller saw
 * (so an edit made elsewhere, by crontab -e or an installer script, is never overwritten), backs
 * the old table up, installs the new one and records the change in the audit log.
 */
export async function rewriteCrontab(args: {
  expectedHash: string
  edit: (text: string) => { next: string; changed: string[] } | { error: string }
  audit: Record<string, unknown>
}): Promise<CrontabWriteResult> {
  let text: string
  try {
    text = await readCrontabText()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (hashCrontab(text) !== args.expectedHash) {
    return {
      ok: false,
      error: 'The crontab changed since the board loaded. Refresh and try again.'
    }
  }
  const edited = args.edit(text)
  if ('error' in edited) {
    return { ok: false, error: edited.error }
  }
  if (edited.changed.length === 0) {
    return { ok: true, changed: 0 }
  }
  let next = edited.next
  if (next && !next.endsWith('\n')) {
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
  audit({ ...args.audit, lines: edited.changed, backup })
  return { ok: true, changed: edited.changed.length }
}

/** Pauses (comments out with a marker) or resumes the given line ids. */
export function setCronLinesPaused(args: {
  ids: ReadonlySet<string>
  paused: boolean
  expectedHash: string
  reason: string
  /** The operator adopts unmanaged lines by doing this. */
  adopt?: boolean
  /** Only a resume aimed at one line may undo a manual migration pause (C2). */
  includeMigrationPaused?: boolean
}): Promise<CrontabWriteResult> {
  return rewriteCrontab({
    expectedHash: args.expectedHash,
    audit: { action: args.paused ? 'cron.pause' : 'cron.resume', reason: args.reason },
    edit: (text) => {
      const lines = text.split('\n')
      const targets = parseCrontabWithPaused(text).filter(
        (entry) =>
          args.ids.has(entry.id) &&
          entry.paused !== args.paused &&
          (entry.pausedBy !== 'migration' || args.includeMigrationPaused === true)
      )
      const refused = guardCronWrite({ lines, targets, adopt: args.adopt === true })
      if (refused) {
        return { error: refused }
      }
      for (const entry of targets) {
        const line = lines[entry.lineIndex]
        lines[entry.lineIndex] = args.paused
          ? `${PAUSED_MARKER}${line}`
          : (pauseOf(line)?.body ?? line)
      }
      if (targets.some((entry) => entry.pausedBy === 'migration')) {
        restoreMigrationEnvLines(lines)
      }
      return { next: lines.join('\n'), changed: targets.map((entry) => entry.command) }
    }
  })
}

/** A job back from a migration pause needs the CRON_TZ-style lines paused with it. */
function restoreMigrationEnvLines(lines: string[]): void {
  lines.forEach((line, index) => {
    const pause = pauseOf(line)
    if (pause?.by === 'migration' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(pause.body.trim())) {
      lines[index] = pause.body
    }
  })
}
