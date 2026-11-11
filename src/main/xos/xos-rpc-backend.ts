// XOS fork: what the CLI needs from the running Orca. Set when the XOS handlers register, so the
// RPC layer stays free of Electron imports.
import type { XosActionResult } from '../../shared/xos-goals-types'

export type XosRunGoalInput = {
  repoRoot: string
  goal: string
  mode?: 'normal' | 'reply' | 'sidecar'
  sidecar?: string
  message?: string
  agent?: string
  force?: boolean
  inheritedLane?: string
}

export type XosScheduleResult =
  | { ok: true; automationId: string; message: string }
  | { ok: false; error: string }

export type XosRpcBackend = {
  runGoal: (input: XosRunGoalInput) => Promise<XosActionResult>
  stopGoal: (input: { repoRoot: string; goal: string }) => Promise<XosActionResult>
  scheduleGoal: (input: {
    repoRoot: string
    goal: string
    schedule: string
    agent?: string
    timezone?: string
  }) => Promise<XosScheduleResult>
  replaceCronJob: (input: { jobId: string; timezone?: string }) => Promise<XosScheduleResult>
  usageLimits: () => { agent: string; known: boolean; exhausted: boolean; note: string }[]
}

let backend: XosRpcBackend | null = null

export function setXosRpcBackend(next: XosRpcBackend): void {
  backend = next
}

export function requireXosRpcBackend(): XosRpcBackend {
  if (!backend) {
    throw new Error('XOS is not available on this runtime.')
  }
  return backend
}
