// XOS fork: MS7. Goals reach the operator through an outbound queue the bot polls.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit } from './xos-crontab'
import { xosHome } from './xos-home'

export type XosNotification = { at: string; goal: string; text: string; image: string | null }

const queuePath = (): string => join(xosHome(), 'notifications.jsonl')

export function appendNotification(args: Omit<XosNotification, 'at'>): XosNotification {
  const entry = { at: new Date().toISOString(), ...args }
  mkdirSync(xosHome(), { recursive: true })
  appendFileSync(queuePath(), `${JSON.stringify(entry)}\n`, 'utf8')
  audit({ action: 'goal.notify', goal: args.goal })
  return entry
}

export function readNotifications(since?: string): XosNotification[] {
  const after = since ? Date.parse(since) : Number.NEGATIVE_INFINITY
  try {
    return readFileSync(queuePath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line): XosNotification[] => {
        try {
          const entry: XosNotification = JSON.parse(line)
          return Date.parse(entry.at) > after ? [entry] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
