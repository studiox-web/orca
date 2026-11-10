import type { AutomationRun } from '../../shared/automations-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import {
  type WorkerResultValidationOutcome,
  validateStructuredWorkerResult
} from './coordinated-automation-result-validation'
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
