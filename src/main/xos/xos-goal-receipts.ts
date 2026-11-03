// XOS fork: read the tail of the goal runner's JSONL receipts. Only the last few MB are read, so a
// board refresh stays cheap however long the history grows (Cascade's is 2 MB+, its logs 1.8 GB).
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { XosGoalRun, XosGoalUsage } from '../../shared/xos-goals-types'

const TAIL_BYTES = 3 * 1024 * 1024

function readTailLines(path: string, bytes = TAIL_BYTES): string[] {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    // A partial first line is expected when we started mid-file.
    return start > 0 ? lines.slice(1) : lines
  } catch {
    return []
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

function parseJsonLines(lines: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>)
    } catch {
      // Skip torn or hand-edited lines.
    }
  }
  return out
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Run receipts grouped by goal, newest first. */
export function readRunReceipts(automationsDir: string): Map<string, XosGoalRun[]> {
  const byGoal = new Map<string, XosGoalRun[]>()
  for (const entry of parseJsonLines(
    readTailLines(join(automationsDir, 'logs', 'automation-runs.jsonl'))
  )) {
    const goal = str(entry.goal)
    if (!goal) {
      continue
    }
    const run: XosGoalRun = {
      goal,
      runner: str(entry.runner),
      status: str(entry.status) ?? 'unknown',
      started_at: str(entry.started_at),
      finished_at: str(entry.finished_at),
      duration_seconds: num(entry.duration_seconds),
      exit_code: num(entry.exit_code),
      log_path: str(entry.log_path) ?? '',
      model: str(entry.model),
      reasoning_effort: str(entry.reasoning_effort),
      failure_reason: str(entry.failure_reason)
    }
    const list = byGoal.get(goal) ?? []
    list.push(run)
    byGoal.set(goal, list)
  }
  for (const list of byGoal.values()) {
    list.sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
  }
  return byGoal
}

/** Token usage grouped by goal (`feature`), newest first. */
export function readTokenUsage(automationsDir: string): Map<string, XosGoalUsage[]> {
  const byGoal = new Map<string, XosGoalUsage[]>()
  for (const entry of parseJsonLines(
    readTailLines(join(automationsDir, 'logs', 'token-usage.jsonl'))
  )) {
    const goal = str(entry.feature)
    if (!goal) {
      continue
    }
    const usage: XosGoalUsage = {
      ts: str(entry.ts),
      feature: goal,
      actual_tokens: num(entry.actual_tokens) ?? 0,
      estimated_cost_usd: num(entry.estimated_cost_usd) ?? num(entry.actual_cost_usd) ?? 0,
      model: str(entry.model) ?? 'unknown'
    }
    const list = byGoal.get(goal) ?? []
    list.push(usage)
    byGoal.set(goal, list)
  }
  for (const list of byGoal.values()) {
    list.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
  }
  return byGoal
}
