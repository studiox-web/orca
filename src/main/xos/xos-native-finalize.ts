// XOS fork: the end of a native run, in the order that keeps it safe: classify, commit while the
// lane is still held (M5), settle the item (H10), write the receipt, then free the lane.
import { existsSync, readFileSync } from 'node:fs'
import { readLegacyCommitPolicies, xosAutoCommit } from './xos-auto-commit'
import { frontmatterList, parseFrontmatter, readHead, readTail } from './xos-goal-files'
import { settleWorkItem } from './xos-item-outcome'
import { classifyRunScreen, type XosRunLimitVerdict } from './xos-limit-classifier'
import type { XosLiveRun } from './xos-live-runs-types'
import { appendReceipt } from './xos-native-receipts'
import { commitProjectHome, isGoalCentral, resolveGoalDir } from './xos-project-home'
import { removeRunJournal } from './xos-run-journal'
import type { XosRunCommit } from '../../shared/xos-runtime-types'

const OUTPUT_TAIL_BYTES = 64 * 1024
const LEGACY_GOAL_PATH = /^automations\/goals\//

export function safeNotify(body: string): void {
  try {
    const mod = 'electron'
    const { Notification } = require(mod)
    if (Notification?.isSupported?.()) {
      new Notification({ title: 'Orca automation', body }).show()
    }
  } catch {
    // Ignore outside Electron or in tests.
  }
}

/** `owned_paths` first; after import, the legacy policy's repo goal folder no longer applies. */
export function goalCommitPaths(repoRoot: string, goal: string): string[] {
  const fm = parseFrontmatter(readHead(`${resolveGoalDir(repoRoot, goal)}/GOAL.md`, 16 * 1024))
  const owned = frontmatterList(fm, 'owned_paths')
  if (owned.length > 0) {
    return owned
  }
  const legacy =
    readLegacyCommitPolicies(repoRoot).find((entry) => entry.goal === goal)?.paths ?? []
  return isGoalCentral(repoRoot, goal)
    ? legacy.filter((path) => !LEGACY_GOAL_PATH.test(path))
    : legacy
}

/** Build now's worktree is its own branch, so everything in it belongs to the item (§3f). */
async function commitRun(run: XosLiveRun): Promise<XosRunCommit | null> {
  const paths = run.worktreePath ? ['.'] : goalCommitPaths(run.repoRoot, run.goal)
  if (paths.length === 0) {
    return null
  }
  const item = run.itemTitle ? `\n\nItem: ${run.itemTitle}` : ''
  return xosAutoCommit({
    cwd: run.worktreePath ?? run.repoRoot,
    repoRoot: run.repoRoot,
    automationName: run.goal,
    config: { paths, message: `chore(automation): ${run.goal}${item}`, push: false }
  })
}

function outcomeOf(
  run: XosLiveRun,
  code: number | null,
  verdict: XosRunLimitVerdict | null
): Pick<XosLiveRun, 'outcome' | 'failureReason'> {
  if (run.stopReason) {
    return { outcome: 'failed', failureReason: run.stopReason }
  }
  if (verdict) {
    const limited = verdict.kind === 'usage-limit' || verdict.kind === 'overloaded'
    return {
      outcome: limited ? 'limited' : 'failed',
      failureReason: limited ? 'usage_limit' : verdict.kind
    }
  }
  return code === 0
    ? { outcome: 'success', failureReason: null }
    : { outcome: 'failed', failureReason: 'run_failed' }
}

/** The exit code a finished run left behind, for runs Orca no longer has a child handle to. */
export function readRunExitCode(exitPath: string): number | null {
  if (!existsSync(exitPath)) {
    return null
  }
  const code = Number.parseInt(readFileSync(exitPath, 'utf8').trim(), 10)
  return Number.isFinite(code) ? code : null
}

export async function finalizeNativeRun(
  run: XosLiveRun,
  code: number | null,
  retry: (run: XosLiveRun, verdict: XosRunLimitVerdict) => Promise<boolean>
): Promise<void> {
  if (run.finalizing) {
    return
  }
  run.finalizing = true
  if (run.timer) {
    clearTimeout(run.timer)
    run.timer = null
  }
  const verdict = run.stopReason
    ? null
    : classifyRunScreen(readTail(run.logPath, OUTPUT_TAIL_BYTES), { exitCode: code })
  Object.assign(run, outcomeOf(run, code, verdict))
  run.exitCode = code
  const success = run.outcome === 'success'
  const commit = success && !run.disableAutoCommit ? await commitRun(run).catch(() => null) : null
  if (commit?.status === 'failed') {
    safeNotify(`${run.goal}: auto-commit failed. ${commit.detail ?? ''}`)
  }
  if (run.itemPath) {
    settleWorkItem({
      repoRoot: run.repoRoot,
      goal: run.goal,
      itemPath: run.itemPath,
      runId: run.runId,
      success: success && commit?.status !== 'failed',
      error: run.failureReason ?? commit?.detail,
      branch: run.branch,
      commit: commit?.sha
    })
  }
  const finishedAt = new Date().toISOString()
  appendReceipt(run.repoRoot, {
    run_id: run.runId,
    goal: run.goal,
    runner: run.agent,
    status: success ? 'success' : 'failed',
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
    failure_reason: success ? null : run.failureReason,
    trigger: run.trigger,
    mode: run.mode,
    item_path: run.itemPath,
    item_title: run.itemTitle,
    worktree_path: run.worktreePath,
    branch: run.branch,
    parent_run_id: run.parentRunId
  })
  run.locks.forEach((lock) => lock.release())
  run.locks = []
  removeRunJournal(run.runId, run.leasePath)
  run.finishedAt = finishedAt
  void commitProjectHome(run.repoRoot, `xos: native run ${run.goal} (${run.outcome})`)
  if (success) {
    return
  }
  const retried = verdict ? await retry(run, verdict) : false
  if (!retried) {
    safeNotify(`${run.goal}: native run ${run.outcome} (${run.failureReason ?? 'unknown'}).`)
  }
}
