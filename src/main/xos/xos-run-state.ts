// XOS fork: the automation run gate's state: held locks, lane waiters and retry handoffs, and what
// keeps them honest (journal, timeouts, sweep). The journal is the truth across restarts; these maps
// are rebuilt from it by registerXosAutomationHost.
import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationDispatchResult,
  type AutomationRun
} from '../../shared/automations-types'
import {
  adoptLock,
  automationLockFile,
  isLockFree,
  laneLockFile,
  tryLock,
  type HeldLock,
  type LockLease
} from './xos-lane-lock'
import { chainForRun, restoreChain } from './xos-run-fallback'
import { readQueuedWaiters, writeQueuedWaiters, type XosQueuedWaiter } from './xos-run-queue'
import {
  listRunJournal,
  removeRunJournal,
  writeRunJournal,
  writeRunLease,
  type XosAutomationJournalEntry
} from './xos-run-journal'
import { readRunConfig } from './xos-runtime-store'
import { adoptScriptRuns, stopScriptRun } from './xos-script-runs'

const SWEEP_MS = 20_000
const LOCK_RELEASE_SETTLE_MS = 1_000
export const HANDOFF_TTL_MS = 2 * 60_000

export type XosAutomationHost = {
  findRun: (automationId: string, runId: string) => AutomationRun | null
  findAutomation: (automationId: string) => Automation | null
  runNow: (automationId: string, trigger?: AutomationRun['trigger']) => Promise<unknown>
  markDispatchResult: (result: AutomationDispatchResult) => Promise<unknown>
  /** Closes the run's terminal, when it still has one. */
  closeRunTerminal: (run: AutomationRun) => Promise<void>
}

export type CommitTarget = { cwd: string; repoRoot: string }
export type HeldGoal = NonNullable<XosAutomationJournalEntry['goal']>
export type Held = {
  automationId: string
  locks: HeldLock[]
  timer: NodeJS.Timeout | null
  commit: CommitTarget | null
  goal: HeldGoal | null
  leasePath: string
  deadlineAtMs: number | null
  committing?: boolean
}

export type Handoff = { locks: HeldLock[]; leasePath: string; expiresAt: number }

let host: XosAutomationHost | null = null

export function automationHost(): XosAutomationHost | null {
  return host
}

let sweepTimer: NodeJS.Timeout | null = null
export const held = new Map<string, Held>()
let waiters: XosQueuedWaiter[] = []
const inheritedLanes = new Map<string, { lane: string; expiresAt: number }>()
export const handoffs = new Map<string, Handoff>()

function laneIsHeld(laneFile: string): boolean {
  return (
    Array.from(held.values()).some((entry) => entry.locks.some((lock) => lock.file === laneFile)) ||
    listRunJournal().some((entry) => entry.locks.some((lock) => lock.file === laneFile))
  )
}

/** RT13: a nested child of a run that really holds `lane` may share it (from the CLI's env). */
export function xosGrantInheritedLane(automationId: string, lane: string): void {
  inheritedLanes.set(automationId, { lane, expiresAt: Date.now() + 2 * 60_000 })
}

function consumeInheritedLane(automationId: string, lane: string, laneFile: string): boolean {
  const entry = inheritedLanes.get(automationId)
  if (entry && entry.lane === lane && entry.expiresAt > Date.now()) {
    inheritedLanes.delete(automationId)
    return laneIsHeld(laneFile)
  }
  return false
}

export function syncSweepTimer(): void {
  const idle = held.size === 0 && waiters.length === 0 && handoffs.size === 0
  if (idle && sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  } else if (!idle && !sweepTimer) {
    sweepTimer = setInterval(() => void sweep(), SWEEP_MS)
    sweepTimer.unref()
  }
}

export function journal(runId: string, entry: Held): void {
  writeRunJournal({
    kind: 'automation',
    runId,
    automationId: entry.automationId,
    startedAt: entry.goal?.startedAt ?? new Date().toISOString(),
    deadlineAtMs: entry.deadlineAtMs,
    locks: entry.locks.map(({ file, pid }) => ({ file, pid })),
    leasePath: entry.leasePath,
    commit: entry.commit,
    chain: chainForRun(runId),
    goal: entry.goal
  })
}

export function armTimeout(runId: string, entry: Held, minutes: number): void {
  if (entry.deadlineAtMs === null) {
    return
  }
  entry.timer = setTimeout(
    () => void timeOut(entry.automationId, runId, minutes),
    Math.max(0, entry.deadlineAtMs - Date.now())
  )
  entry.timer.unref()
}

/** H8: rebuild the gate from the journal; runs that ended while Orca was away just let go. */
function reconcileAutomationRuns(): void {
  for (const entry of listRunJournal()) {
    if (entry.kind !== 'automation' || held.has(entry.runId)) {
      continue
    }
    const locks = entry.locks.map((lock) => adoptLock(lock.file, lock.pid))
    const run = host?.findRun(entry.automationId, entry.runId)
    if (!run || isFinalAutomationRunStatus(run.status)) {
      locks.forEach((lock) => lock.release())
      removeRunJournal(entry.runId, entry.leasePath)
      continue
    }
    const adopted: Held = { ...entry, locks, timer: null }
    held.set(entry.runId, adopted)
    if (entry.chain) {
      restoreChain(entry.runId, entry.chain)
    }
    armTimeout(entry.runId, adopted, readRunConfig(entry.automationId).timeoutMinutes ?? 0)
  }
  waiters = readQueuedWaiters().filter((waiter) => waiter.deadline > Date.now())
  syncSweepTimer()
}

export function registerXosAutomationHost(next: XosAutomationHost): void {
  host = next
  try {
    reconcileAutomationRuns()
    adoptScriptRuns((result) => next.markDispatchResult(result))
  } catch (error) {
    console.warn('[xos] could not restore run state', error)
  }
}

async function acquireAll(files: string[], lease: LockLease): Promise<HeldLock[] | null> {
  const taken: HeldLock[] = []
  for (const file of files) {
    const lock = await tryLock(file, 0, lease)
    if (!lock) {
      taken.forEach((entry) => entry.release())
      return null
    }
    taken.push(lock)
  }
  return taken
}

export async function takeLocks(args: {
  automation: Automation
  repoRoot: string
  lane: string
  lockWaitMinutes: number
  lease: LockLease
}): Promise<{ locks: HeldLock[]; leasePath: string } | { refusal: string }> {
  const { automation, repoRoot, lane, lockWaitMinutes, lease } = args
  const handoff = handoffs.get(automation.id)
  if (handoff) {
    handoffs.delete(automation.id)
    return { locks: handoff.locks, leasePath: handoff.leasePath }
  }
  const laneFile = laneLockFile(repoRoot, lane)
  const inherited = consumeInheritedLane(automation.id, lane, laneFile)
  const lockFiles = inherited
    ? [automationLockFile(repoRoot, automation.id)]
    : [automationLockFile(repoRoot, automation.id), laneFile]
  writeRunLease(lease.path, null)
  let locks: HeldLock[] | null
  try {
    locks = await acquireAll(lockFiles, lease)
  } catch (error) {
    return { refusal: `Could not take lane "${lane}": ${String(error)}` }
  }
  if (locks) {
    return { locks, leasePath: lease.path }
  }
  if (lockWaitMinutes > 0) {
    enqueue({
      automationId: automation.id,
      file: laneFile,
      lane,
      deadline: Date.now() + lockWaitMinutes * 60_000
    })
    return {
      refusal: `Lane "${lane}" is busy. Queued: this automation starts when the lane frees (up to ${lockWaitMinutes} min).`
    }
  }
  return { refusal: `Lane "${lane}" is busy with another run; skipped.` }
}

function enqueue(waiter: XosQueuedWaiter): void {
  const index = waiters.findIndex((entry) => entry.automationId === waiter.automationId)
  if (index === -1) {
    waiters.push(waiter)
  } else {
    waiters[index] = waiter
  }
  writeQueuedWaiters(waiters)
  syncSweepTimer()
}

export function forget(runId: string, entry: Held): void {
  held.delete(runId)
  if (entry.timer) {
    clearTimeout(entry.timer)
  }
  removeRunJournal(runId, entry.leasePath)
}

/** Releases a run's locks and timer, then lets a queued automation take the freed lane. */
export function xosReleaseRun(runId: string): void {
  const entry = held.get(runId)
  if (!entry) {
    return
  }
  forget(runId, entry)
  entry.locks.forEach((lock) => lock.release())
  syncSweepTimer()
  if (entry.locks.length > 0) {
    void wakeWaiters()
    // The lock helper dies asynchronously; don't leave a waiter for the next sweep over that.
    setTimeout(() => void wakeWaiters(), LOCK_RELEASE_SETTLE_MS).unref()
  }
}

async function wakeWaiters(): Promise<void> {
  const now = Date.now()
  waiters = waiters.filter((waiter) => waiter.deadline >= now)
  const started = new Set<string>()
  // Iterate a copy: the loop removes woken waiters.
  for (const waiter of waiters.slice()) {
    if (started.has(waiter.file) || !host || !(await isLockFree(waiter.file))) {
      continue
    }
    started.add(waiter.file)
    waiters.splice(waiters.indexOf(waiter), 1)
    // L4: it replaces a scheduled run, so it gets a scheduled run's precheck and queue gate.
    void host.runNow(waiter.automationId, 'scheduled').catch((error) => {
      console.warn('[xos] queued lane run could not start', error)
    })
  }
  writeQueuedWaiters(waiters)
  syncSweepTimer()
}

async function timeOut(automationId: string, runId: string, minutes: number): Promise<void> {
  const run = host?.findRun(automationId, runId)
  if (!host || !run || isFinalAutomationRunStatus(run.status)) {
    xosReleaseRun(runId)
    return
  }
  // L2: stop the agent before anything reads the lane as free.
  stopScriptRun(runId)
  await host.closeRunTerminal(run).catch((error) => {
    console.warn('[xos] could not close a timed-out run terminal', error)
  })
  await host.markDispatchResult({
    runId,
    status: 'dispatch_failed',
    error: `Stopped after the ${minutes}-minute timeout.`
  })
  xosReleaseRun(runId)
}

async function sweep(): Promise<void> {
  if (!host) {
    return
  }
  // Iterate a copy: releasing deletes entries.
  for (const [runId, entry] of Array.from(held)) {
    if (entry.committing) {
      continue
    }
    const run = host.findRun(entry.automationId, runId)
    if (!run || isFinalAutomationRunStatus(run.status)) {
      xosReleaseRun(runId)
    }
  }
  for (const [automationId, handoff] of Array.from(handoffs)) {
    if (handoff.expiresAt <= Date.now()) {
      handoffs.delete(automationId)
      handoff.locks.forEach((lock) => lock.release())
      removeRunJournal(automationId, handoff.leasePath)
      void wakeWaiters()
    }
  }
  if (waiters.length > 0) {
    await wakeWaiters()
  }
  syncSweepTimer()
}
