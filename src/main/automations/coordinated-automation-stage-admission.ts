import {
  isCoordinatedNativeAttempt,
  nativeAttemptSemanticAdmissionProblem
} from './coordinated-automation-native-attempt'
import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { classifyAttempt, type AttemptVerdict } from './coordinated-automation-attempt-verdict'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'
import { applyReviewFindings } from './coordinated-automation-review-loop'
import { withEscalation, withHalt, withStage } from './coordinated-automation-progress-ledger'
import {
  COORDINATED_START_FAILURE_PREFIX,
  COORDINATED_TIMEOUT_PREFIX
} from './coordinated-automation-attempt-prefixes'
import { withAttemptStatus } from './coordinated-automation-attempt-lineage'

export { COORDINATED_START_FAILURE_PREFIX }

function applyVerdict(
  progress: CoordinatedRunProgress,
  input: {
    snapshot: ResolvedAutomationRunSnapshot
    child: ResolvedChildSnapshot
    taskId: string
    dispatchId: string
    verdict: Exclude<AttemptVerdict, { kind: 'awaiting_approval' }>
    costUsd: number
    now: number
  }
): CoordinatedRunProgress {
  const { child, dispatchId, verdict, now } = input
  const id = child.childDefinitionId
  let next: CoordinatedRunProgress = {
    ...withAttemptStatus(progress, id, (r) => r.dispatchId === dispatchId, {
      status: 'admitted'
    }),
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
    next = withStage(next, id, (stage) => ({
      ...stage,
      activeDispatchId: dispatchId,
      attempts: stage.attempts + 1
    }))
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
    pendingApproval: null,
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
  if (verdict.kind === 'rejected' && verdict.timedOut) {
    next = withEscalation(next, {
      key: `stage_timeout:${id}:${dispatchId}`,
      code: 'stage_timeout',
      childDefinitionId: id,
      detail: verdict.reason,
      requiresHumanDecision: false,
      at: now
    })
  }
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
    const native = isCoordinatedNativeAttempt(ctx.orchestrationDb, latest.id)
    if (
      native &&
      nativeAttemptSemanticAdmissionProblem(ctx.store, ctx.orchestrationDb, run, latest.id)
    ) {
      continue
    }
    if (latest.status === 'pending' || latest.status === 'dispatched') {
      const activeId = latest.id
      const record = ctx.ledger.progress.stages[child.childDefinitionId]?.lineage.find(
        (r) => r.dispatchId === activeId
      )
      // A persisted deadline survives restart: the orphan keeps its window, then times out.
      if (record && ctx.clock.now() < record.deadlineAt) {
        continue
      }
      ctx.ledger.refresh()
      ctx.orchestrationDb.settleWorkerReport({
        taskId: mapping.taskId,
        dispatchId: latest.id,
        outcome: 'failed',
        result: record
          ? `${COORDINATED_TIMEOUT_PREFIX} attempt ${latest.id} passed its persisted deadline ${record.deadlineAt} without a report.`
          : `Attempt ${latest.id} has no report after coordinator generation ${ctx.ledger.generation} took over; it is unverified.`
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
    const dispatchId = latest.id
    if (verdict.kind === 'awaiting_approval') {
      holdForApproval(ctx, child.childDefinitionId, dispatchId, verdict)
      continue
    }
    const costUsd = ctx.workerProvider.estimateCostUsd?.(identity) ?? 0
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

/** Holds an otherwise valid report for its missing decision: no admission, no retry, no dependent. */
function holdForApproval(
  ctx: CoordinatedPassContext,
  childDefinitionId: string,
  dispatchId: string,
  verdict: Extract<AttemptVerdict, { kind: 'awaiting_approval' }>
): void {
  const held = ctx.ledger.progress.stages[childDefinitionId]?.pendingApproval
  if (
    held?.dispatchId === dispatchId &&
    held.reportDigest === verdict.digest &&
    held.gateIds.join('\n') === verdict.gateIds.join('\n')
  ) {
    return
  }
  const since = ctx.clock.now()
  ctx.ledger.update(
    'hold:awaiting-approval',
    (progress) =>
      withStage(progress, childDefinitionId, (stage) => ({
        ...stage,
        pendingApproval: {
          dispatchId,
          reportDigest: verdict.digest,
          gateIds: verdict.gateIds,
          since
        }
      })),
    childDefinitionId
  )
}
