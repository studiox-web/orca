import type { AutomationRun } from '../../shared/automations-types'
import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { ResolvedAutomationRunSnapshot } from '../../shared/coordinated-automation-types'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'

export type AcceptedStageReports =
  | { valid: true; reports: StructuredWorkerResult[] }
  | { valid: false; childDefinitionId: string; error: string }

/**
 * The exact reports each stage was accepted on, re-read from native Task results. A Task
 * whose latest attempt or report bytes differ from the accepted identity cannot be used.
 */
export function acceptedStageReports(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): AcceptedStageReports {
  const reports: StructuredWorkerResult[] = []
  for (const child of snapshot.resolvedChildren) {
    if (!child.enabled) {
      continue
    }
    const id = child.childDefinitionId
    const stage = ctx.ledger.progress.stages[id]
    const taskId = (run.childMappings ?? []).find((m) => m.childDefinitionId === id)?.taskId
    const latest = taskId ? ctx.orchestrationDb.getDispatchContext(taskId) : undefined
    if (!stage || !taskId || !latest || latest.id !== stage.acceptedDispatchId) {
      return {
        valid: false,
        childDefinitionId: id,
        error: `Stage "${id}" accepted attempt ${stage?.acceptedDispatchId ?? 'none'} is no longer its latest native attempt.`
      }
    }
    const decoded = decodeWorkerReportResult(ctx.orchestrationDb.getTask(taskId)?.result)
    const parsed =
      decoded.kind === 'structured' ? StructuredWorkerResultSchema.safeParse(decoded.report) : null
    if (
      !parsed?.success ||
      decoded.kind !== 'structured' ||
      structuredReportDigest(decoded.report) !== stage.acceptedReportDigest
    ) {
      return {
        valid: false,
        childDefinitionId: id,
        error: `Stage "${id}" report no longer matches accepted digest ${stage.acceptedReportDigest ?? 'none'}.`
      }
    }
    reports.push(parsed.data)
  }
  return { valid: true, reports }
}
