import type {
  CoordinatedEscalationCode,
  CoordinatedRunProgress
} from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { DISPATCH_CIRCUIT_BREAK_FAILURES } from '../runtime/orchestration/db/dispatch-context/dispatch-circuit-breaker'

export const DEFAULT_REVIEW_ITERATION_CEILING = 2

export type CeilingBreach = Readonly<{ code: CoordinatedEscalationCode; detail: string }>

/** Run-wide limits checked before any new Dispatch; a breach starts nothing. */
export function evaluateDispatchCeilings(input: {
  snapshot: ResolvedAutomationRunSnapshot
  progress: CoordinatedRunProgress
  now: number
  pendingCostUsd: number
}): CeilingBreach | null {
  const ceilings = input.snapshot.globalCeilings
  const startFailureLimit = ceilings.maxDispatchStartFailures ?? DISPATCH_CIRCUIT_BREAK_FAILURES
  if (input.progress.dispatchStartFailures >= startFailureLimit) {
    return {
      code: 'start_failure_ceiling',
      detail: `${input.progress.dispatchStartFailures} Dispatch start failures reached the limit of ${startFailureLimit}.`
    }
  }
  if (ceilings.maxWallClockSeconds !== undefined) {
    const elapsedMs = input.now - input.progress.startedAt
    if (elapsedMs >= ceilings.maxWallClockSeconds * 1000) {
      return {
        code: 'wall_clock_ceiling',
        detail: `Run used ${Math.floor(elapsedMs / 1000)}s of its ${ceilings.maxWallClockSeconds}s wall-clock budget.`
      }
    }
  }
  if (ceilings.maxEstimatedCostUsd !== undefined) {
    const projected = input.progress.spentCostUsd + input.pendingCostUsd
    if (projected > ceilings.maxEstimatedCostUsd) {
      return {
        code: 'cost_ceiling',
        detail: `Projected spend $${projected.toFixed(4)} exceeds the $${ceilings.maxEstimatedCostUsd} budget.`
      }
    }
  }
  return null
}

/** The stricter of the child's frozen review limit and the run-wide ceiling. */
export function reviewIterationLimit(
  snapshot: ResolvedAutomationRunSnapshot,
  child: ResolvedChildSnapshot
): number {
  const global = snapshot.globalCeilings.maxReviewIterations ?? DEFAULT_REVIEW_ITERATION_CEILING
  return Math.min(child.launchConfig.maxReviewIterations, global)
}

/** First attempt plus the frozen retry budget. */
export function stageAttemptLimit(child: ResolvedChildSnapshot): number {
  return 1 + child.launchConfig.maxRetries
}
