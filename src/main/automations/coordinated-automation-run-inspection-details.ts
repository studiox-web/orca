import type { AutomationRun } from '../../shared/automations-types'
import type {
  CoordinatedApprovalObservation,
  CoordinatedGateResolutionEligibility,
  CoordinatedRetryEligibility,
  CoordinatedRunHumanResolution,
  CoordinatedStageSessionTarget
} from '../../shared/coordinated-automation-run-inspection'
import type {
  CoordinatedRunProgress,
  CoordinatedStageProgress
} from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Availability } from '../../shared/coordinated-automation-run-inspection'
import {
  isCoordinatedNativeAttempt,
  nativeAttemptBindingProblem
} from './coordinated-automation-native-attempt'
import { nativeDispatchLineageProblem } from './coordinated-automation-native-validation'
import {
  pendingHumanDecisionKeys,
  stageGateResolutionEligibility,
  stageRetryEligibility
} from './coordinated-automation-operator-eligibility'

const NO_NATIVE_SESSION =
  'The fake_no_effects provider runs in-process; there is no chat or terminal session to open.'
const TERMINAL_WORKER_STATES = ['succeeded', 'failed', 'stopped', 'abandoned']

/**
 * Host-qualified runtime-minted destination for one stage. Only a proven-current native attempt
 * with live host-owned terminal custody mints a target; anything historical or unprovable is
 * unavailable with the exact reason.
 */
export function stageSessionTarget(
  db: OrchestrationDb,
  run: AutomationRun,
  child: ResolvedChildSnapshot,
  taskId: string | null,
  mappedDispatchId: string | null
): CoordinatedStageSessionTarget {
  if (!taskId || !mappedDispatchId || !isCoordinatedNativeAttempt(db, mappedDispatchId)) {
    return { kind: 'unavailable', reason: NO_NATIVE_SESSION }
  }
  const worker = db.getWorkerDispatch(mappedDispatchId)
  if (!worker || TERMINAL_WORKER_STATES.includes(worker.state) || worker.state === 'stopping') {
    return {
      kind: 'unavailable',
      reason: `Attempt ${mappedDispatchId} is ${worker?.state ?? 'missing'}; historical targets are never minted.`
    }
  }
  const problem = nativeAttemptBindingProblem(db, run, mappedDispatchId)
  if (problem) {
    return { kind: 'unavailable', reason: problem }
  }
  const resource = db.getWorkerTerminalResourceByOwner(mappedDispatchId)
  if (!resource || resource.ownership_state !== 'owned' || !resource.terminal_handle) {
    return { kind: 'unavailable', reason: 'This attempt has no live host-owned terminal custody.' }
  }
  return {
    kind: 'terminal',
    handle: resource.terminal_handle,
    paneKey: resource.pane_key ?? '',
    dispatchId: mappedDispatchId,
    taskId,
    childDefinitionId: child.childDefinitionId
  }
}

/** Requirement/approval/decision join for the operator gate view, per scope. */
export function approvalObservations(input: {
  run: AutomationRun
  snapshot: ResolvedAutomationRunSnapshot
  progress: CoordinatedRunProgress | null
}): { stage: CoordinatedApprovalObservation[]; parent: CoordinatedApprovalObservation[] } {
  const { run, snapshot, progress } = input
  const stage: CoordinatedApprovalObservation[] = []
  const parent: CoordinatedApprovalObservation[] = []
  if (!progress) {
    return { stage, parent }
  }
  for (const requirement of snapshot.outcomeContract.requiredApprovals) {
    parent.push(parentObservation(run, progress, requirement))
  }
  for (const child of snapshot.resolvedChildren) {
    for (const requirement of child.stageAcceptance?.requiredApprovals ?? []) {
      stage.push(stageObservation(run, child, progress, requirement))
    }
  }
  return { stage, parent }
}

type RequirementLike = {
  id: string
  role: string
  description?: string
  disallowAuthorApproval?: boolean
}

type ApprovalStatusProjection = Pick<
  CoordinatedApprovalObservation,
  'status' | 'approverIdentity' | 'authorIdentity' | 'approvedAt' | 'evidence' | 'rejectionReason'
>

function projectApprovalStatus(
  progress: CoordinatedRunProgress,
  requirement: RequirementLike,
  scope: 'stage' | 'parent'
): ApprovalStatusProjection {
  const approval = (progress.approvals ?? []).find(
    (entry) => entry.scope === scope && entry.approvalId === requirement.id
  )
  const rejection = (progress.operatorDecisions ?? []).find(
    (entry) =>
      entry.kind === 'gate_resolution' &&
      entry.gateId === requirement.id &&
      entry.decision === 'reject'
  )
  return {
    status: approval ? 'approved' : rejection ? 'rejected' : 'pending',
    ...(approval?.approverIdentity !== undefined
      ? { approverIdentity: approval.approverIdentity }
      : {}),
    ...(approval?.authorIdentity !== undefined ? { authorIdentity: approval.authorIdentity } : {}),
    ...(approval?.approvedAt !== undefined ? { approvedAt: approval.approvedAt } : {}),
    ...(approval?.evidence !== undefined ? { evidence: approval.evidence } : {}),
    ...(rejection ? { rejectionReason: rejection.detail } : {})
  }
}

function requirementFields(requirement: RequirementLike) {
  return {
    approvalId: requirement.id,
    role: requirement.role,
    ...(requirement.description !== undefined ? { description: requirement.description } : {}),
    ...(requirement.disallowAuthorApproval !== undefined
      ? { disallowAuthorApproval: requirement.disallowAuthorApproval }
      : {})
  }
}

function parentObservation(
  run: AutomationRun,
  progress: CoordinatedRunProgress,
  requirement: RequirementLike
): CoordinatedApprovalObservation {
  return {
    ...requirementFields(requirement),
    ...projectApprovalStatus(progress, requirement, 'parent'),
    scope: { automationRunId: run.id, orchestrationRunId: run.orchestrationRunId ?? null }
  }
}

function stageObservation(
  run: AutomationRun,
  child: ResolvedChildSnapshot,
  progress: CoordinatedRunProgress,
  requirement: RequirementLike
): CoordinatedApprovalObservation {
  const mapping = run.childMappings?.find((m) => m.childDefinitionId === child.childDefinitionId)
  const stage = progress.stages[child.childDefinitionId]
  return {
    ...requirementFields(requirement),
    ...projectApprovalStatus(progress, requirement, 'stage'),
    scope: {
      automationRunId: run.id,
      orchestrationRunId: run.orchestrationRunId ?? null,
      childDefinitionId: child.childDefinitionId,
      ...(mapping?.taskId ? { taskId: mapping.taskId } : {}),
      ...(stage?.acceptedDispatchId ? { dispatchId: stage.acceptedDispatchId } : {})
    }
  }
}

export function runHumanResolution(input: {
  snapshot: ResolvedAutomationRunSnapshot
  progress: CoordinatedRunProgress | null
}): CoordinatedRunHumanResolution {
  const keys = input.progress ? pendingHumanDecisionKeys(input.progress, input.snapshot) : []
  return keys.length > 0
    ? { available: true, reason: null, pendingDecisionKeys: keys }
    : { available: false, reason: 'No pending human decisions.', pendingDecisionKeys: [] }
}

/** Both operator eligibility projections for one stage, or the exact read failure reason. */
export function stageOperatorEligibility(input: {
  progress: Availability<{ progress: CoordinatedRunProgress }>
  child: ResolvedChildSnapshot
  runSettled: boolean
}): { retry: CoordinatedRetryEligibility; gate: CoordinatedGateResolutionEligibility } {
  if (input.progress.kind !== 'available') {
    return {
      retry: { canRetry: false, reason: input.progress.reason, retryOfDispatchId: null },
      gate: { canResolve: false, reason: input.progress.reason, pendingGateId: null }
    }
  }
  const progress = input.progress.progress
  return {
    retry: stageRetryEligibility({ progress, child: input.child, runSettled: input.runSettled }),
    gate: stageGateResolutionEligibility({
      progress,
      child: input.child,
      runSettled: input.runSettled
    })
  }
}

/** Every Dispatch the stage names must be a native attempt of exactly this run's mapped Task. */
export function stageEvidenceProblem(
  db: OrchestrationDb,
  orchestrationRunId: string,
  taskId: string | null,
  id: string,
  stage: CoordinatedStageProgress,
  progress: CoordinatedRunProgress
): string | null {
  if (!taskId) {
    return `Stage ${id} has progress but no mapped Task.`
  }
  const task = db.getTask(taskId)
  if (!task || task.run_id !== orchestrationRunId) {
    return `Task ${taskId} is not in orchestration Run ${orchestrationRunId}.`
  }
  const named = [
    stage.activeDispatchId,
    stage.acceptedDispatchId,
    ...stage.lineage.map((r) => r.dispatchId)
  ]
  for (const dispatchId of named) {
    const problem =
      dispatchId === null
        ? null
        : nativeDispatchLineageProblem(db, db.getDispatchContextById(dispatchId), {
            dispatchId,
            taskId,
            orchestrationRunId
          })
    if (problem) {
      return problem
    }
  }
  if (stage.status !== 'accepted') {
    return null
  }
  if (!stage.acceptedDispatchId || !stage.acceptedReportDigest) {
    return `Accepted stage ${id} has no accepted Dispatch or report digest.`
  }
  const admitted = progress.reports.find(
    (r) => r.dispatchId === stage.acceptedDispatchId && r.disposition === 'accepted'
  )
  if (
    !admitted ||
    admitted.childDefinitionId !== id ||
    admitted.taskId !== taskId ||
    admitted.reportDigest !== stage.acceptedReportDigest
  ) {
    return `Accepted Dispatch ${stage.acceptedDispatchId} has no matching admitted report for stage ${id}.`
  }
  return null
}
