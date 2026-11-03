// XOS fork: IPC for the board's §3d writes. Each handler rebuilds the board first so it acts on
// what is on disk now, not on what the renderer last saw.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type {
  XosActionResult,
  XosAreaMutation,
  XosAuditEvent,
  XosCronMutation,
  XosGoalMutation
} from '../../shared/xos-goals-types'
import { buildXosGoalBoard, type XosRepoSource } from './xos-goal-board'
import { xosHome } from './xos-crontab'
import { applyAreaMutation, applyCronMutation, applyGoalMutation } from './xos-goal-crud'

const AUDIT_TAIL_BYTES = 512 * 1024

/** The newest audit events (reads only the tail of audit.jsonl). */
function readAudit(limit: number): XosAuditEvent[] {
  const path = join(xosHome(), 'audit.jsonl')
  let fd: number | null = null
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - AUDIT_TAIL_BYTES)
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n').filter(Boolean)
    const events: XosAuditEvent[] = []
    for (const line of (start > 0 ? lines.slice(1) : lines).toReversed()) {
      try {
        events.push(JSON.parse(line) as XosAuditEvent)
      } catch {
        // Skip a torn line.
      }
      if (events.length >= Math.max(1, Math.min(limit, 500))) {
        break
      }
    }
    return events
  } catch {
    return []
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

export function registerXosGoalCrudHandlers(repos: XosRepoSource): void {
  ipcMain.handle(
    'xos:goals:mutateCron',
    async (_event, mutation: XosCronMutation): Promise<XosActionResult> =>
      applyCronMutation(await buildXosGoalBoard(repos), mutation)
  )
  ipcMain.handle(
    'xos:goals:mutateGoal',
    async (_event, mutation: XosGoalMutation): Promise<XosActionResult> =>
      applyGoalMutation(await buildXosGoalBoard(repos), mutation)
  )
  ipcMain.handle(
    'xos:goals:mutateArea',
    async (_event, mutation: XosAreaMutation): Promise<XosActionResult> =>
      applyAreaMutation(await buildXosGoalBoard(repos), mutation)
  )
  ipcMain.handle('xos:goals:getAudit', (_event, args: { limit: number }) =>
    readAudit(args?.limit ?? 100)
  )
}
