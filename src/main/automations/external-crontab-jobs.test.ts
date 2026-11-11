import { describe, expect, it } from 'vitest'
import { mapCrontabJobs, parseCrontab } from './external-crontab-jobs'

const CRONTAB = `
SHELL=/bin/bash
MAILTO=""
# nightly backup
15 2 * * * cd /srv/app && /usr/bin/env RETENTION_DAYS=120 bash scripts/backup.sh >> /tmp/backup.log 2>&1

# BEGIN APP CONTENT LOOP
30 4 * * * cd /srv/app && /usr/bin/env PATH=/usr/bin:/bin php artisan app:sync-feeds >> storage/logs/sync.log 2>&1
*/5 * * * * cd "/srv/my app" && ./bin/poll.sh --apply
# END APP CONTENT LOOP
@reboot /usr/local/bin/warmup
@daily /usr/local/bin/rotate > /dev/null
@bogus /usr/local/bin/never
not a cron line
`

describe('parseCrontab', () => {
  const entries = parseCrontab(CRONTAB)

  it('keeps only schedulable lines', () => {
    expect(entries.map((entry) => entry.name)).toEqual([
      'bash scripts/backup.sh',
      'php artisan app:sync-feeds',
      'poll.sh --apply',
      'warmup',
      'rotate'
    ])
  })

  it('peels cd, env assignments, and redirects off the command', () => {
    const [backup, sync, poll] = entries
    expect(backup.workdir).toBe('/srv/app')
    expect(backup.logPath).toBe('/tmp/backup.log')
    expect(sync.logPath).toBe('/srv/app/storage/logs/sync.log')
    expect(poll.workdir).toBe('/srv/my app')
    expect(poll.logPath).toBeNull()
  })

  it('labels jobs with their BEGIN section or the comment directly above', () => {
    expect(entries.map((entry) => entry.section)).toEqual([
      'nightly backup',
      'APP CONTENT LOOP',
      'APP CONTENT LOOP',
      null,
      null
    ])
  })

  it('expands macros and leaves @reboot without a cron expression', () => {
    expect(entries[3]).toMatchObject({ rawSchedule: '@reboot', cronExpression: null })
    expect(entries[4]).toMatchObject({ rawSchedule: '@daily', cronExpression: '0 0 * * *' })
    expect(entries[4].logPath).toBeNull()
  })

  it('derives ids that survive unrelated edits and satisfy the job-id guard', () => {
    const shifted = parseCrontab(`# a new comment\n\n${CRONTAB}`)
    expect(shifted.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id))
    for (const entry of entries) {
      expect(entry.id).toMatch(/^cron-[0-9a-f]{12}$/)
    }
  })
})

describe('mapCrontabJobs', () => {
  it('computes the next run and merges supplied evidence', () => {
    const [backup, , , reboot] = parseCrontab(CRONTAB)
    const now = new Date(2026, 10, 2, 12, 0).getTime()
    const jobs = mapCrontabJobs({
      managerId: 'crontab:local',
      entries: [backup, reboot],
      now,
      evidence: new Map([
        [
          backup.id,
          {
            lastRunAt: '2026-11-02T09:15:00.000Z',
            lastStatus: 'failed',
            lastError: 'failed · exit 1',
            runs: [
              {
                id: 'r1',
                runAt: '2026-11-02T09:15:00.000Z',
                status: 'failed' as const,
                outputPreview: 'failed · exit 1',
                outputContent: null,
                error: 'failed · exit 1',
                outputPath: null
              }
            ]
          }
        ]
      ])
    })
    expect(jobs[0]).toMatchObject({
      provider: 'crontab',
      schedule: 'cron 15 2 * * *',
      rawSchedule: '15 2 * * *',
      nextRunAt: new Date(2026, 10, 3, 2, 15).toISOString(),
      state: 'failed',
      lastStatus: 'failed',
      runCount: 1
    })
    expect(jobs[0].runs[0]).toMatchObject({ managerId: 'crontab:local', jobId: backup.id })
    expect(jobs[1]).toMatchObject({ schedule: '@reboot', nextRunAt: null, state: 'idle' })
  })
})
