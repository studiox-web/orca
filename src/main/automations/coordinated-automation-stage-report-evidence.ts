import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type {
  Availability,
  CoordinatedStageReportEvidence
} from '../../shared/coordinated-automation-run-inspection'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'

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
  if (admitted.taskId !== taskId || db.getDispatchContext(taskId)?.id !== admitted.dispatchId) {
    return {
      kind: 'unavailable',
      reason: `Report of attempt ${admitted.dispatchId} is no longer this Task's latest native result.`
    }
  }
  const decoded = decodeWorkerReportResult(db.getTask(taskId)?.result)
  if (
    decoded.kind !== 'structured' ||
    structuredReportDigest(decoded.report) !== admitted.reportDigest
  ) {
    return {
      kind: 'unavailable',
      reason: `The stored result no longer matches admitted digest ${admitted.reportDigest}.`
    }
  }
  const parsed = StructuredWorkerResultSchema.safeParse(decoded.report)
  if (!parsed.success) {
    return {
      kind: 'unavailable',
      reason: `The ${admitted.disposition} report is not a readable structured result: ${admitted.reason ?? 'schema invalid'}`
    }
  }
  const report = parsed.data
  return {
    kind: 'available',
    dispatchId: admitted.dispatchId,
    reportDigest: admitted.reportDigest,
    disposition: admitted.disposition,
    dispositionReason: admitted.reason,
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
