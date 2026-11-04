// XOS fork: in-memory registry of running native runs. Shared between the execution engine
// (xos-live-runs) and read-only consumers (xos-goal-board, xos-live-tail) so board assembly stays
// plain-Node and does not pull execution/spawn machinery into the CLI.
import type { XosLiveRun } from './xos-live-runs-types'

const liveRuns = new Map<string, XosLiveRun>()

export function liveRunRegistry(): ReadonlyMap<string, XosLiveRun> {
  return liveRuns
}

export function mutableLiveRuns(): Map<string, XosLiveRun> {
  return liveRuns
}
