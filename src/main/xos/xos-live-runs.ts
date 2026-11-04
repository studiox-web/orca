// XOS fork: Stage D native goal runs (plan §4 row D, §3e). Goals whose project has no legacy
// run-goal-cron.sh run directly on Orca's own machinery: the stage B prompt assembly, RT7 lane
// locks (the same flock files xos-run-gate uses), §3g item claiming, RT8 scoped auto-commit and
// the stage A limit classifier for the outcome. Output streams to a log file plus an in-memory
// tail (xos-live-tail.ts reads it); receipts land in ~/.orca-xos/runs/<slug>.jsonl
// (xos-native-receipts.ts) so the §3c board adapter reads them like the legacy rows.
import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import { readLegacyCommitPolicies, xosAutoCommit } from './xos-auto-commit'
import { readHead } from './xos-goal-files'
import { assembleGoalPrompt } from './xos-goal-prompt'
import { claimWorkItem, releaseWorkItemClaim } from './xos-item-claims'
import { automationLockFile, laneLockFile, tryLock, type HeldLock } from './xos-lane-lock'
import { classifyRunScreen } from './xos-limit-classifier'
import { commitProjectHome, projectHomeDir } from './xos-project-home'
import { notify } from './xos-run-fallback'
import {
  appendReceipt,
  buildAgentRunCommand,
  itemTitleFrom,
  nativeRunLogsDir,
  runsTodayCount
} from './xos-native-receipts'
import type { XosLiveRun, XosNativeRunArgs } from './xos-live-runs-types'

export type { XosNativeRunArgs } from './xos-live-runs-types'

const TAIL_LINES = 120
const ITEM_PROMPT_BYTES = 32 * 1024
const FINISHED_RUN_TTL_MS = 60 * 60_000

const liveRuns = new Map<string, XosLiveRun>()

/** Read-only view of the live-run registry for xos-live-tail and the board adapter. */
export function liveRunRegistry(): ReadonlyMap<string, XosLiveRun> {
  return liveRuns
}

function pushTail(run: XosLiveRun, chunk: string): void {
  run.tail.push(chunk)
  if (run.tail.length > TAIL_LINES) {
    run.tail.splice(0, run.tail.length - TAIL_LINES)
  }
}

async function finalizeRun(run: XosLiveRun, code: number | null, logFd: number): Promise<void> {
  const finishedAt = new Date().toISOString()
  const verdict = classifyRunScreen(run.tail.join('\n'))
  run.finishedAt = finishedAt
  run.exitCode = code
  if (code === 0 && !verdict) {
    run.outcome = 'success'
  } else if (verdict) {
    run.outcome =
      verdict.kind === 'usage-limit' || verdict.kind === 'overloaded' ? 'limited' : 'failed'
    run.failureReason =
      verdict.kind === 'auth' || verdict.kind === 'missing-binary' ? verdict.kind : 'usage_limit'
  } else {
    run.outcome = 'failed'
    run.failureReason = 'run_failed'
  }
  try {
    closeSync(logFd)
  } catch {
    // Already closed.
  }
  appendReceipt(run.repoRoot, {
    run_id: run.runId,
    goal: run.goal,
    runner: run.agent,
    status: run.outcome === 'success' ? 'success' : 'failed',
    started_at: run.startedAt,
    finished_at: finishedAt,
    duration_seconds: Math.max(
      0,
      Math.round((Date.parse(finishedAt) - Date.parse(run.startedAt)) / 1000)
    ),
    exit_code: code,
    log_path: run.logPath,
    model: run.model,
    reasoning_effort: run.effort,
    failure_reason: run.outcome === 'success' ? null : run.failureReason,
    trigger: run.trigger,
    mode: run.mode,
    item_path: run.itemPath,
    item_title: run.itemTitle,
    worktree_path: run.worktreePath,
    branch: run.branch,
    parent_run_id: run.parentRunId
  })
  if (run.itemPath && existsSync(run.itemPath)) {
    releaseWorkItemClaim(run.itemPath)
  }
  run.locks.forEach((lock) => lock.release())
  run.locks = []
  if (!run.disableAutoCommit && run.outcome === 'success') {
    const policy = readLegacyCommitPolicies(run.repoRoot).find((entry) => entry.goal === run.goal)
    if (policy) {
      const result = await xosAutoCommit({
        cwd: run.worktreePath ?? run.repoRoot,
        repoRoot: run.repoRoot,
        automationName: run.goal,
        config: { paths: policy.paths, message: `chore(automation): ${run.goal}`, push: false }
      })
      if (result.status === 'failed') {
        notify(`${run.goal}: auto-commit failed. ${result.detail ?? ''}`)
      }
    }
  }
  if (run.outcome !== 'success') {
    notify(`${run.goal}: native run ${run.outcome} (${run.failureReason ?? 'unknown'}).`)
  }
  void commitProjectHome(run.repoRoot, `xos: native run ${run.goal} (${run.outcome})`)
}

/** Start a native goal run: prompt assembly, item claim, lane locks, streaming child, receipt. */
export async function startNativeGoalRun(
  args: XosNativeRunArgs
): Promise<{ ok: true; runId: string; message: string } | { ok: false; error: string }> {
  const nowMs = args.nowMs ?? Date.now()
  const repoRoot = args.repoRoot
  const mode: XosGoalRunMode = args.mode ?? 'normal'
  for (const [runId, run] of liveRuns) {
    if (run.finishedAt !== null && Date.parse(run.finishedAt) + FINISHED_RUN_TTL_MS < nowMs) {
      liveRuns.delete(runId)
    }
  }
  try {
    const assembled = assembleGoalPrompt({
      repoRoot,
      goal: args.goal,
      mode,
      sidecar: args.sidecar,
      operatorMessage: args.message,
      requestedAgent: args.runner,
      runsToday: runsTodayCount(repoRoot, args.goal, nowMs),
      bypassQueueGate: true
    })
    if (assembled.status !== 'ready') {
      return { ok: false, error: assembled.reason }
    }
    const itemPath =
      args.itemPath ??
      (mode === 'normal' ? (assembled.queueGate?.candidateItemPaths[0] ?? null) : null)
    const runId = `${args.goal}-${nowMs.toString(36)}`
    let prompt = assembled.prompt
    let itemTitle: string | null = null
    let itemStage: string | null = null
    if (itemPath) {
      const claim = claimWorkItem(itemPath, { runId, nowMs })
      if (!claim.claimed) {
        return { ok: false, error: claim.reason ?? 'Could not claim the work item.' }
      }
      itemTitle = itemTitleFrom(itemPath)
      itemStage = basename(dirname(itemPath))
      prompt += `\n\n## Claimed Work Item (§3g)\n\n- File: ${itemPath}\n- Stage: ${itemStage}\n- This run claimed it (\`claimed_by: ${runId}\`). On success, move it to the next stage per the queue rules and reference "${basename(itemPath, '.md')}" in the commit message.\n\n### Item contents\n\n${readHead(itemPath, ITEM_PROMPT_BYTES) ?? '_Unreadable item file._'}`
    }
    const lockFiles = [
      automationLockFile(repoRoot, `goal-${args.goal}`),
      laneLockFile(repoRoot, assembled.lockLane)
    ]
    const locks: HeldLock[] = []
    for (const file of lockFiles) {
      const lock = await tryLock(file, assembled.lockWaitSeconds)
      if (!lock) {
        locks.forEach((held) => held.release())
        if (itemPath) {
          releaseWorkItemClaim(itemPath)
        }
        return {
          ok: false,
          error: `Lane "${assembled.lockLane}" is busy${assembled.lockWaitSeconds ? ' after waiting' : ''}; the run was skipped.`
        }
      }
      locks.push(lock)
    }
    const logDir = nativeRunLogsDir(repoRoot)
    mkdirSync(logDir, { recursive: true })
    const promptPath = join(logDir, `${args.goal}-${runId}.prompt.md`)
    writeFileSync(promptPath, prompt, 'utf8')
    const logPath = join(logDir, `${args.goal}-${runId}.log`)
    const logFd = openSync(logPath, 'a')
    const cwd = args.worktree?.path ?? repoRoot
    const command = buildAgentRunCommand({
      root: cwd,
      promptPath,
      agent: assembled.agent,
      model: assembled.model,
      effort: assembled.effort,
      lockLane: assembled.lockLane,
      inboxOnly: mode === 'reply'
    })
    const run: XosLiveRun = {
      runId,
      repoRoot,
      goal: args.goal,
      agent: assembled.agent,
      mode,
      trigger: args.trigger ?? 'manual',
      parentRunId: args.parentRunId ?? null,
      pid: null,
      startedAt: new Date(nowMs).toISOString(),
      itemPath,
      itemTitle,
      itemStage,
      worktreePath: args.worktree?.path ?? null,
      branch: args.worktree?.branch ?? null,
      logPath,
      command,
      model: assembled.model,
      effort: assembled.effort,
      disableAutoCommit: assembled.disableAutoCommit,
      tail: [],
      locks,
      finishedAt: null,
      exitCode: null,
      outcome: null,
      failureReason: null
    }
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        ORCA_GOAL_HOME: assembled.goalDir,
        ORCA_PROJECT_HOME: projectHomeDir(repoRoot),
        ...(itemPath ? { ORCA_ITEM: itemPath } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    run.pid = child.pid ?? null
    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      try {
        writeFileSync(logFd, text)
      } catch {
        // Log file vanished; the in-memory tail still works.
      }
      pushTail(run, text)
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('close', (code) => void finalizeRun(run, code, logFd))
    child.unref()
    // Spawn pipes are sockets with unref(); the Readable type just doesn't declare it.
    const stdout: (Readable & { unref?: () => void }) | null = child.stdout
    const stderr: (Readable & { unref?: () => void }) | null = child.stderr
    stdout?.unref?.()
    stderr?.unref?.()
    liveRuns.set(runId, run)
    return {
      ok: true,
      runId,
      message: `Started ${args.goal} natively (pid ${run.pid ?? '?'}). Log: ${logPath}`
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
