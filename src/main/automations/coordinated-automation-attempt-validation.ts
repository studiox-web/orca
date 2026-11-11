import type { AutomationRun } from '../../shared/automations-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import {
  type WorkerResultValidationOutcome,
  validateStructuredWorkerResult
} from './coordinated-automation-result-validation'
import type { CoordinatedStagePendingApproval } from '../../shared/coordinated-automation-progress-types'
import {
  decodeWorkerReportResult,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'
import {
  type CoordinatedRecoveryContext,
  coordinatedWorkerAuthorIdentity
} from './coordinated-automation-recovery-context'

export function resolveRunWorkspacePath(
  ctx: Pick<CoordinatedRecoveryContext, 'store' | 'workspacePath'>,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): string | undefined {
  if (ctx.workspacePath !== undefined) {
    return ctx.workspacePath
  }
  const automation = ctx.store.listAutomations().find((a) => a.id === run.automationId)
  const projectId =
    automation && 'projectId' in automation && typeof automation.projectId === 'string'
      ? automation.projectId
      : snapshot.executionTarget.id
  return ctx.store.getRepo(projectId)?.path
}

/** Full admission check for one attempt: identity, digest, schema, artifacts, checks, approvals. */
export function validateAttemptReport(
  ctx: Pick<
    CoordinatedRecoveryContext,
    'store' | 'workspacePath' | 'hostApprovals' | 'hostEffectReceipts' | 'trustedAuthorIdentity'
  >,
  input: {
    report: unknown
    run: AutomationRun
    snapshot: ResolvedAutomationRunSnapshot
    child: ResolvedChildSnapshot
    taskId: string
    dispatchId: string
  }
): WorkerResultValidationOutcome {
  return validateStructuredWorkerResult(input.report, {
    automationRunId: input.run.id,
    orchestrationRunId: input.run.orchestrationRunId!,
    definitionRevision: input.snapshot.definitionRevision,
    childDefinitionId: input.child.childDefinitionId,
    taskId: input.taskId,
    dispatchId: input.dispatchId,
    canonicalDigest: input.snapshot.canonicalDigest,
    child: input.child,
    snapshot: input.snapshot,
    workspacePath: resolveRunWorkspacePath(ctx, input.run, input.snapshot),
    hostApprovals: ctx.hostApprovals(),
    hostEffectReceipts: ctx.hostEffectReceipts,
    trustedAuthorIdentity: ctx.trustedAuthorIdentity,
    authorIdentities: [
      coordinatedWorkerAuthorIdentity(input.child.childDefinitionId),
      ...(ctx.trustedAuthorIdentity ? [ctx.trustedAuthorIdentity] : [])
    ]
  })
}

/**
 * Re-verifies a held report at the moment of an approval: the native result must still be the
 * held bytes, and every other acceptance check (artifact hashes included) must still pass with
 * only this gate's decision outstanding. Anything else refuses the approval.
 */
export function assertHeldReportApprovable(
  ctx: Parameters<typeof validateAttemptReport>[0] &
    Pick<CoordinatedRecoveryContext, 'orchestrationDb'>,
  input: {
    run: AutomationRun
    snapshot: ResolvedAutomationRunSnapshot
    child: ResolvedChildSnapshot
    taskId: string | undefined
    held: CoordinatedStagePendingApproval | null
    gateId: string
  }
): void {
  const { held, taskId } = input
  const stage = input.child.childDefinitionId
  if (!held || !taskId) {
    throw new Error(
      `Stage "${stage}" has no report awaiting approval; an approval must bind an exact attempt and its report.`
    )
  }
  const decoded = decodeWorkerReportResult(ctx.orchestrationDb.getTask(taskId)?.result)
  if (
    ctx.orchestrationDb.getDispatchContext(taskId)?.id !== held.dispatchId ||
    decoded.kind !== 'structured' ||
    structuredReportDigest(decoded.report) !== held.reportDigest
  ) {
    throw new Error(
      `The report held for stage "${stage}" is no longer attempt ${held.dispatchId} with digest ${held.reportDigest}; inspect it again before deciding.`
    )
  }
  const validation = validateAttemptReport(ctx, {
    report: decoded.report,
    run: input.run,
    snapshot: input.snapshot,
    child: input.child,
    taskId,
    dispatchId: held.dispatchId
  })
  if (
    !validation.valid &&
    !(validation.awaitingApproval && validation.awaitingApproval.gateIds.includes(input.gateId))
  ) {
    throw new Error(
      `The held evidence for stage "${stage}" no longer validates: ${validation.error}`
    )
  }
}
