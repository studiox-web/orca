import type { AutomationRun } from '../../shared/automations-types'
import type {
  CoordinatedGateScope,
  CoordinatedOperatorActionDisposition
} from '../../shared/coordinated-automation-run-inspection'
import {
  LOCAL_OPERATOR_IDENTITY,
  stageBoundDispatchId
} from './coordinated-automation-operator-eligibility'
import {
  assertOperatorScope,
  recordedOperatorProgress,
  requireOperatorLedger,
  type CoordinatedOperatorScopeInput
} from './coordinated-automation-operator-actions'
import {
  withHalt,
  withOperatorDecision,
  withRunApproval,
  withStage
} from './coordinated-automation-progress-ledger'
import {
  assertCoordinatorActive,
  type CoordinatedRecoveryContext
} from './coordinated-automation-recovery-context'

export type CoordinatedOperatorGateInput = CoordinatedOperatorScopeInput & {
  gateId: string
  gateScope?: CoordinatedGateScope
  decision: 'approve' | 'reject' | 'escalate'
  note?: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
}

/**
 * Binds one operator decision to the exact gate: a stage approval requirement, a parent outcome
 * approval requirement, or a human-decision escalation. Approvals are recorded durably and read
 * by acceptance validation; rejections close the gate against the run/stage.
 */
export function operatorResolveGate(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun,
  input: CoordinatedOperatorGateInput
): CoordinatedOperatorActionDisposition {
  assertOperatorScope(run, input)
  assertCoordinatorActive(ctx)
  const snapshot = run.resolvedSnapshot!
  const recorded = recordedOperatorProgress(ctx, run)
  const wants = (scope: CoordinatedGateScope): boolean =>
    input.gateScope === undefined || input.gateScope === scope
  const stageReq = wants('stage')
    ? snapshot.resolvedChildren
        .flatMap((child) =>
          (child.stageAcceptance?.requiredApprovals ?? []).map((requirement) => ({
            child,
            requirement
          }))
        )
        .find((entry) => entry.requirement.id === input.gateId)
    : undefined
  // Stage-first when the caller names no scope, matching how pending decisions are listed.
  const parentReq =
    !stageReq && wants('parent')
      ? snapshot.outcomeContract.requiredApprovals.find(
          (requirement) => requirement.id === input.gateId
        )
      : undefined
  const escalation =
    !stageReq && !parentReq && wants('escalation')
      ? recorded?.escalations.find(
          (entry) => entry.key === input.gateId && entry.requiresHumanDecision
        )
      : undefined
  const scope: CoordinatedGateScope | null = stageReq
    ? 'stage'
    : parentReq
      ? 'parent'
      : escalation
        ? 'escalation'
        : null
  if (!scope) {
    throw new Error(
      `Gate "${input.gateId}" is not a pending approval requirement or human-decision escalation of this run.`
    )
  }
  const boundDispatch = stageReq
    ? stageBoundDispatchId(recorded?.stages[stageReq.child.childDefinitionId])
    : null
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
    if (input.dispatchId && boundDispatch && input.dispatchId !== boundDispatch) {
      throw new Error(
        `Gate "${input.gateId}" binds Dispatch "${boundDispatch}", not "${input.dispatchId}".`
      )
    }
    // An approval is evidence about one exact attempt; with none there is nothing to approve.
    if (input.decision === 'approve' && !boundDispatch) {
      throw new Error(
        `Stage "${stageReq.child.childDefinitionId}" has no attempt to approve yet; an approval must bind an exact Dispatch.`
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

  const earlier = (recorded?.operatorDecisions ?? []).find(
    (decision) =>
      decision.kind === 'gate_resolution' &&
      decision.gateId === input.gateId &&
      (decision.gateScope ?? scope) === scope &&
      // A stage decision speaks for one attempt; a later attempt needs its own decision.
      (scope !== 'stage' || decision.dispatchId === null || decision.dispatchId === boundDispatch)
  )
  if (earlier) {
    if (earlier.decision === input.decision) {
      return 'already_recorded'
    }
    throw new Error(
      `Gate "${input.gateId}" has already been resolved as "${String(earlier.decision)}".`
    )
  }
  const ledger = requireOperatorLedger(ctx, run)
  const now = ctx.clock.now()
  const detail = input.note ?? `${input.decision} for gate "${input.gateId}".`
  ledger.update(`operator-gate:${input.decision}`, (current) => {
    let next = withOperatorDecision(current, {
      kind: 'gate_resolution',
      at: now,
      actor: LOCAL_OPERATOR_IDENTITY,
      childDefinitionId: input.childDefinitionId ?? escalation?.childDefinitionId ?? null,
      dispatchId: boundDispatch ?? input.dispatchId ?? null,
      gateId: input.gateId,
      gateScope: scope,
      decision: input.decision,
      detail
    })
    // Acknowledging an escalation records the decision only; it is never an approval record.
    if (input.decision === 'approve' && (stageReq || parentReq)) {
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
              dispatchId: boundDispatch ?? undefined
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
  return 'recorded'
}
