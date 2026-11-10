import {
  isCoordinatedNativeAttempt,
  nativeAttemptSemanticAdmissionProblem
} from './coordinated-automation-native-attempt'
import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import {
  assertCoordinatorActive,
  type CoordinatedPassContext
} from './coordinated-automation-recovery-context'

export type CoordinatedRunOutcomeState =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'outcome_uncertain'
  | 'waiting'

export type CoordinatedRunOutcome = Readonly<{
  state: CoordinatedRunOutcomeState
  reason: string | null
  run: AutomationRun
  progress: CoordinatedRunProgress | null
}>

function requireRun(ctx: CoordinatedPassContext, automationRunId: string): AutomationRun {
  const run = ctx.store.listAutomationRuns().find((r) => r.id === automationRunId)
  if (!run) {
    throw new Error(`Automation run "${automationRunId}" not found.`)
  }
  return run
}

export function haltedOutcome(
  ctx: CoordinatedPassContext,
  run: AutomationRun
): CoordinatedRunOutcome {
  assertCoordinatorActive(ctx)
  const halt = ctx.ledger.progress.halt!
  // Failure is final; blocked and uncertain stay non-final holds that never read as complete.
  const settled =
    halt.state === 'failed'
      ? run.status === 'dispatch_failed'
        ? run
        : ctx.store.recordCoordinatedRunSettlement({
            automationRunId: run.id,
            status: 'dispatch_failed',
            error: halt.reason
          })
      : ctx.store.recordCoordinatedRunHold({
          automationRunId: run.id,
          state: halt.state,
          reason: halt.reason
        })
  return { state: halt.state, reason: halt.reason, run: settled, progress: ctx.ledger.progress }
}

/** Every mapped native attempt must carry an authenticated terminal settlement and live host scope. */
export function nativeSettlementHolds(ctx: CoordinatedPassContext, run: AutomationRun): string[] {
  return (run.childMappings ?? []).flatMap((mapping) => {
    if (
      !mapping.dispatchId ||
      !isCoordinatedNativeAttempt(ctx.orchestrationDb, mapping.dispatchId)
    ) {
      return []
    }
    const problem = nativeAttemptSemanticAdmissionProblem(
      ctx.store,
      ctx.orchestrationDb,
      run,
      mapping.dispatchId
    )
    return problem ? [`Attempt ${mapping.dispatchId}: ${problem}`] : []
  })
}

/**
 * A failed projection is final, so it must never outrun a native attempt whose settlement is still
 * uncertain. When holds exist, the truthful state is outcome_uncertain; once every native attempt
 * is durably settled, a valid failed halt proceeds unchanged.
 */
export function haltedOrNativeUncertain(
  ctx: CoordinatedPassContext,
  automationRunId: string
): CoordinatedRunOutcome {
  const run = requireRun(ctx, automationRunId)
  if (ctx.ledger.progress.halt?.state !== 'failed') {
    return haltedOutcome(ctx, run)
  }
  const holds = nativeSettlementHolds(ctx, run)
  if (holds.length === 0) {
    return haltedOutcome(ctx, run)
  }
  const reason = holds.join(' ')
  const held = ctx.store.recordCoordinatedRunHold({
    automationRunId,
    state: 'outcome_uncertain',
    reason
  })
  return { state: 'outcome_uncertain', reason, run: held, progress: ctx.ledger.progress }
}
