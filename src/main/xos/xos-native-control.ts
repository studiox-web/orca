// XOS fork: controlling native runs from outside the launch path: stop, timeout, and adopting what
// an earlier Orca process started (H8, H9).
import { adoptLock } from './xos-lane-lock'
import { mutableLiveRuns } from './xos-live-registry'
import type { XosLiveRun, XosStopReason } from './xos-live-runs-types'
import { readRunExitCode } from './xos-native-finalize'
import { isProcessAlive, listRunJournal, type XosNativeJournalEntry } from './xos-run-journal'

const STOP_GRACE_MS = 10_000
const ADOPT_POLL_MS = 5_000

const liveRuns = mutableLiveRuns()

function signalGroup(pid: number | null, signal: NodeJS.Signals): void {
  try {
    if (pid) {
      process.kill(-pid, signal)
    }
  } catch {
    // Already gone.
  }
}

export function journalOf(run: XosLiveRun): XosNativeJournalEntry {
  const {
    finishedAt: _finishedAt,
    exitCode: _exitCode,
    outcome: _outcome,
    failureReason: _failureReason,
    stopReason: _stopReason,
    finalizing: _finalizing,
    timer: _timer,
    ...rest
  } = run
  return {
    ...rest,
    kind: 'native',
    locks: run.locks.map(({ file, pid }) => ({ file, pid }))
  }
}

/** SIGTERM the whole run, then SIGKILL what ignores it. Settling happens when it exits. */
export function stopNativeGoalRun(
  runId: string,
  reason: XosStopReason = 'stopped'
): { ok: true; message: string } | { ok: false; error: string } {
  const run = liveRuns.get(runId)
  if (!run || run.finishedAt !== null) {
    return { ok: false, error: `Run ${runId} is not running.` }
  }
  run.stopReason ??= reason
  signalGroup(run.pid, 'SIGTERM')
  setTimeout(() => {
    if (run.finishedAt === null) {
      signalGroup(run.pid, 'SIGKILL')
    }
  }, STOP_GRACE_MS).unref()
  return { ok: true, message: `Stopping ${run.goal} (${runId}).` }
}

export function armRunTimeout(run: XosLiveRun): void {
  if (run.deadlineAtMs === null) {
    return
  }
  run.timer = setTimeout(
    () => stopNativeGoalRun(run.runId, 'timeout'),
    Math.max(0, run.deadlineAtMs - Date.now())
  )
  run.timer.unref()
}

/** An earlier Orca's runs: settle the finished, keep supervising the live (H8). */
export function adoptNativeRuns(settle: (run: XosLiveRun, code: number | null) => void): number {
  let adopted = 0
  for (const entry of listRunJournal()) {
    if (entry.kind !== 'native' || liveRuns.has(entry.runId)) {
      continue
    }
    const run: XosLiveRun = {
      ...entry,
      locks: entry.locks.map((lock) => adoptLock(lock.file, lock.pid)),
      finishedAt: null,
      exitCode: null,
      outcome: null,
      failureReason: null,
      stopReason: null,
      finalizing: false,
      timer: null
    }
    liveRuns.set(run.runId, run)
    adopted += 1
    if (!isProcessAlive(run.pid)) {
      settle(run, readRunExitCode(run.exitPath))
      continue
    }
    armRunTimeout(run)
    const poll = setInterval(() => {
      if (!isProcessAlive(run.pid)) {
        clearInterval(poll)
        settle(run, readRunExitCode(run.exitPath))
      }
    }, ADOPT_POLL_MS)
    poll.unref()
  }
  return adopted
}
