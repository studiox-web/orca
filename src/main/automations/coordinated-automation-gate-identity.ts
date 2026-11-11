import {
  sameStageGateCandidate,
  type CoordinatedStageGateCandidate
} from '../../shared/coordinated-automation-gate-candidate'
import type {
  CoordinatedOperatorDecision,
  CoordinatedRunProgress
} from '../../shared/coordinated-automation-progress-types'

export function currentStageGateCandidate(
  progress: CoordinatedRunProgress,
  childDefinitionId: string
): CoordinatedStageGateCandidate | null {
  const stage = progress.stages[childDefinitionId]
  if (!stage) {
    return null
  }
  if (stage.pendingApproval) {
    return {
      kind: 'report',
      dispatchId: stage.pendingApproval.dispatchId,
      reportDigest: stage.pendingApproval.reportDigest
    }
  }
  if (stage.lineage.some((attempt) => attempt.status === 'starting' && !attempt.dispatchId)) {
    return null
  }
  const dispatchId =
    stage.lineage.findLast((attempt) => attempt.dispatchId !== null)?.dispatchId ??
    stage.activeDispatchId ??
    stage.acceptedDispatchId
  if (!dispatchId) {
    return stage.lineage.length === 0 ? { kind: 'no_attempt' } : null
  }
  const report = progress.reports.findLast(
    (entry) =>
      entry.childDefinitionId === childDefinitionId &&
      entry.dispatchId === dispatchId &&
      (entry.disposition === 'accepted' || entry.disposition === 'rejected')
  )
  return report
    ? { kind: 'report', dispatchId, reportDigest: report.reportDigest }
    : { kind: 'attempt', dispatchId }
}

export function decisionStageCandidate(
  decision: CoordinatedOperatorDecision
): CoordinatedStageGateCandidate | null {
  if (decision.stageCandidate) {
    const candidate = decision.stageCandidate
    const dispatchId = candidate.kind === 'no_attempt' ? null : candidate.dispatchId
    const reportDigest = candidate.kind === 'report' ? candidate.reportDigest : undefined
    return decision.dispatchId === dispatchId && decision.reportDigest === reportDigest
      ? candidate
      : null
  }
  return decision.dispatchId && decision.reportDigest
    ? { kind: 'report', dispatchId: decision.dispatchId, reportDigest: decision.reportDigest }
    : null
}

/** Historical records without enough scope stay inert; no current candidate is inferred. */
export function gateRecords(
  progress: CoordinatedRunProgress,
  gateId: string,
  scope: 'stage' | 'parent',
  childDefinitionId?: string,
  taskId?: string
) {
  const candidate = childDefinitionId
    ? currentStageGateCandidate(progress, childDefinitionId)
    : null
  const approval = (progress.approvals ?? []).find(
    (entry) =>
      entry.scope === scope &&
      entry.approvalId === gateId &&
      entry.automationId === progress.automationId &&
      entry.automationRunId === progress.automationRunId &&
      entry.definitionRevision === progress.definitionRevision &&
      entry.orchestrationRunId === progress.orchestrationRunId &&
      (scope === 'parent'
        ? !entry.childDefinitionId && !entry.taskId && !entry.dispatchId && !entry.reportDigest
        : entry.childDefinitionId === childDefinitionId &&
          !!entry.taskId &&
          (!taskId || entry.taskId === taskId) &&
          !!entry.dispatchId &&
          !!entry.reportDigest &&
          sameStageGateCandidate(candidate, {
            kind: 'report',
            dispatchId: entry.dispatchId,
            reportDigest: entry.reportDigest
          }))
  )
  const rejection = (progress.operatorDecisions ?? []).find(
    (entry) =>
      entry.kind === 'gate_resolution' &&
      entry.gateScope === scope &&
      entry.gateId === gateId &&
      entry.decision === 'reject' &&
      (scope === 'parent'
        ? entry.childDefinitionId === null && entry.dispatchId === null && !entry.stageCandidate
        : entry.childDefinitionId === childDefinitionId &&
          (!taskId || entry.taskId === taskId) &&
          sameStageGateCandidate(candidate, decisionStageCandidate(entry)))
  )
  return { approval, rejection }
}
