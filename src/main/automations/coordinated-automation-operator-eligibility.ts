import { currentStageGateCandidate, gateRecords } from './coordinated-automation-gate-identity'
import type {
  CoordinatedGateResolutionEligibility,
  CoordinatedPendingDecision,
  CoordinatedRetryEligibility
} from '../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import {
  isOpenAttempt,
  lastAttemptDispatchId,
  stageAttemptBudget
} from './coordinated-automation-attempt-lineage'

/** The authenticated local operator; never a `worker:<child>` author identity, so never self-approval. */
export const LOCAL_OPERATOR_IDENTITY = 'local_operator'

export function stageRetryEligibility(input: {
  progress: CoordinatedRunProgress
  child: ResolvedChildSnapshot
  runSettled: boolean
}): CoordinatedRetryEligibility {
  const { progress, child } = input
  const stage = progress.stages[child.childDefinitionId]
  if (input.runSettled) {
    return { canRetry: false, reason: 'The run is already settled.', retryOfDispatchId: null }
  }
  if (progress.operatorStop) {
    return {
      canRetry: false,
      reason: 'The run is stopping; a retry could fork unknown side effects.',
      retryOfDispatchId: null
    }
  }
  if (progress.halt) {
    return {
      canRetry: false,
      reason: `The run is halted (${progress.halt.state}): ${progress.halt.reason}`,
      retryOfDispatchId: null
    }
  }
  if (!child.enabled || !stage) {
    return {
      canRetry: false,
      reason: 'This stage has no recorded attempts.',
      retryOfDispatchId: null
    }
  }
  if (stage.status === 'accepted') {
    return { canRetry: false, reason: 'This stage is already accepted.', retryOfDispatchId: null }
  }
  const open = stage.lineage.find(isOpenAttempt)
  if (open) {
    return {
      canRetry: false,
      reason: `Attempt ${open.dispatchId ?? open.attemptNumber} is still open.`,
      retryOfDispatchId: null
    }
  }
  const retryOfDispatchId = lastAttemptDispatchId(stage)
  if (retryOfDispatchId === null) {
    return {
      canRetry: false,
      reason: 'This stage has no attempt to retry.',
      retryOfDispatchId: null
    }
  }
  const budget = stageAttemptBudget(child, stage)
  if (stage.attempts >= budget) {
    return {
      canRetry: false,
      reason: `Attempt budget exhausted (${stage.attempts}/${budget}).`,
      retryOfDispatchId
    }
  }
  return { canRetry: true, reason: null, retryOfDispatchId }
}

export function stageGateResolutionEligibility(input: {
  taskId?: string
  progress: CoordinatedRunProgress
  child: ResolvedChildSnapshot
  runSettled: boolean
}): CoordinatedGateResolutionEligibility {
  const { progress, child } = input
  if (input.runSettled) {
    return {
      canResolve: false,
      reason: 'The run is already settled.',
      pendingGateId: null,
      pendingGateIds: [],
      approvableDispatchId: null
    }
  }
  const pendingGateIds = [
    ...(child.stageAcceptance?.requiredApprovals ?? [])
      .filter(
        (requirement) =>
          requirement.required !== false &&
          gatePending(progress, requirement.id, 'stage', child.childDefinitionId, input.taskId)
      )
      .map((requirement) => requirement.id),
    ...progress.escalations
      .filter(
        (entry) =>
          entry.childDefinitionId === child.childDefinitionId && escalationPending(progress, entry)
      )
      .map((entry) => entry.key)
  ]
  // Only a held report can be approved; an attempt that has not reported offers no evidence.
  const approvableDispatchId =
    progress.stages[child.childDefinitionId]?.pendingApproval?.dispatchId ?? null
  const stageCandidate = currentStageGateCandidate(progress, child.childDefinitionId)
  return pendingGateIds.length > 0 && stageCandidate !== null
    ? {
        stageCandidate,
        canResolve: true,
        reason: null,
        pendingGateId: pendingGateIds[0],
        pendingGateIds,
        approvableDispatchId
      }
    : {
        canResolve: false,
        stageCandidate,
        reason: 'No unambiguous pending gate awaits a decision for this stage.',
        pendingGateId: null,
        pendingGateIds,
        approvableDispatchId
      }
}

/** A requirement is pending in one scope until that scope records an approval or a rejection. */
export function gatePending(
  progress: CoordinatedRunProgress,
  gateId: string,
  scope: 'stage' | 'parent',
  childDefinitionId?: string,
  taskId?: string
): boolean {
  const { approval, rejection } = gateRecords(progress, gateId, scope, childDefinitionId, taskId)
  return !approval && !rejection
}

/** Pending operator decisions with the scope each is bound to: parent, stage, then escalations. */
export function pendingHumanDecisions(
  progress: CoordinatedRunProgress,
  snapshot: ResolvedAutomationRunSnapshot,
  taskIds: ReadonlyMap<string, string> = new Map()
): CoordinatedPendingDecision[] {
  const pending: CoordinatedPendingDecision[] = []
  for (const requirement of snapshot.outcomeContract.requiredApprovals) {
    if (gatePending(progress, requirement.id, 'parent')) {
      pending.push({ gateId: requirement.id, scope: 'parent', childDefinitionId: null })
    }
  }
  for (const child of snapshot.resolvedChildren) {
    for (const requirement of child.stageAcceptance?.requiredApprovals ?? []) {
      if (
        requirement.required !== false &&
        gatePending(
          progress,
          requirement.id,
          'stage',
          child.childDefinitionId,
          taskIds.get(child.childDefinitionId)
        )
      ) {
        pending.push({
          gateId: requirement.id,
          scope: 'stage',
          childDefinitionId: child.childDefinitionId
        })
      }
    }
  }
  for (const escalation of progress.escalations) {
    if (escalationPending(progress, escalation)) {
      pending.push({
        gateId: escalation.key,
        scope: 'escalation',
        childDefinitionId: escalation.childDefinitionId
      })
    }
  }
  return pending
}

/** A human-decision escalation stays pending until the operator records a decision for its key. */
function escalationPending(
  progress: CoordinatedRunProgress,
  escalation: CoordinatedRunProgress['escalations'][number]
): boolean {
  return (
    escalation.requiresHumanDecision &&
    !(progress.operatorDecisions ?? []).some(
      (decision) =>
        decision.kind === 'gate_resolution' &&
        decision.gateId === escalation.key &&
        decision.gateScope === 'escalation'
    )
  )
}
