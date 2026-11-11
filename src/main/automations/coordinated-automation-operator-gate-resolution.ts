import {
  resolveOperatorGateScope,
  type CoordinatedOperatorGateInput
} from './coordinated-automation-operator-gate-scope'
export type { CoordinatedOperatorGateInput } from './coordinated-automation-operator-gate-scope'
import { sameStageGateCandidate } from '../../shared/coordinated-automation-gate-candidate'
import {
  currentStageGateCandidate,
  decisionStageCandidate
} from './coordinated-automation-gate-identity'
import { haltExpiredRun } from './coordinated-automation-wall-clock'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'
import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import { withAttemptStatus } from './coordinated-automation-attempt-lineage'
import { assertHeldReportApprovable } from './coordinated-automation-attempt-validation'
import type { CoordinatedOperatorActionDisposition } from '../../shared/coordinated-automation-run-inspection'
import { LOCAL_OPERATOR_IDENTITY } from './coordinated-automation-operator-eligibility'
import {
  assertOperatorScope,
  recordedOperatorProgress,
  requireOperatorLedger
} from './coordinated-automation-operator-actions'
import {
  progressIdentityProblem,
  withHalt,
  withOperatorDecision,
  withRunApproval,
  withStage
} from './coordinated-automation-progress-ledger'
import {
  assertCoordinatorActive,
  type CoordinatedRecoveryContext
} from './coordinated-automation-recovery-context'

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
  if (recorded) {
    const problem = progressIdentityProblem(recorded, {
      automationRunId: run.id,
      orchestrationRunId: run.orchestrationRunId!,
      snapshot
    })
    if (problem) {
      throw new Error(problem)
    }
  }
  const { stageReq, parentReq, escalation, scope, mapping, held, candidate } =
    resolveOperatorGateScope(ctx, run, input, recorded)
  const decisions = recorded?.operatorDecisions ?? []
  if (
    decisions.some(
      (entry) =>
        entry.kind === 'gate_resolution' && entry.gateId === input.gateId && !entry.gateScope
    )
  ) {
    throw new Error(
      `Gate "${input.gateId}" has an ambiguous legacy decision; it cannot authorize another mutation.`
    )
  }
  const matching = decisions.filter(
    (entry) =>
      entry.kind === 'gate_resolution' &&
      entry.gateId === input.gateId &&
      entry.gateScope === scope &&
      (scope !== 'stage' ||
        (entry.childDefinitionId === input.childDefinitionId &&
          (!entry.taskId || entry.taskId === input.taskId) &&
          sameStageGateCandidate(decisionStageCandidate(entry), candidate)))
  )
  if (matching.some((entry) => entry.decision === input.decision)) {
    return 'already_recorded'
  }
  const terminal = matching.find((entry) => entry.decision !== 'escalate' || scope === 'escalation')
  if (terminal) {
    throw new Error(
      `Gate "${input.gateId}" has already been resolved as "${String(terminal.decision)}".`
    )
  }
  if (stageReq) {
    const current = recorded
      ? currentStageGateCandidate(recorded, stageReq.child.childDefinitionId)
      : { kind: 'no_attempt' as const }
    if (!sameStageGateCandidate(candidate, current)) {
      throw new Error(
        `The candidate awaiting a decision for gate "${input.gateId}" changed; inspect it again before deciding.`
      )
    }
    const latest = ctx.orchestrationDb.getDispatchContext(mapping!.taskId)
    if (
      (candidate!.kind === 'no_attempt' && latest) ||
      (candidate!.kind !== 'no_attempt' && latest?.id !== candidate!.dispatchId)
    ) {
      throw new Error(`Gate "${input.gateId}" no longer binds the named attempt.`)
    }
    const decoded = decodeWorkerReportResult(ctx.orchestrationDb.getTask(mapping!.taskId)?.result)
    if (candidate!.kind === 'attempt' && decoded.kind === 'structured') {
      throw new Error('The named attempt now has a report; inspect its report before deciding.')
    }
    if (
      candidate!.kind === 'report' &&
      decoded.kind === 'structured' &&
      structuredReportDigest(decoded.report) !== candidate!.reportDigest
    ) {
      throw new Error('The held report bytes changed; inspect it again before deciding.')
    }
  }
  const ledger = requireOperatorLedger(ctx, run)
  haltExpiredRun({ ...ctx, ledger }, snapshot)
  if ((stageReq || parentReq) && (ledger.progress.halt || ledger.progress.operatorStop)) {
    const halt = ledger.progress.halt
    if (halt && halt.state !== 'failed') {
      ctx.store.recordCoordinatedRunHold({
        automationRunId: run.id,
        state: halt.state,
        reason: halt.reason
      })
    }
    throw new Error('The run is halted or stopping; a gate decision cannot resume it.')
  }
  if (stageReq && input.decision === 'approve') {
    if (candidate?.kind !== 'report') {
      throw new Error('Approval requires an exact held report.')
    }
    assertHeldReportApprovable(ctx, {
      run,
      snapshot,
      child: stageReq.child,
      taskId: mapping?.taskId,
      held,
      gateId: input.gateId
    })
  }
  const now = ctx.clock.now()
  const detail = input.note ?? `${input.decision} for gate "${input.gateId}".`
  ledger.update(`operator-gate:${input.decision}`, (current) => {
    let next = withOperatorDecision(current, {
      kind: 'gate_resolution',
      at: now,
      actor: LOCAL_OPERATOR_IDENTITY,
      childDefinitionId: input.childDefinitionId ?? escalation?.childDefinitionId ?? null,
      dispatchId: candidate && candidate.kind !== 'no_attempt' ? candidate.dispatchId : null,
      ...(candidate ? { stageCandidate: candidate, taskId: input.taskId } : {}),
      ...(candidate?.kind === 'report' ? { reportDigest: candidate.reportDigest } : {}),
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
              dispatchId: held?.dispatchId,
              reportDigest: held?.reportDigest
            }
          : { targetChildId: parentReq?.targetChildId })
      })
    } else if (input.decision === 'reject') {
      next =
        stageReq && held
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
