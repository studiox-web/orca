import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashCrontab, parseCrontabWithPaused, PAUSED_MARKER, readCrontabText } from './xos-crontab'
import {
  appendManagedCronLine,
  editCronLine,
  goalScheduleCommand,
  MANAGED_COMMENT,
  removeCronLines,
  validateCronLine
} from './xos-crontab-edit'

const GOAL_LINE =
  '25 10 * * * cd /srv/dj && /usr/bin/env PATH=/usr/bin:/bin ./automations/bin/run-goal-cron.sh content-writer codex'
const SCRIPT_LINE = '30 4 * * * cd /srv/dj && php artisan sync >> storage/logs/sync.log 2>&1'
const CRONTAB = `# loop\n${GOAL_LINE}\n${PAUSED_MARKER}${SCRIPT_LINE}\n`

describe('validateCronLine', () => {
  it('accepts five-field schedules and macros', () => {
    expect(validateCronLine(' 5  4 * * 1 ', 'echo hi')).toBe('5 4 * * 1 echo hi')
    expect(validateCronLine('@daily', 'echo hi')).toBe('@daily echo hi')
  })
  it('rejects bad schedules, empty commands and multi-line input', () => {
    expect(validateCronLine('every day', 'echo hi')).toHaveProperty('error')
    expect(validateCronLine('foo bar baz qux quux', 'echo hi')).toHaveProperty('error')
    expect(validateCronLine('5 4 * * *', '')).toHaveProperty('error')
    expect(validateCronLine('5 4 * * *', 'echo a\n* * * * * rm -rf ~')).toHaveProperty('error')
  })
})

describe('goalScheduleCommand', () => {
  it('copies a sibling goal line so PATH and cd match', () => {
    expect(
      goalScheduleCommand({
        root: '/srv/dj',
        goal: 'festival-curator',
        runner: 'claude',
        siblingCommands: [SCRIPT_LINE, GOAL_LINE.slice('25 10 * * * '.length)]
      })
    ).toBe(
      'cd /srv/dj && /usr/bin/env PATH=/usr/bin:/bin ./automations/bin/run-goal-cron.sh festival-curator claude'
    )
  })
  it('falls back to the plain runner and rejects bad names', () => {
    expect(
      goalScheduleCommand({ root: '/srv/dj', goal: 'x-y', runner: 'codex', siblingCommands: [] })
    ).toBe('cd "/srv/dj" && ./automations/bin/run-goal-cron.sh x-y codex')
    expect(
      goalScheduleCommand({ root: '/srv/dj', goal: 'a; rm', runner: 'codex', siblingCommands: [] })
    ).toHaveProperty('error')
  })
})

describe('crontab edits', () => {
  let dir: string
  let savedPath: string | undefined
  let savedHome: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xos-crontab-edit-'))
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

  const lineFor = (text: string, needle: string) =>
    parseCrontabWithPaused(text).find((entry) => entry.command.includes(needle))!

  it('edits a paused line and keeps it paused', async () => {
    const result = await editCronLine({
      adopt: true,
      id: lineFor(CRONTAB, 'artisan').id,
      schedule: '45 5 * * *',
      command: 'cd /srv/dj && php artisan sync',
      expectedHash: hashCrontab(CRONTAB),
      reason: 'test'
    })
    expect(result).toEqual({ ok: true, changed: 1 })
    expect(await readCrontabText()).toBe(
      `# loop\n${GOAL_LINE}\n${PAUSED_MARKER}45 5 * * * cd /srv/dj && php artisan sync\n`
    )
  })

  it('appends a managed line and removes it together with its comment', async () => {
    const added = await appendManagedCronLine({
      label: 'dj festival-curator',
      schedule: '0 9 * * *',
      command: 'echo run',
      expectedHash: hashCrontab(CRONTAB),
      reason: 'test'
    })
    expect(added).toEqual({ ok: true, changed: 1 })
    const afterAdd = await readCrontabText()
    expect(afterAdd).toBe(`${CRONTAB}${MANAGED_COMMENT}: dj festival-curator\n0 9 * * * echo run\n`)

    const removed = await removeCronLines({
      adopt: true,
      ids: new Set([lineFor(afterAdd, 'echo run').id]),
      expectedHash: hashCrontab(afterAdd),
      reason: 'test'
    })
    expect(removed).toEqual({ ok: true, changed: 1 })
    expect(await readCrontabText()).toBe(CRONTAB)
  })

  it('refuses edits against a stale hash', async () => {
    const result = await removeCronLines({
      adopt: true,
      ids: new Set([lineFor(CRONTAB, 'run-goal').id]),
      expectedHash: hashCrontab('older'),
      reason: 'test'
    })
    expect(result.ok).toBe(false)
    expect(await readCrontabText()).toBe(CRONTAB)
  })
})
