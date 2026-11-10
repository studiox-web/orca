import type {
  CoordinatedGateResolutionEligibility,
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
  progress: CoordinatedRunProgress
  child: ResolvedChildSnapshot
  runSettled: boolean
}): CoordinatedGateResolutionEligibility {
  const { progress, child } = input
  if (input.runSettled) {
    return { canResolve: false, reason: 'The run is already settled.', pendingGateId: null }
  }
  for (const requirement of child.stageAcceptance?.requiredApprovals ?? []) {
    if (requirement.required === false) {
      continue
    }
    if (gatePending(progress, requirement.id)) {
      return { canResolve: true, reason: null, pendingGateId: requirement.id }
    }
  }
  const escalation = progress.escalations.find(
    (entry) => entry.requiresHumanDecision && entry.childDefinitionId === child.childDefinitionId
  )
  if (escalation) {
    return { canResolve: true, reason: null, pendingGateId: escalation.key }
  }
  return {
    canResolve: false,
    reason: 'No pending gate awaits a decision for this stage.',
    pendingGateId: null
  }
}

function gatePending(progress: CoordinatedRunProgress, gateId: string): boolean {
  const approved = (progress.approvals ?? []).some(
    (approval) => approval.scope === 'stage' && approval.approvalId === gateId
  )
  const rejected = (progress.operatorDecisions ?? []).some(
    (decision) =>
      decision.kind === 'gate_resolution' &&
      decision.gateId === gateId &&
      decision.decision === 'reject'
  )
  return !approved && !rejected
}

/** Escalation keys and unmet approval requirement ids awaiting an operator decision. */
export function pendingHumanDecisionKeys(
  progress: CoordinatedRunProgress,
  snapshot: ResolvedAutomationRunSnapshot
): string[] {
  const keys: string[] = []
  for (const requirement of snapshot.outcomeContract.requiredApprovals) {
    const approved = (progress.approvals ?? []).some(
      (approval) => approval.scope === 'parent' && approval.approvalId === requirement.id
    )
    const rejected = (progress.operatorDecisions ?? []).some(
      (decision) =>
        decision.kind === 'gate_resolution' &&
        decision.decision === 'reject' &&
        decision.gateId === requirement.id
    )
    if (!approved && !rejected) {
      keys.push(requirement.id)
    }
  }
  for (const child of snapshot.resolvedChildren) {
    for (const requirement of child.stageAcceptance?.requiredApprovals ?? []) {
      if (requirement.required !== false && gatePending(progress, requirement.id)) {
        keys.push(requirement.id)
      }
    }
  }
  for (const escalation of progress.escalations) {
    if (escalation.requiresHumanDecision) {
      keys.push(escalation.key)
    }
  }
  return keys
}
