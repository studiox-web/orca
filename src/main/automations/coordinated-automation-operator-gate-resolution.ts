import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import { withAttemptStatus } from './coordinated-automation-attempt-lineage'
import { assertHeldReportApprovable } from './coordinated-automation-attempt-validation'
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
  /** Digest of the held report the caller was shown; required for a stage approval. */
  expectedReportDigest?: string
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
  const held = stageReq
    ? (recorded?.stages[stageReq.child.childDefinitionId]?.pendingApproval ?? null)
    : null
  const boundDispatch = stageReq
    ? (held?.dispatchId ?? stageBoundDispatchId(recorded?.stages[stageReq.child.childDefinitionId]))
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
    // Fail closed: an approval must name the exact evidence the approver was shown.
    if (input.decision === 'approve' && (!input.dispatchId || !input.expectedReportDigest)) {
      throw new Error(
        `Approving stage gate "${input.gateId}" must name the exact Dispatch and report digest being approved.`
      )
    }
  } else if (parentReq) {
    if (input.childDefinitionId || input.taskId || input.dispatchId || input.expectedReportDigest) {
      throw new Error(
        `Gate "${input.gateId}" is parent-scoped and must not name stage scope fields.`
      )
    }
  } else if (input.childDefinitionId && input.childDefinitionId !== escalation!.childDefinitionId) {
    throw new Error(
      `Escalation "${input.gateId}" belongs to stage "${String(escalation!.childDefinitionId)}", not "${input.childDefinitionId}".`
    )
  }

  // What this decision speaks for: the candidate the caller saw, else what the host holds.
  const candidateDispatch = stageReq ? (input.dispatchId ?? boundDispatch) : null
  const candidateDigest = stageReq
    ? (input.expectedReportDigest ?? held?.reportDigest ?? null)
    : null
  const earlier = (recorded?.operatorDecisions ?? []).find(
    (decision) =>
      decision.kind === 'gate_resolution' &&
      decision.gateId === input.gateId &&
      (decision.gateScope ?? scope) === scope &&
      // A replay is the same decision about the same candidate, never a newer report's approval.
      (scope !== 'stage' ||
        (decision.dispatchId === candidateDispatch &&
          (decision.reportDigest ?? null) === candidateDigest))
  )
  if (earlier) {
    if (earlier.decision === input.decision) {
      return 'already_recorded'
    }
    throw new Error(
      `Gate "${input.gateId}" has already been resolved as "${String(earlier.decision)}".`
    )
  }
  if (stageReq) {
    if (input.dispatchId && input.dispatchId !== boundDispatch) {
      throw new Error(
        `Gate "${input.gateId}" binds Dispatch "${String(boundDispatch)}", not "${input.dispatchId}".`
      )
    }
    if (input.expectedReportDigest && input.expectedReportDigest !== held?.reportDigest) {
      throw new Error(
        `The report awaiting approval for gate "${input.gateId}" is ${held?.reportDigest ?? 'no longer held'}, not ${input.expectedReportDigest}; inspect it again before deciding.`
      )
    }
    if (input.decision === 'approve') {
      if (recorded?.halt) {
        throw new Error(`The run is halted (${recorded.halt.state}); an approval cannot resume it.`)
      }
      // The held bytes and every artifact they name are re-verified at the moment of decision.
      assertHeldReportApprovable(ctx, {
        run,
        snapshot,
        child: stageReq.child,
        taskId: mapping?.taskId,
        held,
        gateId: input.gateId
      })
    }
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
      dispatchId: candidateDispatch ?? input.dispatchId ?? null,
      ...(candidateDigest ? { reportDigest: candidateDigest } : {}),
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
              dispatchId: boundDispatch ?? undefined,
              reportDigest: held?.reportDigest
            }
          : { targetChildId: parentReq?.targetChildId })
      })
    } else if (input.decision === 'reject') {
      next = stageReq
        ? rejectStageAtGate(
            next,
            stageReq.child.childDefinitionId,
            mapping?.taskId,
            `Gate "${input.gateId}" rejected by operator: ${detail}`,
            now
          )
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

/** A rejected held report is admitted as rejected, so the attempt closes and the budget counts it. */
function rejectStageAtGate(
  progress: CoordinatedRunProgress,
  childDefinitionId: string,
  taskId: string | undefined,
  reason: string,
  now: number
): CoordinatedRunProgress {
  const held = progress.stages[childDefinitionId]?.pendingApproval
  const closed =
    held && taskId
      ? {
          ...withAttemptStatus(
            progress,
            childDefinitionId,
            (r) => r.dispatchId === held.dispatchId,
            {
              status: 'admitted'
            }
          ),
          reports: [
            ...progress.reports,
            {
              childDefinitionId,
              taskId,
              dispatchId: held.dispatchId,
              reportDigest: held.reportDigest,
              disposition: 'rejected' as const,
              reason,
              admittedAt: now
            }
          ]
        }
      : progress
  return withStage(closed, childDefinitionId, (stage) => ({
    ...stage,
    status: 'rejected',
    pendingApproval: null,
    ...(held ? { activeDispatchId: held.dispatchId, attempts: stage.attempts + 1 } : {}),
    lastError: reason
  }))
}
