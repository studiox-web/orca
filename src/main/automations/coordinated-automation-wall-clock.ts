import type { ResolvedAutomationRunSnapshot } from '../../shared/coordinated-automation-types'
import { withEscalation, withHalt } from './coordinated-automation-progress-ledger'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'

/** Persist the frozen deadline before any semantic decision, admission, effect or completion. */
export function haltExpiredRun(
  ctx: CoordinatedPassContext,
  snapshot: ResolvedAutomationRunSnapshot
): boolean {
  const progress = ctx.ledger.progress
  const limit = snapshot.globalCeilings.maxWallClockSeconds
  const now = ctx.clock.now()
  if (
    limit === undefined ||
    progress.escalations.some((entry) => entry.code === 'wall_clock_ceiling') ||
    progress.operatorStop ||
    now - progress.startedAt < limit * 1000
  ) {
    return false
  }
  const held = Object.entries(progress.stages).find(([, stage]) => stage.pendingApproval)
  const detail = held
    ? `Stage "${held[0]}" attempt ${held[1].pendingApproval!.dispatchId} still awaited approval when the run's ${limit}s wall-clock budget ran out; its report was neither accepted nor rejected.`
    : `Run used ${Math.floor((now - progress.startedAt) / 1000)}s of its ${limit}s wall-clock budget.`
  ctx.ledger.update('halt:wall_clock_ceiling', (current) =>
    withHalt(
      withEscalation(current, {
        key: 'wall_clock_ceiling',
        code: 'wall_clock_ceiling',
        childDefinitionId: held?.[0] ?? null,
        detail,
        requiresHumanDecision: true,
        at: now
      }),
      { state: 'blocked', reason: detail, at: now }
    )
  )
  return true
}
