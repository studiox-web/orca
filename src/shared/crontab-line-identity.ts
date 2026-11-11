import { createHash } from 'node:crypto'

export function crontabLineId(schedule: string, command: string): string {
  return `cron-${createHash('sha256').update(`${schedule}\n${command}`).digest('hex').slice(0, 12)}`
}
