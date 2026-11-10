import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { CoordinatedReportDisposition } from '../../shared/coordinated-automation-progress-types'
import type { CoordinatedRecoveryContext } from './coordinated-automation-recovery-context'
import {
  encodeCoordinatedWorkerReport,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'

export type CoordinatedReportSubmission = Readonly<{
  /** `settled` waits for the next reconcile to decide acceptance. */
  disposition: 'settled' | Exclude<CoordinatedReportDisposition, 'accepted' | 'rejected'>
  reportDigest: string
  reason: string | null
}>

/**
 * Delivers a report through the native worker-report settlement. Stale and conflicting
 * deliveries stay auditable in the progress ledger but can never satisfy a stage.
 */
export function submitCoordinatedWorkerReport(
  ctx: CoordinatedRecoveryContext,
  input: { automationRunId: string; taskId: string; dispatchId: string; report: unknown }
): CoordinatedReportSubmission {
  const run = ctx.store.listAutomationRuns().find((r) => r.id === input.automationRunId)
  const mapping = (run?.childMappings ?? []).find((m) => m.taskId === input.taskId)
  if (!run || !mapping) {
    throw new Error(
      `Task "${input.taskId}" is not mapped in coordinated run "${input.automationRunId}".`
    )
  }
  const reportDigest = structuredReportDigest(input.report)
  const parsed = StructuredWorkerResultSchema.safeParse(input.report)
  const settlement = ctx.orchestrationDb.settleWorkerReport({
    taskId: input.taskId,
    dispatchId: input.dispatchId,
    outcome: parsed.success && parsed.data.outcome === 'succeeded' ? 'succeeded' : 'failed',
    result: encodeCoordinatedWorkerReport(input.report)
  })
  const progress = ctx.progressStore.read(input.automationRunId)
  const prior = progress?.reports.find(
    (r) =>
      r.dispatchId === input.dispatchId &&
      (r.disposition === 'accepted' || r.disposition === 'rejected')
  )
  if (settlement.action === 'settled' && !settlement.duplicate) {
    return { disposition: 'settled', reportDigest, reason: null }
  }
  if (prior?.reportDigest === reportDigest || (settlement.action === 'settled' && !prior)) {
    return { disposition: 'duplicate', reportDigest, reason: 'Already delivered.' }
  }
  const disposition = prior ? 'duplicate' : 'stale'
  const reason =
    settlement.action === 'rejected'
      ? settlement.reason
      : `Dispatch ${input.dispatchId} was already admitted with report ${prior?.reportDigest ?? 'unknown'}.`
  if (
    progress &&
    !progress.reports.some(
      (r) => r.dispatchId === input.dispatchId && r.reportDigest === reportDigest
    )
  ) {
    ctx.progressStore.write(
      {
        ...progress,
        sequence: progress.sequence + 1,
        reports: [
          ...progress.reports,
          {
            childDefinitionId: mapping.childDefinitionId,
            taskId: input.taskId,
            dispatchId: input.dispatchId,
            reportDigest,
            disposition,
            reason,
            admittedAt: ctx.clock.now()
          }
        ]
      },
      progress.sequence
    )
  }
  return { disposition, reportDigest, reason }
}
