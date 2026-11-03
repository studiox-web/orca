// XOS fork: the stage A gate in front of every automation launch.
// - RT7 lane locks (xos-lane-lock): a busy lane skips the run, or queues it when the automation
//   allows waiting; it starts as soon as the lane frees. The scheduler awaits each dispatch, so
//   waiting must never block inside the dispatch itself.
// - RT15 timeouts: a terminal run still going after its limit is marked failed and its terminal
//   closed, which also releases its lane.
// - Model overlay for fallback retries (xos-run-fallback).
// Locks are released when the run's final result is recorded, and by a sweep for any run that
// ended through a path that never reports to the service.
import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationDispatchResult,
  type AutomationRun
} from '../../shared/automations-types'
import {
  automationLockFile,
  isLockFree,
  laneLockFile,
  tryLock,
  type HeldLock
} from './xos-lane-lock'
import { markQueuedStart, xosLaunchAutomation, xosObserveFinishedRun } from './xos-run-fallback'
import { readRunConfig } from './xos-runtime-store'

const SWEEP_MS = 20_000

export type XosAutomationHost = {
  findRun: (automationId: string, runId: string) => AutomationRun | null
  findAutomation: (automationId: string) => Automation | null
  runNow: (automationId: string) => Promise<unknown>
  markDispatchResult: (result: AutomationDispatchResult) => Promise<unknown>
  /** Closes the run's terminal, when it still has one. */
  closeRunTerminal: (run: AutomationRun) => Promise<void>
}

type Held = { automationId: string; locks: HeldLock[]; timer: NodeJS.Timeout | null }
type Waiter = { automationId: string; file: string; lane: string; deadline: number }

let host: XosAutomationHost | null = null
let sweepTimer: NodeJS.Timeout | null = null
const held = new Map<string, Held>()
const waiters: Waiter[] = []

export function registerXosAutomationHost(next: XosAutomationHost): void {
  host = next
  if (!sweepTimer) {
    sweepTimer = setInterval(() => void sweep(), SWEEP_MS)
    sweepTimer.unref()
  }
}

async function acquireAll(files: string[]): Promise<HeldLock[] | null> {
  const taken: HeldLock[] = []
  for (const file of files) {
    const lock = await tryLock(file)
    if (!lock) {
      taken.forEach((entry) => entry.release())
      return null
    }
    taken.push(lock)
  }
  return taken
}

export type XosGateResult = { automation: Automation } | { refusal: string }

export async function xosBeforeLaunch(
  automation: Automation,
  run: AutomationRun,
  repoRoot: string | null
): Promise<XosGateResult> {
  const config = readRunConfig(automation.id)
  if (config.lockLane && repoRoot) {
    const laneFile = laneLockFile(repoRoot, config.lockLane)
    let locks: HeldLock[] | null
    try {
      locks = await acquireAll([automationLockFile(repoRoot, automation.id), laneFile])
    } catch (error) {
      return { refusal: `Could not take lane "${config.lockLane}": ${String(error)}` }
    }
    if (!locks) {
      if (config.lockWaitMinutes > 0) {
        enqueue({
          automationId: automation.id,
          file: laneFile,
          lane: config.lockLane,
          deadline: Date.now() + config.lockWaitMinutes * 60_000
        })
        return {
          refusal: `Lane "${config.lockLane}" is busy. Queued: this automation starts when the lane frees (up to ${config.lockWaitMinutes} min).`
        }
      }
      return { refusal: `Lane "${config.lockLane}" is busy with another run; skipped.` }
    }
    held.set(run.id, { automationId: automation.id, locks, timer: null })
  }
  if (config.timeoutMinutes && automation.surface !== 'chat') {
    const entry = held.get(run.id) ?? { automationId: automation.id, locks: [], timer: null }
    entry.timer = setTimeout(
      () => void timeOut(automation.id, run.id, config.timeoutMinutes!),
      config.timeoutMinutes * 60_000
    )
    entry.timer.unref()
    held.set(run.id, entry)
  }
  return { automation: xosLaunchAutomation(automation, run) }
}

function enqueue(waiter: Waiter): void {
  const index = waiters.findIndex((entry) => entry.automationId === waiter.automationId)
  if (index === -1) {
    waiters.push(waiter)
  } else {
    waiters[index] = waiter
  }
}

/** Releases a run's locks and timer, then lets a queued automation take the freed lane. */
export function xosReleaseRun(runId: string): void {
  const entry = held.get(runId)
  if (!entry) {
    return
  }
  held.delete(runId)
  if (entry.timer) {
    clearTimeout(entry.timer)
  }
  entry.locks.forEach((lock) => lock.release())
  if (entry.locks.length > 0) {
    void wakeWaiters()
  }
}

/** Called once a run's final result is recorded (service.markDispatchResult). */
export function xosAfterRunFinished(run: AutomationRun): void {
  if (!isFinalAutomationRunStatus(run.status)) {
    return
  }
  xosReleaseRun(run.id)
  xosObserveFinishedRun(
    {
      automation: host?.findAutomation(run.automationId) ?? undefined,
      runNow: (automationId) => host?.runNow(automationId) ?? Promise.resolve()
    },
    run
  )
}

async function wakeWaiters(): Promise<void> {
  const now = Date.now()
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    if (waiters[index].deadline < now) {
      waiters.splice(index, 1)
    }
  }
  const started = new Set<string>()
  // Iterate a copy: the loop removes woken waiters.
  for (const waiter of waiters.slice()) {
    if (started.has(waiter.file) || !host || !(await isLockFree(waiter.file))) {
      continue
    }
    started.add(waiter.file)
    waiters.splice(waiters.indexOf(waiter), 1)
    markQueuedStart(waiter.automationId)
    void host.runNow(waiter.automationId).catch((error) => {
      console.warn('[xos] queued lane run could not start', error)
    })
  }
}

async function timeOut(automationId: string, runId: string, minutes: number): Promise<void> {
  const run = host?.findRun(automationId, runId)
  if (!host || !run || isFinalAutomationRunStatus(run.status)) {
    xosReleaseRun(runId)
    return
  }
  await host.markDispatchResult({
    runId,
    status: 'dispatch_failed',
    error: `Stopped after the ${minutes}-minute timeout.`
  })
  await host.closeRunTerminal(run).catch((error) => {
    console.warn('[xos] could not close a timed-out run terminal', error)
  })
  xosReleaseRun(runId)
}

async function sweep(): Promise<void> {
  if (!host) {
    return
  }
  // Iterate a copy: releasing deletes entries.
  for (const [runId, entry] of Array.from(held)) {
    const run = host.findRun(entry.automationId, runId)
    if (!run || isFinalAutomationRunStatus(run.status)) {
      xosReleaseRun(runId)
    }
  }
  if (waiters.length > 0) {
    await wakeWaiters()
  }
}
