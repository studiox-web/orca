// XOS fork: read the live (or latest native) run of a goal for the Goal Viewer live-tail section
// and the card live badges (plan §4 row D, UI7 live-tail button, OV2). Running runs come from the
// in-memory registry; finished ones fall back to their receipt plus the on-disk log tail.
import { basename, dirname } from 'node:path'
import type { XosLiveRunTail, XosRunningJob } from '../../shared/xos-goals-types'
import { readHead } from './xos-goal-files'
import { readReceiptLines } from './xos-native-receipts'
import type { XosLiveRun } from './xos-live-runs-types'

const LOG_TAIL_LINES = 64
const RUN_CONTEXT_BYTES = 12 * 1024

function tailToLines(text: string): string[] {
  return text.split('\n').slice(-LOG_TAIL_LINES)
}

/** A live native run as the board's running-job row, when one is going for this goal. */
export function nativeRunningFor(
  liveRuns: ReadonlyMap<string, XosLiveRun>,
  repoRoot: string,
  goal: string
): XosRunningJob | null {
  for (const run of liveRuns.values()) {
    if (run.repoRoot === repoRoot && run.goal === goal && run.finishedAt === null) {
      return {
        goal,
        pid: run.pid ?? 0,
        startedAt: run.startedAt,
        elapsedSeconds: Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 1000)),
        runner: run.agent,
        command: run.command
      }
    }
  }
  return null
}

function fromLiveRun(run: XosLiveRun): XosLiveRunTail {
  return {
    runId: run.runId,
    goal: run.goal,
    status:
      run.finishedAt === null
        ? 'running'
        : run.outcome === 'success'
          ? 'success'
          : run.outcome === 'limited'
            ? 'limited'
            : 'failed',
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedSeconds: Math.round(
      (Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt)) / 1000
    ),
    lines: tailToLines(run.tail.join('')),
    logPath: run.logPath,
    item: run.itemPath
      ? { path: run.itemPath, title: run.itemTitle ?? '', stage: run.itemStage ?? '' }
      : null,
    worktreePath: run.worktreePath,
    branch: run.branch,
    exitCode: run.exitCode,
    failureReason: run.failureReason,
    trigger: run.trigger,
    parentRunId: run.parentRunId
  }
}

function fromReceipt(repoRoot: string, goal: string): XosLiveRunTail | null {
  const receipt = readReceiptLines(repoRoot)
    .toReversed()
    .find((entry) => entry.goal === goal)
  if (!receipt) {
    return null
  }
  const logTail = receipt.log_path ? readHead(receipt.log_path, RUN_CONTEXT_BYTES) : null
  return {
    runId: receipt.run_id,
    goal,
    status:
      receipt.trigger === 'manual_takeover'
        ? 'takeover'
        : receipt.status === 'success'
          ? 'success'
          : receipt.failure_reason === 'usage_limit'
            ? 'limited'
            : 'failed',
    startedAt: receipt.started_at ?? '',
    finishedAt: receipt.finished_at,
    elapsedSeconds: receipt.duration_seconds,
    lines: logTail ? tailToLines(logTail) : [],
    logPath: receipt.log_path,
    item: receipt.item_path
      ? {
          path: receipt.item_path,
          title: receipt.item_title ?? '',
          stage: basename(dirname(receipt.item_path))
        }
      : null,
    worktreePath: receipt.worktree_path ?? null,
    branch: receipt.branch ?? null,
    exitCode: receipt.exit_code ?? null,
    failureReason: receipt.failure_reason ?? null,
    trigger: receipt.trigger,
    parentRunId: receipt.parent_run_id ?? null
  }
}

/** The live (or latest native) run of a goal, for the Goal Viewer live-tail section. */
export function readLiveTail(
  liveRuns: ReadonlyMap<string, XosLiveRun>,
  repoRoot: string,
  goal: string
): XosLiveRunTail | null {
  for (const run of liveRuns.values()) {
    if (run.repoRoot === repoRoot && run.goal === goal) {
      return fromLiveRun(run)
    }
  }
  return fromReceipt(repoRoot, goal)
}
