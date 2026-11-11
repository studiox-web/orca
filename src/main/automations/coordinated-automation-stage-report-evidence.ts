import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type {
  Availability,
  CoordinatedStagePendingApprovalView,
  CoordinatedStageReportEvidence
} from '../../shared/coordinated-automation-run-inspection'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'

type ReportContent = Pick<
  CoordinatedStageReportEvidence,
  'outcome' | 'summary' | 'artifacts' | 'checks' | 'blockers'
>

/** Report content, only while the Task still holds exactly the named attempt's named bytes. */
function readReportContent(
  db: OrchestrationDb,
  taskId: string,
  dispatchId: string,
  reportDigest: string,
  invalidDetail: string
): Availability<ReportContent> {
  if (db.getDispatchContext(taskId)?.id !== dispatchId) {
    return {
      kind: 'unavailable',
      reason: `Report of attempt ${dispatchId} is no longer this Task's latest native result.`
    }
  }
  const decoded = decodeWorkerReportResult(db.getTask(taskId)?.result)
  if (decoded.kind !== 'structured' || structuredReportDigest(decoded.report) !== reportDigest) {
    return {
      kind: 'unavailable',
      reason: `The stored result no longer matches digest ${reportDigest}.`
    }
  }
  const parsed = StructuredWorkerResultSchema.safeParse(decoded.report)
  if (!parsed.success) {
    return { kind: 'unavailable', reason: invalidDetail }
  }
  const report = parsed.data
  return {
    kind: 'available',
    outcome: report.outcome,
    summary: report.summary,
    artifacts: report.artifacts.map((artifact) => ({
      kind: artifact.kind,
      uri: artifact.uri,
      sha256: artifact.sha256 ?? null
    })),
    checks: report.checks,
    blockers: report.blockers
  }
}

/** A held report as the approver must see it: the exact attempt, bytes and gates it waits on. */
export function stagePendingApproval(
  db: OrchestrationDb,
  progress: CoordinatedRunProgress,
  childDefinitionId: string,
  taskId: string | null
): CoordinatedStagePendingApprovalView | undefined {
  const held = progress.stages[childDefinitionId]?.pendingApproval
  if (!held || !taskId) {
    return undefined
  }
  return {
    dispatchId: held.dispatchId,
    reportDigest: held.reportDigest,
    gateIds: held.gateIds,
    since: held.since,
    report: readReportContent(
      db,
      taskId,
      held.dispatchId,
      held.reportDigest,
      'The held report is not a readable structured result.'
    )
  }
}

/**
 * The latest report the coordinator admitted for one stage, shown only while the native Task
 * still holds exactly those bytes for exactly that attempt. A superseded attempt or a result
 * that no longer digest-matches is unavailable rather than re-described.
 */
export function stageReportEvidence(
  db: OrchestrationDb,
  progress: CoordinatedRunProgress,
  childDefinitionId: string,
  taskId: string | null
): Availability<CoordinatedStageReportEvidence> {
  const admitted = progress.reports.findLast(
    (report) => report.childDefinitionId === childDefinitionId
  )
  if (!admitted || !taskId) {
    return { kind: 'absent', reason: 'No report has been admitted for this stage.' }
  }
  const content =
    admitted.taskId === taskId
      ? readReportContent(
          db,
          taskId,
          admitted.dispatchId,
          admitted.reportDigest,
          `The ${admitted.disposition} report is not a readable structured result: ${admitted.reason ?? 'schema invalid'}`
        )
      : ({
          kind: 'unavailable',
          reason: `Report of attempt ${admitted.dispatchId} belongs to another Task.`
        } as const)
  return content.kind === 'available'
    ? {
        ...content,
        dispatchId: admitted.dispatchId,
        reportDigest: admitted.reportDigest,
        disposition: admitted.disposition,
        dispositionReason: admitted.reason
      }
    : content
}
