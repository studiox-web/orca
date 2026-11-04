// XOS fork: the in-memory native run record shared by xos-live-runs (orchestration) and
// xos-live-tail (board/viewer reads). Receipts on disk outlive it; this only tracks runs that
// are live now or finished recently enough for tail reads without reopening the log.
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import type { HeldLock } from './xos-lane-lock'

export type XosNativeRunTrigger =
  | 'manual'
  | 'scheduled'
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
  itemPath?: string
  trigger?: XosNativeRunTrigger
  parentRunId?: string | null
  worktree?: { path: string; branch: string | null }
  nowMs?: number
}

export type XosLiveRun = {
  runId: string
  repoRoot: string
  goal: string
  agent: string
  mode: XosGoalRunMode
  trigger: XosNativeRunTrigger
  parentRunId: string | null
  pid: number | null
  startedAt: string
  itemPath: string | null
  itemTitle: string | null
  itemStage: string | null
  worktreePath: string | null
  branch: string | null
  logPath: string
  command: string
  model: string | null
  effort: string | null
  disableAutoCommit: boolean
  tail: string[]
  locks: HeldLock[]
  finishedAt: string | null
  exitCode: number | null
  outcome: 'success' | 'failed' | 'limited' | null
  failureReason: string | null
}
