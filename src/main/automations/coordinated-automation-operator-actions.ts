import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import {
  stageRetryEligibility,
  LOCAL_OPERATOR_IDENTITY
} from './coordinated-automation-operator-eligibility'
import {
  CoordinatedProgressLedger,
  withHalt,
  withOperatorDecision,
  withOperatorStop,
  withRunApproval,
  withStage
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

function requireOperatorLedger(
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

function assertOperatorScope(
  progress: CoordinatedRunProgress,
  run: AutomationRun,
  input: CoordinatedOperatorScopeInput
): void {
  if (input.orchestrationRunId !== run.orchestrationRunId) {
    throw new Error(
      `The named orchestration Run ${String(input.orchestrationRunId)} is not this run's (${String(run.orchestrationRunId)}).`
    )
  }
  if (input.definitionRevision !== progress.definitionRevision) {
    throw new Error(
      `Definition revision ${input.definitionRevision} does not name this run's frozen revision ${progress.definitionRevision}.`
    )
  }
  if (input.targetExecutionAuthority !== progress.executionAuthority) {
    throw new Error(
      `Target execution authority ${input.targetExecutionAuthority} does not match this run's frozen authority ${progress.executionAuthority}.`
    )
  }
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
): 'requested' | 'already_recorded' {
  const ledger = requireOperatorLedger(ctx, run)
  assertOperatorScope(ledger.progress, run, input)
  if (ledger.progress.operatorStop) {
    return 'already_recorded'
  }
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
  return 'requested'
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
): void {
  const ledger = requireOperatorLedger(ctx, run)
  assertOperatorScope(ledger.progress, run, input)
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
}

/**
 * Binds one operator decision to the exact gate: a stage approval requirement, a parent outcome
 * approval requirement, or a human-decision escalation. Approvals are recorded durably and read
 * by acceptance validation; rejections close the gate against the run/stage.
 */
export function operatorResolveGate(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun,
  input: CoordinatedOperatorScopeInput & {
    gateId: string
    decision: 'approve' | 'reject' | 'escalate'
    note?: string
    childDefinitionId?: string
    taskId?: string
    dispatchId?: string
  }
): void {
  const ledger = requireOperatorLedger(ctx, run)
  assertOperatorScope(ledger.progress, run, input)
  const snapshot = run.resolvedSnapshot!
  const progress = ledger.progress
  const stageReq = snapshot.resolvedChildren
    .flatMap((child) =>
      (child.stageAcceptance?.requiredApprovals ?? []).map((requirement) => ({
        child,
        requirement
      }))
    )
    .find((entry) => entry.requirement.id === input.gateId)
  const parentReq = snapshot.outcomeContract.requiredApprovals.find(
    (requirement) => requirement.id === input.gateId
  )
  const escalation = progress.escalations.find(
    (entry) => entry.key === input.gateId && entry.requiresHumanDecision
  )
  if (!stageReq && !parentReq && !escalation) {
    throw new Error(
      `Gate "${input.gateId}" is not a pending approval requirement or human-decision escalation of this run.`
    )
  }
  const mapping = stageReq
    ? run.childMappings?.find(
        (entry) => entry.childDefinitionId === stageReq.child.childDefinitionId
      )
    : undefined
  if (stageReq) {
    if (input.childDefinitionId !== stageReq.child.childDefinitionId) {
      throw new Error(
        `Gate "${input.gateId}" belongs to stage "${stageReq.child.childDefinitionId}", not "${String(input.childDefinitionId)}".`
      )
    }
    if (input.taskId && input.taskId !== mapping?.taskId) {
      throw new Error(`Gate "${input.gateId}" does not belong to Task "${input.taskId}".`)
    }
    const stage = progress.stages[stageReq.child.childDefinitionId]
    const boundDispatch = stage?.acceptedDispatchId ?? stage?.activeDispatchId
    if (input.dispatchId && boundDispatch && input.dispatchId !== boundDispatch) {
      throw new Error(
        `Gate "${input.gateId}" binds Dispatch "${boundDispatch}", not "${input.dispatchId}".`
      )
    }
  } else if (parentReq) {
    if (input.childDefinitionId || input.taskId || input.dispatchId) {
      throw new Error(
        `Gate "${input.gateId}" is parent-scoped and must not name stage scope fields.`
      )
    }
  } else if (input.childDefinitionId && input.childDefinitionId !== escalation!.childDefinitionId) {
    throw new Error(
      `Escalation "${input.gateId}" belongs to stage "${String(escalation!.childDefinitionId)}", not "${input.childDefinitionId}".`
    )
  }

  const now = ctx.clock.now()
  const detail = input.note ?? `${input.decision} for gate "${input.gateId}".`
  ledger.update(`operator-gate:${input.decision}`, (current) => {
    let next = withOperatorDecision(current, {
      kind: 'gate_resolution',
      at: now,
      actor: LOCAL_OPERATOR_IDENTITY,
      childDefinitionId: input.childDefinitionId ?? escalation?.childDefinitionId ?? null,
      dispatchId: input.dispatchId ?? null,
      gateId: input.gateId,
      decision: input.decision,
      detail
    })
    if (input.decision === 'approve') {
      const stage = stageReq ? next.stages[stageReq.child.childDefinitionId] : undefined
      next = withRunApproval(next, {
        scope: stageReq ? 'stage' : 'parent',
        approvalId: input.gateId,
        role: stageReq?.requirement.role ?? parentReq?.role ?? 'operator',
        approverIdentity: LOCAL_OPERATOR_IDENTITY,
        approvedAt: now,
        evidence: input.note,
        automationId: run.automationId,
        definitionRevision: snapshot.definitionRevision,
        automationRunId: run.id,
        orchestrationRunId: run.orchestrationRunId!,
        ...(stageReq
          ? {
              childDefinitionId: stageReq.child.childDefinitionId,
              taskId: mapping?.taskId,
              dispatchId:
                input.dispatchId ??
                stage?.activeDispatchId ??
                stage?.acceptedDispatchId ??
                undefined
            }
          : { targetChildId: parentReq?.targetChildId })
      })
    } else if (input.decision === 'reject') {
      next = stageReq
        ? withStage(next, stageReq.child.childDefinitionId, (stage) => ({
            ...stage,
            status: 'rejected',
            lastError: `Gate "${input.gateId}" rejected by operator: ${detail}`
          }))
        : withHalt(next, {
            state: 'failed',
            reason: `Gate "${input.gateId}" rejected by operator: ${detail}`,
            at: now
          })
    }
    return next
  })
  ctx.boundary('operator.after-decision', { automationRunId: run.id })
}
