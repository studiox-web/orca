import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { CoordinatedOperatorActionDisposition } from '../../shared/coordinated-automation-run-inspection'
import {
  stageRetryEligibility,
  LOCAL_OPERATOR_IDENTITY
} from './coordinated-automation-operator-eligibility'
import {
  CoordinatedProgressLedger,
  withOperatorDecision,
  withOperatorStop
} from './coordinated-automation-progress-ledger'
import {
  assertCoordinatorActive,
  type CoordinatedRecoveryContext
} from './coordinated-automation-recovery-context'

export { LOCAL_OPERATOR_IDENTITY } from './coordinated-automation-operator-eligibility'

export function runIsOperatorSettled(run: AutomationRun): boolean {
  return run.completionReceipt !== undefined && run.completionReceipt !== null
    ? true
    : isFinalAutomationRunStatus(run.status)
}

export function requireOperatorLedger(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun
): CoordinatedProgressLedger {
  assertCoordinatorActive(ctx)
  if (
    run.materializationPhase !== 'ready_for_dispatch' ||
    !run.resolvedSnapshot ||
    !run.orchestrationRunId
  ) {
    throw new Error(`Run "${run.id}" is not ready for operator actions.`)
  }
  if (runIsOperatorSettled(run)) {
    throw new Error('The run is already settled; operator actions cannot change its outcome.')
  }
  return CoordinatedProgressLedger.claim({
    store: ctx.progressStore,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    snapshot: run.resolvedSnapshot,
    now: ctx.clock.now(),
    boundary: ctx.boundary,
    isActive: ctx.isActive
  })
}

export function assertOperatorScope(
  run: AutomationRun,
  input: CoordinatedOperatorScopeInput
): void {
  const snapshot = run.resolvedSnapshot
  if (input.orchestrationRunId !== run.orchestrationRunId) {
    throw new Error(
      `The named orchestration Run ${String(input.orchestrationRunId)} is not this run's (${String(run.orchestrationRunId)}).`
    )
  }
  if (!snapshot) {
    throw new Error(`Run "${run.id}" has no frozen snapshot to validate operator scope against.`)
  }
  if (input.definitionRevision !== snapshot.definitionRevision) {
    throw new Error(
      `Definition revision ${input.definitionRevision} does not name this run's frozen revision ${snapshot.definitionRevision}.`
    )
  }
  const authority = `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`
  if (input.targetExecutionAuthority !== authority) {
    throw new Error(
      `Target execution authority ${input.targetExecutionAuthority} does not match this run's frozen authority ${authority}.`
    )
  }
}

/** Decisions already durable for exactly this run; read without claiming a generation. */
export function recordedOperatorProgress(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun
): CoordinatedRunProgress | null {
  const progress = ctx.progressStore.read(run.id)
  return progress &&
    progress.automationRunId === run.id &&
    progress.orchestrationRunId === run.orchestrationRunId
    ? progress
    : null
}

export type CoordinatedOperatorScopeInput = {
  orchestrationRunId: string | null
  definitionRevision: number
  targetExecutionAuthority: string
}

/**
 * Durable operator stop. Replays after the marker is recorded acknowledge without re-issuing
 * native stop requests; the reconcile that follows drives each Dispatch to proven exit.
 */
export function operatorStopRun(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun,
  input: CoordinatedOperatorScopeInput & { note?: string }
): CoordinatedOperatorActionDisposition {
  assertOperatorScope(run, input)
  assertCoordinatorActive(ctx)
  // A replay is acknowledged even after the stop already settled the run.
  if (recordedOperatorProgress(ctx, run)?.operatorStop) {
    return 'already_recorded'
  }
  const ledger = requireOperatorLedger(ctx, run)
  const now = ctx.clock.now()
  ledger.update('operator-stop', (progress) =>
    withOperatorDecision(withOperatorStop(progress, { at: now, reason: input.note ?? null }), {
      kind: 'stop',
      at: now,
      actor: LOCAL_OPERATOR_IDENTITY,
      childDefinitionId: null,
      dispatchId: null,
      gateId: null,
      decision: null,
      detail: input.note ?? 'Operator stop requested.'
    })
  )
  ctx.boundary('operator.after-decision', { automationRunId: run.id })
  return 'recorded'
}

/**
 * Admits one exact retry within the existing bounded attempt policy. The named Dispatch must be
 * the stage's latest attempt and already terminal, so a retry never replays in-flight work.
 */
export function operatorRetryStage(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun,
  input: CoordinatedOperatorScopeInput & {
    childDefinitionId: string
    taskId: string
    retryOfDispatchId: string
  }
): CoordinatedOperatorActionDisposition {
  assertOperatorScope(run, input)
  assertCoordinatorActive(ctx)
  const requested = (recordedOperatorProgress(ctx, run)?.operatorDecisions ?? []).some(
    (decision) =>
      decision.kind === 'retry' &&
      decision.childDefinitionId === input.childDefinitionId &&
      decision.dispatchId === input.retryOfDispatchId
  )
  const replayMapping = run.childMappings?.find(
    (entry) => entry.childDefinitionId === input.childDefinitionId
  )
  // The same exact retry already took effect; a lost acknowledgement never retries twice.
  if (requested && replayMapping?.taskId === input.taskId) {
    return 'already_recorded'
  }
  const ledger = requireOperatorLedger(ctx, run)
  const snapshot = run.resolvedSnapshot!
  const child = snapshot.resolvedChildren.find(
    (entry) => entry.childDefinitionId === input.childDefinitionId
  )
  if (!child?.enabled || !ledger.progress.stages[input.childDefinitionId]) {
    throw new Error(`Stage "${input.childDefinitionId}" is not an enabled child of this run.`)
  }
  const mapping = run.childMappings?.find(
    (entry) => entry.childDefinitionId === input.childDefinitionId
  )
  if (mapping?.taskId !== input.taskId) {
    throw new Error(
      `Task "${input.taskId}" does not match the mapped Task for stage "${input.childDefinitionId}".`
    )
  }
  const eligibility = stageRetryEligibility({ progress: ledger.progress, child, runSettled: false })
  if (!eligibility.canRetry) {
    throw new Error(eligibility.reason ?? 'This stage cannot be retried.')
  }
  if (eligibility.retryOfDispatchId !== input.retryOfDispatchId) {
    throw new Error(
      `Retry must name the latest attempt "${eligibility.retryOfDispatchId}", not "${input.retryOfDispatchId}".`
    )
  }
  const dispatch = ctx.orchestrationDb.getDispatchContextById(input.retryOfDispatchId)
  if (!dispatch) {
    throw new Error(`Named attempt Dispatch ${input.retryOfDispatchId} was not found.`)
  }
  if (dispatch.status === 'pending' || dispatch.status === 'dispatched') {
    throw new Error(
      `Named attempt ${input.retryOfDispatchId} is still in flight; stop it before retrying.`
    )
  }
  const now = ctx.clock.now()
  ledger.update('operator-retry', (progress) =>
    withOperatorDecision(progress, {
      kind: 'retry',
      at: now,
      actor: LOCAL_OPERATOR_IDENTITY,
      childDefinitionId: input.childDefinitionId,
      dispatchId: input.retryOfDispatchId,
      gateId: null,
      decision: null,
      detail: `Operator retry of attempt ${input.retryOfDispatchId}.`
    })
  )
  ctx.boundary('operator.after-decision', {
    automationRunId: run.id,
    childDefinitionId: input.childDefinitionId
  })
  return 'recorded'
}
