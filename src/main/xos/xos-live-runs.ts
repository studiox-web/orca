// XOS fork: Stage D native goal runs (plan §4 row D, §3e): the stage B prompt assembly, RT7 lane
// locks, §3g item claiming, RT8 scoped auto-commit and the stage A limit classifier. A run writes
// straight to its own log and exit file and is recorded in the run journal, so it survives an Orca
// restart: the next Orca adopts it (adoptNativeRuns) and settles it the same way.
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import type { XosModelChoice } from '../../shared/xos-runtime-types'
import { buildAgentRunCommand, nativeFallbackChain, shellQuote } from './xos-agent-command'
import { checkDispatchPolicy, type XosDispatchSource } from './xos-dispatch-policy'
import { goalAuthority, isGoalAuthorityConfirmed } from './xos-goal-authority'
import { frontmatterList } from './xos-goal-files'
import { goalRunTimeoutMinutes } from './xos-goal-run-timeout'
import { assembleGoalPrompt, markGoalInboxRead } from './xos-goal-prompt'
import { claimedItemPromptSection, claimWorkItem, releaseWorkItemClaim } from './xos-item-claims'
import { goalLockFile, laneLockFile, tryLock, type HeldLock } from './xos-lane-lock'
import type { XosRunLimitVerdict } from './xos-limit-classifier'
import { mutableLiveRuns } from './xos-live-registry'
export { liveRunRegistry } from './xos-live-registry'
export { stopNativeGoalRun }
import type { XosLiveRun, XosNativeRunArgs } from './xos-live-runs-types'
import {
  adoptNativeRuns as adoptRuns,
  armRunTimeout,
  journalOf,
  stopNativeGoalRun
} from './xos-native-control'
import { finalizeNativeRun, safeNotify } from './xos-native-finalize'
import {
  appendReceipt,
  goalRunsToday,
  itemTitleFrom,
  nativeRunLogsDir
} from './xos-native-receipts'
import { commitProjectHome, projectHomeDir } from './xos-project-home'
import {
  leasePathFor,
  listRunJournal,
  removeRunJournal,
  writeRunJournal,
  writeRunLease
} from './xos-run-journal'

export type { XosNativeRunArgs } from './xos-live-runs-types'

const FINISHED_RUN_TTL_MS = 60 * 60_000
const LEASE_GRACE_MS = 10 * 60_000

const liveRuns = mutableLiveRuns()

type StartResult = { ok: true; runId: string; message: string } | { ok: false; error: string }

function dispatchSource(trigger: XosNativeRunArgs['trigger']): XosDispatchSource {
  return trigger === 'scheduled' ? 'schedule' : trigger === 'event' ? 'event' : 'operator'
}

function pruneFinished(nowMs: number): void {
  for (const [runId, run] of liveRuns) {
    if (run.finishedAt !== null && Date.parse(run.finishedAt) + FINISHED_RUN_TTL_MS < nowMs) {
      liveRuns.delete(runId)
    }
  }
}

/** RT5/§3.4: start the next model for a limited run; false when the chain has nothing left. */
async function retryOnFallback(run: XosLiveRun, verdict: XosRunLimitVerdict): Promise<boolean> {
  const agentBroken = verdict.kind === 'auth' || verdict.kind === 'missing-binary'
  const chain = agentBroken
    ? run.fallbackChain.filter((choice) => choice.agent !== run.agent)
    : run.fallbackChain
  const [next, ...rest] = chain
  if (run.disableFallback || !next) {
    return false
  }
  const started = await startNativeGoalRun({
    repoRoot: run.repoRoot,
    goal: run.goal,
    mode: run.mode,
    runner: next.agent,
    model: next.model,
    effort: next.effort,
    itemPath: run.itemPath ?? undefined,
    trigger: run.trigger,
    parentRunId: run.runId,
    worktree: run.worktreePath ? { path: run.worktreePath, branch: run.branch } : undefined,
    force: true,
    attempt: run.attempt + 1,
    fallbackChain: rest
  })
  safeNotify(
    started.ok
      ? `${run.goal}: ${verdict.kind} on ${run.agent}; retrying on ${next.agent}.`
      : `${run.goal}: fallback to ${next.agent} could not start (${started.error}).`
  )
  return started.ok
}

function settle(run: XosLiveRun, code: number | null): void {
  void finalizeNativeRun(run, code, retryOnFallback)
}

/** An earlier Orca's runs: settle the finished, keep supervising the live (H8). */
export function adoptNativeRuns(): number {
  return adoptRuns(settle)
}

function laneHeldByActiveRun(laneFile: string): boolean {
  return listRunJournal().some((entry) => entry.locks.some((lock) => lock.file === laneFile))
}

function recordSkip(args: XosNativeRunArgs, reason: string, startedAt: string): void {
  appendReceipt(args.repoRoot, {
    run_id: `${args.goal}-skip-${Date.parse(startedAt).toString(36)}`,
    goal: args.goal,
    runner: args.runner ?? null,
    status: 'skipped_precheck',
    started_at: startedAt,
    finished_at: startedAt,
    duration_seconds: 0,
    exit_code: null,
    log_path: '',
    failure_reason: reason,
    trigger: args.trigger ?? 'manual',
    mode: args.mode ?? 'normal'
  })
}

/** Start a native goal run: policy, prompt assembly, item claim, lane locks, detached child. */
export async function startNativeGoalRun(args: XosNativeRunArgs): Promise<StartResult> {
  const nowMs = args.nowMs ?? Date.now()
  const { repoRoot, goal } = args
  const mode: XosGoalRunMode = args.mode ?? 'normal'
  const trigger = args.trigger ?? 'manual'
  const startedAt = new Date(nowMs).toISOString()
  pruneFinished(nowMs)
  const policy = checkDispatchPolicy({ repoRoot, source: dispatchSource(trigger), nowMs })
  if (!policy.allowed) {
    return { ok: false, error: policy.reason }
  }
  const locks: HeldLock[] = []
  let claimedItem: string | null = null
  const runId = `${goal}-${nowMs.toString(36)}`
  const leasePath = leasePathFor(runId)
  const abandon = (): void => {
    locks.forEach((held) => held.release())
    if (claimedItem) {
      releaseWorkItemClaim(claimedItem)
    }
    removeRunJournal(runId, leasePath)
  }
  try {
    const assembled = assembleGoalPrompt({
      repoRoot,
      goal,
      mode,
      sidecar: args.sidecar,
      operatorMessage: args.message,
      requestedAgent: args.runner,
      requestedModel: args.model,
      requestedEffort: args.effort,
      runsToday: goalRunsToday(repoRoot, goal, nowMs),
      bypassQueueGate: args.force === true
    })
    if (assembled.status !== 'ready') {
      recordSkip(args, assembled.reason, startedAt)
      return { ok: false, error: assembled.reason }
    }
    const fm = assembled.frontmatter
    const confirmed = isGoalAuthorityConfirmed(repoRoot, goal, fm)
    if (trigger !== 'manual' && goalAuthority(fm).elevated && !confirmed) {
      return {
        ok: false,
        error: `${goal} has deploy or push authority; confirm it before it can run unattended.`
      }
    }
    const itemPath =
      args.itemPath ??
      (mode === 'normal' ? (assembled.queueGate?.candidateItemPaths[0] ?? null) : null)
    let prompt = assembled.prompt
    let itemTitle: string | null = null
    let itemStage: string | null = null
    if (itemPath) {
      const claim = claimWorkItem(itemPath, { runId, nowMs })
      if (!claim.claimed) {
        return { ok: false, error: claim.reason ?? 'Could not claim the work item.' }
      }
      claimedItem = itemPath
      itemTitle = itemTitleFrom(itemPath)
      itemStage = basename(dirname(itemPath))
      prompt += claimedItemPromptSection(itemPath, runId)
    }
    const timeoutMinutes = goalRunTimeoutMinutes(fm)
    const deadlineAtMs = nowMs + timeoutMinutes * 60_000
    const lease = { path: leasePath, expiresAtMs: deadlineAtMs + LEASE_GRACE_MS }
    writeRunLease(leasePath, null)
    const laneFile = laneLockFile(repoRoot, assembled.lockLane)
    const inherited = args.inheritedLane === assembled.lockLane && laneHeldByActiveRun(laneFile)
    for (const file of [goalLockFile(repoRoot, goal), ...(inherited ? [] : [laneFile])]) {
      const lock = await tryLock(file, assembled.lockWaitSeconds, lease)
      if (!lock) {
        abandon()
        return {
          ok: false,
          error: `Lane "${assembled.lockLane}" is busy${assembled.lockWaitSeconds ? ' after waiting' : ''}; the run was skipped.`
        }
      }
      locks.push(lock)
    }
    const logDir = nativeRunLogsDir(repoRoot)
    mkdirSync(logDir, { recursive: true })
    const promptPath = join(logDir, `${runId}.prompt.md`)
    writeFileSync(promptPath, prompt, 'utf8')
    const logPath = join(logDir, `${runId}.log`)
    const exitPath = join(logDir, `${runId}.exit`)
    const cwd = args.worktree?.path ?? repoRoot
    const command = buildAgentRunCommand({
      root: cwd,
      promptPath,
      agent: assembled.agent,
      model: assembled.model,
      effort: assembled.effort,
      lockLane: assembled.lockLane,
      inboxOnly: mode === 'reply',
      bypassPermissions: confirmed && !assembled.hasExternalInbox
    })
    const chain: XosModelChoice[] =
      args.fallbackChain ??
      (trigger !== 'manual' || fm.fallback_on_manual === true
        ? nativeFallbackChain(
            { agent: assembled.agent, model: assembled.model, effort: assembled.effort },
            frontmatterList(fm, 'agents'),
            frontmatterList(fm, 'fallbacks')
          )
        : [])
    const run: XosLiveRun = {
      runId,
      repoRoot,
      goal,
      agent: assembled.agent,
      mode,
      trigger,
      parentRunId: args.parentRunId ?? null,
      pid: null,
      startedAt,
      deadlineAtMs,
      leasePath,
      itemPath,
      itemTitle,
      itemStage,
      worktreePath: args.worktree?.path ?? null,
      branch: args.worktree?.branch ?? null,
      logPath,
      exitPath,
      command,
      model: assembled.model,
      effort: assembled.effort,
      disableAutoCommit: assembled.disableAutoCommit,
      disableFallback: assembled.disableFallback,
      attempt: args.attempt ?? 0,
      fallbackChain: chain,
      locks,
      finishedAt: null,
      exitCode: null,
      outcome: null,
      failureReason: null,
      stopReason: null,
      finalizing: false,
      timer: null
    }
    const logFd = openSync(logPath, 'a')
    let child: ReturnType<typeof spawnProcess>
    try {
      child = spawnProcess({
        program: '/bin/bash',
        args: [
          '-lc',
          `${command}\ncode=$?\nprintf '%s' "$code" > ${shellQuote(exitPath)}\nexit "$code"`
        ],
        cwd,
        detached: true,
        env: {
          ...process.env,
          ORCA_GOAL_HOME: assembled.goalDir,
          ORCA_PROJECT_HOME: projectHomeDir(repoRoot),
          ORCA_RUN_ID: runId,
          ...(itemPath ? { ORCA_ITEM: itemPath } : {})
        },
        stdio: ['ignore', logFd, logFd]
      })
    } finally {
      closeSync(logFd)
    }
    run.pid = child.pid ?? null
    writeRunLease(leasePath, run.pid)
    writeRunJournal(journalOf(run))
    liveRuns.set(runId, run)
    child.on('error', (error) => {
      console.warn('[xos] native run failed to start', error)
      settle(run, null)
    })
    child.on('close', (code) => settle(run, code))
    child.unref()
    armRunTimeout(run)
    markGoalInboxRead(assembled.inboxPaths, goal, startedAt)
    void commitProjectHome(repoRoot, `xos: start ${mode} run for ${goal}`)
    return {
      ok: true,
      runId,
      message: `Started ${goal} natively (pid ${run.pid ?? '?'}). Log: ${logPath}`
    }
  } catch (error) {
    abandon()
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
