import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  goalForCommand,
  hashCrontab,
  parseCrontabWithPaused,
  PAUSED_MARKER,
  readCrontabText,
  setCronLinesPaused
} from './xos-crontab'

const GOAL_LINE =
  '25 10 * * * cd /srv/djvibe && /usr/bin/env PATH=/usr/bin:/bin ./automations/bin/run-goal-cron.sh content-trend-researcher codex'
const WRAPPER_LINE =
  '25 14 * * * cd /srv/djvibe && ./automations/bin/run-content-writer-cron.sh >> storage/logs/automations/w.log 2>&1'
const SCRIPT_LINE =
  '30 4 * * * cd /srv/djvibe && php artisan djvibe:sync-feeds >> storage/logs/sync.log 2>&1'
const CRONTAB = `CRON_TZ=America/Vancouver\n# content loop\n${GOAL_LINE}\n${WRAPPER_LINE}\n${PAUSED_MARKER}${SCRIPT_LINE}\n`

describe('parseCrontabWithPaused', () => {
  it('keeps paused lines with the same id they had while active', () => {
    const active = parseCrontabWithPaused(`${SCRIPT_LINE}\n`)
    const paused = parseCrontabWithPaused(CRONTAB)
    const script = paused.find((entry) => entry.command.includes('sync-feeds'))
    expect(paused).toHaveLength(3)
    expect(script?.paused).toBe(true)
    expect(script?.id).toBe(active[0].id)
    expect(paused.filter((entry) => !entry.paused)).toHaveLength(2)
  })
})

describe('goalForCommand', () => {
  const known = new Set(['content-writer', 'content-trend-researcher'])
  it('maps goal runner lines and known preflight wrappers to goals', () => {
    expect(goalForCommand(GOAL_LINE, known)).toEqual({
      goal: 'content-trend-researcher',
      runner: 'codex'
    })
    expect(goalForCommand(WRAPPER_LINE, known).goal).toBe('content-writer')
  })
  it('leaves plain scripts and unknown wrappers unmapped', () => {
    expect(goalForCommand(SCRIPT_LINE, known).goal).toBeNull()
    expect(goalForCommand('./automations/bin/run-content-feedback-cron.sh', known).goal).toBeNull()
  })
})

describe('setCronLinesPaused', () => {
  let dir: string
  let savedPath: string | undefined
  let savedHome: string | undefined

  beforeEach(() => {
    // A fake `crontab` on PATH that stores the table in a file, so tests never touch the real one.
    dir = mkdtempSync(join(tmpdir(), 'xos-crontab-'))
    writeFileSync(join(dir, 'table'), CRONTAB)
    const fake = join(dir, 'crontab')
    writeFileSync(
      fake,
      `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${dir}/table"; else cat > "${dir}/table"; fi\n`
    )
    chmodSync(fake, 0o755)
    savedPath = process.env.PATH
    savedHome = process.env.ORCA_XOS_HOME
    process.env.PATH = `${dir}:${savedPath ?? ''}`
    process.env.ORCA_XOS_HOME = join(dir, 'home')
  })

  afterEach(() => {
    process.env.PATH = savedPath
    if (savedHome === undefined) {
      delete process.env.ORCA_XOS_HOME
    } else {
      process.env.ORCA_XOS_HOME = savedHome
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('pauses and resumes a line, backing up and auditing each write', async () => {
    const goal = parseCrontabWithPaused(CRONTAB).find((entry) =>
      entry.command.includes('run-goal-cron')
    )!
    const paused = await setCronLinesPaused({
      ids: new Set([goal.id]),
      paused: true,
      expectedHash: hashCrontab(CRONTAB),
      reason: 'test'
    })
    expect(paused).toEqual({ ok: true, changed: 1 })
    const afterPause = await readCrontabText()
    expect(afterPause).toContain(`${PAUSED_MARKER}${GOAL_LINE}`)
    expect(afterPause).toContain('CRON_TZ=America/Vancouver\n# content loop\n')

    const resumed = await setCronLinesPaused({
      ids: new Set([goal.id]),
      paused: false,
      expectedHash: hashCrontab(afterPause),
      reason: 'test'
    })
    expect(resumed).toEqual({ ok: true, changed: 1 })
    expect(await readCrontabText()).toBe(CRONTAB)
    expect(readdirSync(join(dir, 'home', 'crontab-backups'))).toHaveLength(2)
    const audit = readFileSync(join(dir, 'home', 'audit.jsonl'), 'utf8')
      .trim()
      .split('\n')
    expect(audit.map((line) => JSON.parse(line).action)).toEqual(['cron.pause', 'cron.resume'])
  })

  it('refuses to write when the crontab changed since it was read', async () => {
    const result = await setCronLinesPaused({
      ids: new Set(parseCrontabWithPaused(CRONTAB).map((entry) => entry.id)),
      paused: true,
      expectedHash: hashCrontab('something older'),
      reason: 'test'
    })
    expect(result.ok).toBe(false)
    expect(await readCrontabText()).toBe(CRONTAB)
  })
})
