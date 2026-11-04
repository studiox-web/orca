// XOS fork: automations waiting for a lane (RT7), kept on disk so a restart doesn't drop them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runStateDir } from './xos-run-journal'

export type XosQueuedWaiter = {
  automationId: string
  file: string
  lane: string
  deadline: number
}

const queuePath = (): string => join(runStateDir(), 'lane-waiters.queue')

export function readQueuedWaiters(): XosQueuedWaiter[] {
  try {
    const parsed: XosQueuedWaiter[] = JSON.parse(readFileSync(queuePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeQueuedWaiters(waiters: readonly XosQueuedWaiter[]): void {
  mkdirSync(runStateDir(), { recursive: true })
  writeFileSync(queuePath(), JSON.stringify(waiters), 'utf8')
}
