// XOS fork: find goal runner processes (run-goal(-cron).sh) and which project checkout they run in.
import { readlinkSync } from 'node:fs'
import { sep } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { XosRunningJob } from '../../shared/xos-goals-types'

export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

async function listProcesses(): Promise<string> {
  try {
    const result = await runProcess({
      program: 'ps',
      args: ['-eo', 'pid=,etimes=,args='],
      maxOutputBytes: 8 * 1024 * 1024
    })
    return result.stdout
  } catch {
    return ''
  }
}

const RUNNING_SCRIPT =
  /automations\/bin\/run-goal(?:-cron)?\.sh\s+([A-Za-z0-9_-]+)(?:\s+(codex|claude|gemini|opencode|agy))?/

/** Goal runner processes, keyed by `<projectRoot>\0<goal>` (oldest process wins). */
export async function runningGoalJobs(): Promise<Map<string, XosRunningJob>> {
  const running = new Map<string, XosRunningJob>()
  const now = Date.now()
  for (const line of (await listProcesses()).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    const script = match ? RUNNING_SCRIPT.exec(match[3]) : null
    if (!match || !script || match[3].includes(' ps -eo ')) {
      continue
    }
    const pid = Number(match[1])
    let cwd: string
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      continue
    }
    const elapsedSeconds = Number(match[2])
    const key = `${cwd}\0${script[1]}`
    const existing = running.get(key)
    if (existing && existing.elapsedSeconds >= elapsedSeconds) {
      continue
    }
    running.set(key, {
      goal: script[1],
      pid,
      elapsedSeconds,
      startedAt: new Date(now - elapsedSeconds * 1000).toISOString(),
      runner: script[2] ?? null,
      command: match[3]
    })
  }
  return running
}

export function runningFor(
  running: Map<string, XosRunningJob>,
  root: string,
  goal: string
): XosRunningJob | null {
  for (const [key, job] of running) {
    const [cwd, runningGoal] = key.split('\0')
    if (runningGoal === goal && within(cwd, root)) {
      return job
    }
  }
  return null
}
