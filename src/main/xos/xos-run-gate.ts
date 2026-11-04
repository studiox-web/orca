// XOS fork: the stage A/B gate in front of every automation launch: portfolio policy, goal bindings
// (C1), RT7 lane locks, RT8 auto-commit, RT15 timeouts, script runs, and the model overlay for
// fallback retries and Auto mode. Lock, waiter and sweep state lives in xos-run-state.ts.
import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationRun
} from '../../shared/automations-types'
import type { XosAutomationRunConfig, XosRunCommit } from '../../shared/xos-runtime-types'
import { xosAutoCommit } from './xos-auto-commit'
import { checkDispatchPolicy } from './xos-dispatch-policy'
import { prepareGoalLaunch, settleGoalAutomationRun } from './xos-goal-automation'
import { claimedItemPromptSection, claimWorkItem, releaseWorkItemClaim } from './xos-item-claims'
import {
  classifyFinishedRun,
  notify,
  xosLaunchAutomation,
  xosObserveFinishedRun
} from './xos-run-fallback'
import { leasePathFor, removeRunJournal, writeRunLease } from './xos-run-journal'
import {
  armTimeout,
  automationHost,
  forget,
  handoffs,
  HANDOFF_TTL_MS,
  held,
  journal,
  syncSweepTimer,
  takeLocks,
  xosReleaseRun,
  type CommitTarget,
  type Held
} from './xos-run-state'
import { appendLedger, readRunConfig } from './xos-runtime-store'
import { cronLineStillActive, startScriptRun } from './xos-script-runs'

export {
  registerXosAutomationHost,
  xosGrantInheritedLane,
  xosReleaseRun,
  type XosAutomationHost
} from './xos-run-state'

const DEFAULT_LEASE_MS = 6 * 60 * 60_000
const LEASE_GRACE_MS = 10 * 60_000

/** Where the run executes, from the dispatch target. */
export type XosLaunchTarget = {
  repoRoot: string
  cwd: string
  /** Local filesystem (not SSH or a remote runtime): only then can Orca commit for it. */
  local: boolean
}

export type XosGateResult =
  | { automation: Automation }
  | { script: true }
  /** `precheck`: the work wasn't due, so the run counts as skipped_precheck, not unavailable. */
  | { refusal: string; precheck?: boolean }

function goalPolicyRefusal(repoRoot: string | null, run: AutomationRun): XosGateResult | null {
  if (!repoRoot) {
    return null
  }
  const source = run.trigger === 'scheduled' ? 'schedule' : 'operator'
  const decision = checkDispatchPolicy({ repoRoot, source })
  return decision.allowed ? null : { refusal: decision.reason, precheck: true }
}

async function launchScript(
  automation: Automation,
  run: AutomationRun,
  config: XosAutomationRunConfig,
  entry: Held
): Promise<XosGateResult> {
  const script = config.script
  const host = automationHost()
  if (!script || !host) {
    return { refusal: 'This script automation has no command.' }
  }
  if (await cronLineStillActive(script)) {
    xosReleaseRun(run.id)
    return { refusal: 'The crontab line this replaces is still active.', precheck: true }
  }
  startScriptRun({
    automationId: automation.id,
    run,
    script,
    deadlineAtMs: entry.deadlineAtMs,
    reportResult: host.markDispatchResult
  })
  return { script: true }
}

export async function xosBeforeLaunch(
  automation: Automation,
  run: AutomationRun,
  target: XosLaunchTarget
): Promise<XosGateResult> {
  const config = readRunConfig(automation.id)
  const repoRoot = target.local ? target.repoRoot : null
  const policy = goalPolicyRefusal(repoRoot, run)
  if (policy) {
    return policy
  }
  const goalLaunch = config.goal ? await prepareGoalLaunch(automation, run, config.goal) : null
  if (goalLaunch && 'skip' in goalLaunch) {
    return { refusal: goalLaunch.skip, precheck: true }
  }
  const lane = config.lockLane ?? goalLaunch?.lockLane ?? null
  const timeoutMinutes = config.timeoutMinutes ?? goalLaunch?.timeoutMinutes ?? null
  const deadlineAtMs = timeoutMinutes ? Date.now() + timeoutMinutes * 60_000 : null
  const entry: Held = {
    automationId: automation.id,
    locks: [],
    timer: null,
    commit: null,
    goal: null,
    leasePath: leasePathFor(run.id),
    deadlineAtMs
  }
  if (lane && repoRoot) {
    const taken = await takeLocks({
      automation,
      repoRoot,
      lane,
      lockWaitMinutes: config.lockWaitMinutes || (goalLaunch?.lockWaitMinutes ?? 0),
      lease: {
        path: entry.leasePath,
        expiresAtMs: (deadlineAtMs ?? Date.now() + DEFAULT_LEASE_MS) + LEASE_GRACE_MS
      }
    })
    if ('refusal' in taken) {
      removeRunJournal(run.id, entry.leasePath)
      return taken
    }
    entry.locks = taken.locks
    entry.leasePath = taken.leasePath
  }
  let launchPrompt: string | null = null
  if (goalLaunch && config.goal) {
    const itemPath = goalLaunch.itemPath
    if (itemPath && !claimWorkItem(itemPath, { runId: run.id }).claimed) {
      entry.locks.forEach((lock) => lock.release())
      removeRunJournal(run.id, entry.leasePath)
      return { refusal: 'The next work item was claimed by another run.', precheck: true }
    }
    launchPrompt = itemPath
      ? `${goalLaunch.prompt}${claimedItemPromptSection(itemPath, run.id)}`
      : goalLaunch.prompt
    entry.goal = {
      ...config.goal,
      itemPath,
      inboxPaths: goalLaunch.inboxPaths,
      startedAt: new Date().toISOString()
    }
  }
  // New-per-run worktrees are created after this point; their changes belong on their own branch.
  if (config.autoCommit && repoRoot && automation.workspaceMode === 'existing') {
    entry.commit = { cwd: target.cwd, repoRoot }
  }
  held.set(run.id, entry)
  armTimeout(run.id, entry, timeoutMinutes ?? 0)
  syncSweepTimer()
  if (config.script) {
    journal(run.id, entry)
    return launchScript(automation, run, config, entry)
  }
  const launched = await xosLaunchAutomation(automation, run)
  journal(run.id, entry)
  return { automation: launchPrompt ? { ...launched, prompt: launchPrompt } : launched }
}

/** Called once a run's final result is recorded (service.markDispatchResult). */
export function xosAfterRunFinished(run: AutomationRun): void {
  if (!isFinalAutomationRunStatus(run.status)) {
    return
  }
  const entry = held.get(run.id)
  if (entry?.committing) {
    return
  }
  // A run that hit a limit did not finish its work, so it isn't committed as finished.
  if (entry?.commit && run.status === 'completed' && !classifyFinishedRun(run)) {
    entry.committing = true
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    void commitRun(run, entry.commit).then((commit) => finishRun(run, commit))
    return
  }
  finishRun(run, null)
}

/** Waits for a commit started for this run (tests; the app never needs to). */
export function xosPendingCommits(): number {
  return Array.from(held.values()).filter((entry) => entry.committing).length
}

async function commitRun(run: AutomationRun, target: CommitTarget): Promise<XosRunCommit | null> {
  const config = readRunConfig(run.automationId).autoCommit
  if (!config) {
    return null
  }
  const name = automationHost()?.findAutomation(run.automationId)?.name ?? run.automationId
  try {
    const result = await xosAutoCommit({ ...target, automationName: name, config })
    appendLedger({ type: 'commit', runId: run.id, ...result })
    if (result.status === 'failed' || result.pushed === false) {
      notify(
        `${name}: auto-commit ${result.status === 'failed' ? 'failed' : 'could not push'}. ${result.detail ?? ''}`
      )
    }
    return result
  } catch (error) {
    console.warn('[xos] auto-commit failed', error)
    return null
  }
}

function finishRun(run: AutomationRun, commit: XosRunCommit | null): void {
  const entry = held.get(run.id)
  if (entry?.goal) {
    try {
      settleGoalAutomationRun({
        run,
        goal: entry.goal,
        startedAt: entry.goal.startedAt,
        verdict: classifyFinishedRun(run),
        commit: commit ? { sha: commit.sha, failed: commit.status === 'failed' } : null
      })
    } catch (error) {
      console.warn('[xos] could not settle the goal run', error)
      if (entry.goal.itemPath) {
        releaseWorkItemClaim(entry.goal.itemPath)
      }
    }
  }
  const host = automationHost()
  const retrying = xosObserveFinishedRun(
    {
      automation: host?.findAutomation(run.automationId) ?? undefined,
      runNow: (automationId) => host?.runNow(automationId) ?? Promise.resolve()
    },
    run
  )
  // L3: a retry keeps the lane, so a queued automation can't slip in between the two attempts.
  if (retrying && entry && entry.locks.length > 0) {
    forget(run.id, entry)
    handoffs.set(entry.automationId, {
      locks: entry.locks,
      leasePath: entry.leasePath,
      expiresAt: Date.now() + HANDOFF_TTL_MS
    })
    writeRunLease(entry.leasePath, null)
    syncSweepTimer()
    return
  }
  xosReleaseRun(run.id)
}

/** `orca goals stop`, for a goal running through its automation. */
export async function xosStopGoalAutomationRun(repoRoot: string, goal: string): Promise<boolean> {
  const host = automationHost()
  const match = Array.from(held).find(
    ([, entry]) => entry.goal?.repoRoot === repoRoot && entry.goal.goal === goal
  )
  const run = match && host?.findRun(match[1].automationId, match[0])
  if (!match || !host || !run) {
    return false
  }
  await host.closeRunTerminal(run).catch((error) => {
    console.warn('[xos] could not close a stopped run terminal', error)
  })
  await host.markDispatchResult({
    runId: match[0],
    status: 'dispatch_failed',
    error: 'Stopped by the operator.'
  })
  return true
}
