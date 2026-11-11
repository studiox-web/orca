import { describe, expect, it } from 'vitest'
import {
  parseLegacyCrontabSnapshot,
  type LegacyCrontabScope
} from './legacy-crontab-adoption-snapshot'

const scope: LegacyCrontabScope = {
  authority: {
    authority: { kind: 'runtime', environmentId: 'production', pairingRevision: 8 },
    selector: { kind: 'ssh', targetId: 'scheduler', targetGeneration: 3 }
  },
  user: 'deploy',
  managerId: 'crontab:deploy'
}

describe('parseLegacyCrontabSnapshot', () => {
  it('captures immutable scoped occurrence identity, sequential timezones, pause provenance, and redacted commands', () => {
    const duplicate = '15 4 * * * cd /srv/app && ./bin/prune --older-than 30'
    const text = [
      'MAILTO=ops@example.com',
      'CRON_TZ=America/Vancouver',
      '0 3 * * * cd /srv/app && /usr/bin/env API_TOKEN=super-secret ./bin/backup --password hunter2',
      'CRON_TZ=UTC',
      '#orca-xos-paused# @daily cd /srv/app && ./bin/report --key hidden',
      '# PAUSED FOR ORCA MIGRATION 2026-11-08: CRON_TZ=Europe/London',
      '# PAUSED FOR ORCA MIGRATION 2026-11-08: @weekly cd /srv/app && ./bin/digest --token secret',
      duplicate,
      duplicate,
      ''
    ].join('\n')

    const snapshot = parseLegacyCrontabSnapshot({ text, scope })
    const [backup, report, digest, firstDuplicate, secondDuplicate] = snapshot.occurrences

    expect(snapshot.scope).toEqual(scope)
    expect(snapshot.revision).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(snapshot.occurrences).toHaveLength(5)
    expect(backup.identity).toMatchObject({
      ...scope,
      sourceRevision: snapshot.revision,
      lineIndex: 2,
      occurrenceOrdinal: 0
    })
    expect(backup.identity.rawLineDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(backup.schedule).toMatchObject({
      format: 'cron',
      expression: '0 3 * * *',
      normalizedExpression: '0 3 * * *',
      support: 'supported'
    })
    expect(backup.timezone).toMatchObject({
      value: 'America/Vancouver',
      provenance: { kind: 'cron-tz', lineIndex: 1, pause: null }
    })
    expect(backup.command).toMatchObject({ display: 'backup …', cwd: '/srv/app' })
    expect(backup.command.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(JSON.stringify(backup)).not.toContain('super-secret')
    expect(JSON.stringify(backup)).not.toContain('hunter2')

    expect(report).toMatchObject({
      state: 'paused',
      pause: { kind: 'orca', marker: '#orca-xos-paused#' },
      schedule: {
        format: 'macro',
        expression: '@daily',
        normalizedExpression: '0 0 * * *',
        support: 'supported',
        unsupportedReason: null
      },
      timezone: { value: 'UTC', provenance: { kind: 'cron-tz', lineIndex: 3 } }
    })
    expect(digest).toMatchObject({
      state: 'paused',
      pause: { kind: 'migration' },
      timezone: {
        value: 'Europe/London',
        provenance: { kind: 'cron-tz', lineIndex: 5, pause: { kind: 'migration' } }
      }
    })
    expect(firstDuplicate.identity).toMatchObject({ lineIndex: 7, occurrenceOrdinal: 0 })
    expect(secondDuplicate.identity).toMatchObject({ lineIndex: 8, occurrenceOrdinal: 1 })
    expect(firstDuplicate.identity.guardedMutationId).toBe(
      secondDuplicate.identity.guardedMutationId
    )
    expect(firstDuplicate.identity.rawLineDigest).toBe(secondDuplicate.identity.rawLineDigest)
    expect(firstDuplicate.mutationIdentityCount).toBe(2)
    expect(secondDuplicate.mutationIdentityCount).toBe(2)
  })

  it('groups pause and irrelevant whitespace variants by guarded mutation identity', () => {
    const command = 'cd /srv/app && ./bin/prune --older-than 30'
    const snapshot = parseLegacyCrontabSnapshot({
      scope,
      text: [
        `15 4 * * * ${command}`,
        `#orca-xos-paused#   15\t4  *   * *   ${command}   `,
        `# PAUSED FOR ORCA MIGRATION 2026-11-08: 15 4 * * * ${command}`,
        ''
      ].join('\n')
    })

    expect(snapshot.occurrences.map(({ identity }) => identity.occurrenceOrdinal)).toEqual([
      0, 1, 2
    ])
    expect(
      new Set(snapshot.occurrences.map(({ identity }) => identity.guardedMutationId)).size
    ).toBe(1)
    expect(new Set(snapshot.occurrences.map(({ identity }) => identity.rawLineDigest)).size).toBe(3)
    expect(snapshot.occurrences.map(({ mutationIdentityCount }) => mutationIdentityCount)).toEqual([
      3, 3, 3
    ])
    expect(snapshot.occurrences.map(({ state }) => state)).toEqual(['enabled', 'paused', 'paused'])
  })

  it('retains unsupported macros and cron dialects as reviewable occurrences', () => {
    const snapshot = parseLegacyCrontabSnapshot({
      scope,
      text: '@reboot ./boot.sh\n0 9 ? * * ./quartz-job.sh\n0 */5 * * * * ./six-field.sh\n'
    })

    expect(snapshot.occurrences.map((occurrence) => occurrence.schedule.support)).toEqual([
      'unsupported-macro',
      'unsupported-dialect',
      'unsupported-dialect'
    ])
    expect(snapshot.occurrences[0].schedule).toMatchObject({
      format: 'macro',
      expression: '@reboot',
      normalizedExpression: null
    })
    expect(snapshot.occurrences[1].schedule).toMatchObject({
      format: 'cron',
      expression: '0 9 ? * *',
      normalizedExpression: null
    })
    expect(snapshot.occurrences[2].schedule).toMatchObject({
      format: 'cron',
      expression: '0 */5 * * * *',
      normalizedExpression: null
    })
  })

  it('revisions the complete source bytes, including line endings and directives', () => {
    const unix = parseLegacyCrontabSnapshot({ scope, text: 'CRON_TZ=UTC\n0 9 * * * ./job\n' })
    const windows = parseLegacyCrontabSnapshot({
      scope,
      text: 'CRON_TZ=UTC\r\n0 9 * * * ./job\r\n'
    })

    expect(unix.revision).not.toBe(windows.revision)
    expect(unix.occurrences[0].identity.sourceRevision).toBe(unix.revision)
    expect(windows.occurrences[0].identity.sourceRevision).toBe(windows.revision)
  })
})
