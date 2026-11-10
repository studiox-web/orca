import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type {
  CoordinatedAdmittedReport,
  CoordinatedReportDisposition
} from '../../shared/coordinated-automation-progress-types'
import type { CoordinatedProgressLedger } from './coordinated-automation-progress-ledger'
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
  ledger: CoordinatedProgressLedger,
  input: { automationRunId: string; taskId: string; dispatchId: string; report: unknown }
): CoordinatedReportSubmission {
  const run = ctx.store.listAutomationRuns().find((r) => r.id === input.automationRunId)
  const mapping = (run?.childMappings ?? []).find((m) => m.taskId === input.taskId)
  const reportDigest = structuredReportDigest(input.report)
  // Fence first: a replaced generation must not settle natively or append audit records.
  ledger.refresh()
  if (!run || !mapping) {
    appendAudit(ledger, ctx, {
      childDefinitionId: 'foreign',
      taskId: input.taskId,
      dispatchId: input.dispatchId,
      reportDigest,
      disposition: 'stale',
      reason: `Task "${input.taskId}" is not mapped in coordinated run "${input.automationRunId}".`
    })
    return { disposition: 'stale', reportDigest, reason: 'Foreign Task.' }
  }
  const parsed = StructuredWorkerResultSchema.safeParse(input.report)
  const settlement = ctx.orchestrationDb.settleWorkerReport({
    taskId: input.taskId,
    dispatchId: input.dispatchId,
    outcome: parsed.success && parsed.data.outcome === 'succeeded' ? 'succeeded' : 'failed',
    result: encodeCoordinatedWorkerReport(input.report)
  })
  const prior = ledger.progress.reports.find(
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
  appendAudit(ledger, ctx, {
    childDefinitionId: mapping.childDefinitionId,
    taskId: input.taskId,
    dispatchId: input.dispatchId,
    reportDigest,
    disposition,
    reason
  })
  return { disposition, reportDigest, reason }
}

function appendAudit(
  ledger: CoordinatedProgressLedger,
  ctx: CoordinatedRecoveryContext,
  record: Omit<CoordinatedAdmittedReport, 'admittedAt'>
): void {
  const now = ctx.clock.now()
  ledger.update(`audit:${record.disposition}`, (progress) =>
    progress.reports.some(
      (r) =>
        r.dispatchId === record.dispatchId &&
        r.reportDigest === record.reportDigest &&
        r.disposition === record.disposition
    )
      ? progress
      : { ...progress, reports: [...progress.reports, { ...record, admittedAt: now }] }
  )
}
