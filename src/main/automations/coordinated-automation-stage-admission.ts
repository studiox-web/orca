import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
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
import {
  applyReviewFindings,
  upstreamFindingFingerprint
} from './coordinated-automation-review-loop'
import { withEscalation, withHalt, withStage } from './coordinated-automation-progress-ledger'

/** Readable prefix the coordinator writes when a worker never started. */
export const COORDINATED_START_FAILURE_PREFIX = 'Coordinated worker start failed:'

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

type AttemptVerdict =
  | { kind: 'accepted'; digest: string; report: StructuredWorkerResult }
  | { kind: 'revision'; digest: string; fingerprint: string; reason: string }
  | { kind: 'halt'; digest: string; state: 'blocked' | 'outcome_uncertain'; reason: string }
  | { kind: 'rejected'; digest: string; reason: string; startFailure: boolean }

function classifyAttempt(
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
      startFailure: decoded.readable.startsWith(COORDINATED_START_FAILURE_PREFIX)
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

function applyVerdict(
  progress: CoordinatedRunProgress,
  input: {
    snapshot: ResolvedAutomationRunSnapshot
    child: ResolvedChildSnapshot
    taskId: string
    dispatchId: string
    verdict: AttemptVerdict
    costUsd: number
    now: number
  }
): CoordinatedRunProgress {
  const { child, dispatchId, verdict, now } = input
  const id = child.childDefinitionId
  let next: CoordinatedRunProgress = {
    ...progress,
    spentCostUsd: progress.spentCostUsd + input.costUsd,
    dispatchStartFailures:
      progress.dispatchStartFailures +
      (verdict.kind === 'rejected' && verdict.startFailure ? 1 : 0),
    reports: [
      ...progress.reports,
      {
        childDefinitionId: id,
        taskId: input.taskId,
        dispatchId,
        reportDigest: verdict.digest,
        disposition: verdict.kind === 'accepted' ? 'accepted' : 'rejected',
        reason: verdict.kind === 'accepted' ? null : verdict.reason,
        admittedAt: now
      }
    ]
  }
  if (verdict.kind === 'revision') {
    return applyReviewFindings(
      next,
      input.snapshot,
      child,
      verdict.fingerprint,
      verdict.reason,
      now
    )
  }
  next = withStage(next, id, (stage) => ({
    ...stage,
    status: verdict.kind === 'accepted' ? 'accepted' : 'rejected',
    activeDispatchId: dispatchId,
    attempts: stage.attempts + 1,
    lastError: verdict.kind === 'accepted' ? null : verdict.reason,
    ...(verdict.kind === 'accepted'
      ? {
          acceptedDispatchId: dispatchId,
          acceptedReportDigest: verdict.digest,
          acceptedArtifacts: verdict.report.artifacts.flatMap((artifact) =>
            artifact.sha256 ? [{ uri: artifact.uri, sha256: artifact.sha256 }] : []
          )
        }
      : {})
  }))
  if (verdict.kind === 'halt') {
    next = withEscalation(next, {
      key: `stage_rejected:${id}:${dispatchId}`,
      code: 'stage_rejected',
      childDefinitionId: id,
      detail: verdict.reason,
      requiresHumanDecision: true,
      at: now
    })
    next = withHalt(next, { state: verdict.state, reason: verdict.reason, at: now })
  }
  return next
}

/** Audit-only stale or duplicate deliveries never count as the attempt's admission. */
export function isAdmitted(progress: CoordinatedRunProgress, dispatchId: string): boolean {
  return progress.reports.some(
    (r) =>
      r.dispatchId === dispatchId && (r.disposition === 'accepted' || r.disposition === 'rejected')
  )
}

/** Settles orphaned attempts and admits every settled, not-yet-admitted latest attempt once. */
export function admitSettledAttempts(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): boolean {
  const before = ctx.ledger.progress.sequence
  for (const mapping of run.childMappings ?? []) {
    const child = snapshot.resolvedChildren.find(
      (c) => c.childDefinitionId === mapping.childDefinitionId
    )
    if (!child?.enabled || ctx.inFlightTaskIds.has(mapping.taskId)) {
      continue
    }
    let latest = ctx.orchestrationDb.getDispatchContext(mapping.taskId)
    if (!latest || isAdmitted(ctx.ledger.progress, latest.id)) {
      continue
    }
    if (latest.status === 'pending' || latest.status === 'dispatched') {
      ctx.orchestrationDb.settleWorkerReport({
        taskId: mapping.taskId,
        dispatchId: latest.id,
        outcome: 'failed',
        result: `Attempt ${latest.id} has no report after coordinator generation ${ctx.ledger.generation} took over; it is unverified.`
      })
      latest = ctx.orchestrationDb.getDispatchContextById(latest.id)!
      if (latest.status === 'pending' || latest.status === 'dispatched') {
        continue
      }
    }
    const verdict = classifyAttempt(
      ctx,
      run,
      snapshot,
      child,
      mapping.taskId,
      latest.id,
      latest.status === 'completed'
    )
    const identity = {
      automationRunId: run.id,
      orchestrationRunId: run.orchestrationRunId!,
      childDefinitionId: child.childDefinitionId,
      taskId: mapping.taskId,
      dispatchId: latest.id
    }
    const costUsd = ctx.workerProvider.estimateCostUsd?.(identity) ?? 0
    const dispatchId = latest.id
    ctx.ledger.update(
      `admit:${verdict.kind}`,
      (progress) =>
        isAdmitted(progress, dispatchId)
          ? progress
          : applyVerdict(progress, {
              snapshot,
              child,
              taskId: mapping.taskId,
              dispatchId,
              verdict,
              costUsd,
              now: ctx.clock.now()
            }),
      child.childDefinitionId
    )
  }
  return ctx.ledger.progress.sequence !== before
}
