// XOS fork: fork-owned durable run state (H8). Agents outlive Orca (detached native runs, PTY-daemon
// terminals), so everything needed to supervise one lives on disk: one JSON file per active run,
// written atomically and removed when the run is settled. In-memory maps are only caches of this.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import type { XosModelChoice } from '../../shared/xos-runtime-types'
import { xosHome } from './xos-crontab'
import { safeReaddir } from './xos-goal-files'
import type { XosNativeRunTrigger } from './xos-live-runs-types'

export type XosJournalLock = { file: string; pid: number | null }

type JournalBase = {
  runId: string
  startedAt: string
  /** Null when no timeout applies. */
  deadlineAtMs: number | null
  locks: XosJournalLock[]
  leasePath: string
}

export type XosNativeJournalEntry = JournalBase & {
  kind: 'native'
  repoRoot: string
  goal: string
  agent: string
  mode: XosGoalRunMode
  trigger: XosNativeRunTrigger
  parentRunId: string | null
  pid: number | null
  logPath: string
  exitPath: string
  itemPath: string | null
  itemTitle: string | null
  itemStage: string | null
  worktreePath: string | null
  branch: string | null
  command: string
  model: string | null
  effort: string | null
  disableAutoCommit: boolean
  disableFallback: boolean
  attempt: number
  fallbackChain: XosModelChoice[]
}

export type XosAutomationJournalEntry = JournalBase & {
  kind: 'automation'
  automationId: string
  commit: { cwd: string; repoRoot: string } | null
  chain: {
    rootRunId: string
    rootTrigger: 'scheduled' | 'manual'
    attempt: number
    choice: XosModelChoice
    options: XosModelChoice[]
  } | null
  goal: {
    repoRoot: string
    goal: string
    itemPath: string | null
    inboxPaths: string[]
    startedAt: string
  } | null
}

export type XosTakeoverJournalEntry = JournalBase & {
  kind: 'takeover'
  repoRoot: string
  goal: string
  agent: string
  itemPath: string | null
}

export type XosScriptJournalEntry = JournalBase & {
  kind: 'script'
  automationId: string
  pid: number | null
  logPath: string
  exitPath: string
}

export type XosJournalEntry =
  | XosNativeJournalEntry
  | XosAutomationJournalEntry
  | XosTakeoverJournalEntry
  | XosScriptJournalEntry

export function isProcessAlive(pid: number | null): boolean {
  if (!pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function runStateDir(): string {
  return join(xosHome(), 'run-state')
}

export function leasePathFor(runId: string): string {
  return join(runStateDir(), `${runId.replace(/[^\w.-]/g, '_')}.lease`)
}

function entryPath(runId: string): string {
  return join(runStateDir(), `${runId.replace(/[^\w.-]/g, '_')}.json`)
}

export function writeRunLease(path: string, agentPid: number | null): void {
  mkdirSync(runStateDir(), { recursive: true })
  writeFileSync(path, agentPid ? String(agentPid) : '', 'utf8')
}

export function writeRunJournal(entry: XosJournalEntry): void {
  mkdirSync(runStateDir(), { recursive: true })
  const path = entryPath(entry.runId)
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(entry), 'utf8')
  renameSync(temp, path)
}

export function removeRunJournal(runId: string, leasePath?: string): void {
  rmSync(entryPath(runId), { force: true })
  rmSync(leasePath ?? leasePathFor(runId), { force: true })
}

export function readRunJournal(runId: string): XosJournalEntry | null {
  try {
    const entry: XosJournalEntry = JSON.parse(readFileSync(entryPath(runId), 'utf8'))
    return entry
  } catch {
    return null
  }
}

export function listRunJournal(): XosJournalEntry[] {
  const entries: XosJournalEntry[] = []
  for (const name of safeReaddir(runStateDir())) {
    if (!name.endsWith('.json')) {
      continue
    }
    const entry = readRunJournal(name.slice(0, -'.json'.length))
    if (entry) {
      entries.push(entry)
    }
  }
  return entries
}

export function activeTakeover(repoRoot: string, goal: string): XosTakeoverJournalEntry | null {
  for (const entry of listRunJournal()) {
    if (entry.kind === 'takeover' && entry.repoRoot === repoRoot && entry.goal === goal) {
      return entry
    }
  }
  return null
}
