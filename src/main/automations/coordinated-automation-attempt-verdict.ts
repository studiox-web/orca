import type { AutomationRun } from '../../shared/automations-types'
import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { validateAttemptReport } from './coordinated-automation-attempt-validation'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'
import { upstreamFindingFingerprint } from './coordinated-automation-review-loop'
import {
  COORDINATED_START_FAILURE_PREFIX,
  COORDINATED_TIMEOUT_PREFIX
} from './coordinated-automation-attempt-prefixes'

function boundReport(
  report: unknown,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot,
  child: ResolvedChildSnapshot,
  taskId: string,
  dispatchId: string
): StructuredWorkerResult | null {
  const parsed = StructuredWorkerResultSchema.safeParse(report)
  if (!parsed.success) {
    return null
  }
  const data = parsed.data
  return data.automationRunId === run.id &&
    data.orchestrationRunId === run.orchestrationRunId &&
    data.childDefinitionId === child.childDefinitionId &&
    data.taskId === taskId &&
    data.dispatchId === dispatchId &&
    data.definitionRevision === snapshot.definitionRevision &&
    data.resolvedConfigDigest === snapshot.canonicalDigest
    ? data
    : null
}

export type AttemptVerdict =
  | { kind: 'accepted'; digest: string; report: StructuredWorkerResult }
  | { kind: 'awaiting_approval'; digest: string; gateIds: string[] }
  | { kind: 'revision'; digest: string; fingerprint: string; reason: string }
  | { kind: 'halt'; digest: string; state: 'blocked' | 'outcome_uncertain'; reason: string }
  | {
      kind: 'rejected'
      digest: string
      reason: string
      startFailure: boolean
      timedOut?: boolean
    }

export function classifyAttempt(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot,
  child: ResolvedChildSnapshot,
  taskId: string,
  dispatchId: string,
  nativeSucceeded: boolean
): AttemptVerdict {
  const decoded = decodeWorkerReportResult(ctx.orchestrationDb.getTask(taskId)?.result)
  if (decoded.kind !== 'structured') {
    const reason = decoded.kind === 'unsupported' ? decoded.reason : decoded.readable
    return {
      kind: 'rejected',
      digest: structuredReportDigest({ dispatchId, readable: decoded.readable }),
      reason: reason || `Attempt ${dispatchId} produced no structured report.`,
      startFailure: decoded.readable.startsWith(COORDINATED_START_FAILURE_PREFIX),
      timedOut: decoded.readable.startsWith(COORDINATED_TIMEOUT_PREFIX)
    }
  }
  const digest = structuredReportDigest(decoded.report)
  const bound = boundReport(decoded.report, run, snapshot, child, taskId, dispatchId)
  if (bound?.outcome === 'blocked' || bound?.outcome === 'uncertain') {
    return {
      kind: 'halt',
      digest,
      state: bound.outcome === 'blocked' ? 'blocked' : 'outcome_uncertain',
      reason: `Stage "${child.childDefinitionId}" reported ${bound.outcome}: ${bound.summary}`
    }
  }
  const fingerprint = bound ? upstreamFindingFingerprint(bound) : null
  if (bound?.outcome === 'failed' && fingerprint && child.dependencies.length > 0) {
    return { kind: 'revision', digest, fingerprint, reason: bound.summary }
  }
  const validation = validateAttemptReport(ctx, {
    report: decoded.report,
    run,
    snapshot,
    child,
    taskId,
    dispatchId
  })
  if (!validation.valid && validation.awaitingApproval && nativeSucceeded) {
    return { kind: 'awaiting_approval', digest, gateIds: validation.awaitingApproval.gateIds }
  }
  if (!validation.valid) {
    return { kind: 'rejected', digest, reason: validation.error, startFailure: false }
  }
  if (validation.report.outcome !== 'succeeded' || !nativeSucceeded) {
    return {
      kind: 'rejected',
      digest,
      reason: `Attempt ${dispatchId} reported ${validation.report.outcome}: ${validation.report.summary}`,
      startFailure: false
    }
  }
  return { kind: 'accepted', digest, report: validation.report }
}
