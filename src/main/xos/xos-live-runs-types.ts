// XOS fork: the native run record shared by xos-live-runs (orchestration), xos-native-finalize and
// xos-live-tail (board/viewer reads). The durable half lives in the run journal; this adds the
// outcome and the lock handles of the current Orca process.
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import type { XosModelChoice } from '../../shared/xos-runtime-types'
import type { HeldLock } from './xos-lane-lock'
import type { XosNativeJournalEntry } from './xos-run-journal'

export type XosNativeRunTrigger =
  | 'manual'
  | 'scheduled'
  | 'event'
  | 'manual_takeover'
  | 'build_now'
  | 'continue_on'

export type XosNativeRunArgs = {
  repoRoot: string
  goal: string
  mode?: XosGoalRunMode
  sidecar?: string
  message?: string
  runner?: string
  model?: string | null
  effort?: string | null
  itemPath?: string
  trigger?: XosNativeRunTrigger
  parentRunId?: string | null
  worktree?: { path: string; branch: string | null }
  /** Operator override of the queue gate (RT16); a skip is otherwise recorded, not run. */
  force?: boolean
  /** RT13: a parent run's lane, from CASCADE_ACTIVE_LOCK_LANE; honoured only while really held. */
  inheritedLane?: string
  /** Set by fallback retries. */
  attempt?: number
  fallbackChain?: XosModelChoice[]
  nowMs?: number
}

export type XosStopReason = 'stopped' | 'timeout'

export type XosLiveRun = Omit<XosNativeJournalEntry, 'kind' | 'locks' | 'mode' | 'trigger'> & {
  mode: XosGoalRunMode
  trigger: XosNativeRunTrigger
  locks: HeldLock[]
  finishedAt: string | null
  exitCode: number | null
  outcome: 'success' | 'failed' | 'limited' | null
  failureReason: string | null
  stopReason: XosStopReason | null
  finalizing: boolean
  timer: NodeJS.Timeout | null
}
