import type { AutomationRun } from '../../shared/automations-types'
import type { ResolvedAutomationRunSnapshot } from '../../shared/coordinated-automation-types'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'

/**
 * Keeps native Task state from claiming more than durable acceptance proves. A natively
 * completed attempt that semantic admission rejected becomes `failed`, a reopened stage goes
 * back to `pending`, and a dependent promoted only by native completion is demoted.
 */
export function syncNativeReadiness(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): void {
  const stages = ctx.ledger.progress.stages
  for (const child of snapshot.resolvedChildren) {
    const id = child.childDefinitionId
    const stage = stages[id]
    const taskId = (run.childMappings ?? []).find((m) => m.childDefinitionId === id)?.taskId
    if (!child.enabled || !stage || !taskId || ctx.inFlightTaskIds.has(taskId)) {
      continue
    }
    const task = ctx.orchestrationDb.getTask(taskId)
    const latest = ctx.orchestrationDb.getDispatchContext(taskId)
    if (
      !task ||
      stage.status === 'accepted' ||
      latest?.status === 'pending' ||
      latest?.status === 'dispatched' ||
      // A held report is a true native completion awaiting a person; dependents stay gated below
      // by semantic acceptance, so the settled Task is neither reopened nor failed.
      (latest !== undefined && stage.pendingApproval?.dispatchId === latest.id)
    ) {
      continue
    }
    const dependenciesAccepted = child.dependencies.every(
      (dep) => stages[dep.childId]?.status === 'accepted'
    )
    if (task.status === 'completed') {
      const terminal = stage.status === 'rejected' || stage.status === 'invalidated'
      ctx.ledger.refresh()
      ctx.orchestrationDb.updateTaskStatus(taskId, terminal ? 'failed' : 'pending')
    } else if (task.status === 'ready' && !dependenciesAccepted) {
      ctx.ledger.refresh()
      ctx.orchestrationDb.updateTaskStatus(taskId, 'pending')
    }
  }
}

/** Accepted stages, readable without claiming a coordinator generation. */
export function acceptedStageIds(
  progress: { stages: Record<string, { status: string }> } | null
): Set<string> {
  return new Set(
    Object.entries(progress?.stages ?? {})
      .filter(([, stage]) => stage.status === 'accepted')
      .map(([id]) => id)
  )
}
