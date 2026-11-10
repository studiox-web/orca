import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { ResolvedAutomationRunSnapshot } from '../../shared/coordinated-automation-types'
import { currentWorkspaceArtifactDigest } from './coordinated-automation-artifact-validation'
import {
  advanceStageEffects,
  unresolvedEffects,
  verifiedEffectReceipts
} from './coordinated-automation-effect-gate'
import {
  evaluateParentOutcomeAcceptance,
  reconcilePersistedCompletionReceipt
} from './coordinated-automation-parent-acceptance'
import {
  CoordinatedProgressLedger,
  withEscalation,
  withHalt,
  withStage
} from './coordinated-automation-progress-ledger'
import {
  type CoordinatedPassContext,
  type CoordinatedRecoveryContext,
  coordinatedWorkerAuthorIdentity
} from './coordinated-automation-recovery-context'
import { acceptedStageReports } from './coordinated-automation-accepted-reports'
import { admitSettledAttempts } from './coordinated-automation-stage-admission'
import { resolveRunWorkspacePath } from './coordinated-automation-attempt-validation'
import { dispatchRunnableStages } from './coordinated-automation-stage-dispatch'

export type CoordinatedRunOutcomeState =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'outcome_uncertain'
  | 'waiting'

export type CoordinatedRunOutcome = Readonly<{
  state: CoordinatedRunOutcomeState
  reason: string | null
  run: AutomationRun
  progress: CoordinatedRunProgress | null
}>

const MAX_PASSES = 500

function requireRun(ctx: CoordinatedRecoveryContext, automationRunId: string): AutomationRun {
  const run = ctx.store.listAutomationRuns().find((r) => r.id === automationRunId)
  if (!run) {
    throw new Error(`Automation run "${automationRunId}" not found.`)
  }
  return run
}

function invalidateStage(
  ctx: CoordinatedPassContext,
  childDefinitionId: string,
  detail: string,
  key: string
): void {
  const now = ctx.clock.now()
  ctx.ledger.update(
    'stage-invalidated',
    (progress) =>
      withHalt(
        withEscalation(
          withStage(progress, childDefinitionId, (stage) => ({
            ...stage,
            status: 'invalidated',
            lastError: detail
          })),
          {
            key,
            code: 'artifact_mutated',
            childDefinitionId,
            detail,
            requiresHumanDecision: true,
            at: now
          }
        ),
        { state: 'blocked', reason: detail, at: now }
      ),
    childDefinitionId
  )
}

/** Accepted evidence must still match on disk; a changed digest voids acceptance and blocks. */
function reverifyAcceptedArtifacts(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): void {
  const workspacePath = resolveRunWorkspacePath(ctx, run, snapshot)
  for (const [childDefinitionId, stage] of Object.entries(ctx.ledger.progress.stages)) {
    if (stage.status !== 'accepted') {
      continue
    }
    for (const artifact of stage.acceptedArtifacts) {
      const digest = workspacePath
        ? currentWorkspaceArtifactDigest(artifact.uri, workspacePath)
        : null
      if (digest !== artifact.sha256) {
        invalidateStage(
          ctx,
          childDefinitionId,
          `Accepted artifact "${artifact.uri}" changed from ${artifact.sha256} to ${digest ?? 'missing'}; its acceptance and approvals no longer hold.`,
          `artifact_mutated:${childDefinitionId}:${artifact.uri}`
        )
        return
      }
    }
  }
}

async function tryComplete(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): Promise<CoordinatedRunOutcome | null> {
  const progress = ctx.ledger.progress
  const stages = Object.values(progress.stages)
  const effects = unresolvedEffects(snapshot, progress)
  if (
    stages.some((stage) => stage.status !== 'accepted') ||
    effects.pending.length > 0 ||
    effects.uncertain.length > 0
  ) {
    return null
  }
  const accepted = acceptedStageReports(ctx, run, snapshot)
  if (!accepted.valid) {
    invalidateStage(
      ctx,
      accepted.childDefinitionId,
      accepted.error,
      `report_changed:${accepted.childDefinitionId}`
    )
    return null
  }
  const acceptance = evaluateParentOutcomeAcceptance({
    run,
    snapshot,
    orchestrationDb: ctx.orchestrationDb,
    probe: ctx.probe,
    trustedAuthorIdentity: ctx.trustedAuthorIdentity,
    hostApprovals: ctx.hostApprovals(),
    hostEffectReceipts: [...(ctx.hostEffectReceipts ?? []), ...verifiedEffectReceipts(progress)],
    acceptedReports: accepted.reports,
    authorIdentities: snapshot.resolvedChildren.map((c) =>
      coordinatedWorkerAuthorIdentity(c.childDefinitionId)
    )
  })
  if (!acceptance.accepted) {
    const reason = `Parent outcome acceptance validation failed: ${acceptance.errors.join('; ')}`
    const settled = ctx.store.recordCoordinatedRunSettlement({
      automationRunId: run.id,
      status: 'dispatch_failed',
      error: reason
    })
    return { state: 'blocked', reason, run: settled, progress }
  }
  const completed = ctx.store.recordCoordinatedRunSettlement({
    automationRunId: run.id,
    status: 'completed',
    error: null,
    completionReceipt: acceptance.receipt,
    completionTrust: acceptance.trust
  })
  ctx.boundary('receipt.after-persist', { automationRunId: run.id })
  return { state: 'completed', reason: null, run: completed, progress }
}

function haltedOutcome(ctx: CoordinatedPassContext, run: AutomationRun): CoordinatedRunOutcome {
  const halt = ctx.ledger.progress.halt!
  const settled =
    halt.state === 'failed' && run.status !== 'dispatch_failed'
      ? ctx.store.recordCoordinatedRunSettlement({
          automationRunId: run.id,
          status: 'dispatch_failed',
          error: halt.reason
        })
      : run
  return { state: halt.state, reason: halt.reason, run: settled, progress: ctx.ledger.progress }
}

/**
 * Derives every next action from persisted Automation, orchestration, artifact, and effect
 * evidence. A replacement generation first admits orphaned attempts and queries effects,
 * and only then may it dispatch.
 */
export async function reconcileCoordinatedRun(
  base: CoordinatedRecoveryContext,
  automationRunId: string
): Promise<CoordinatedRunOutcome> {
  let run = requireRun(base, automationRunId)
  const persisted = reconcilePersistedCompletionReceipt({
    run,
    store: base.store,
    trustedAuthorIdentity: base.trustedAuthorIdentity
  })
  if (persisted) {
    return { state: 'completed', reason: null, run: persisted, progress: null }
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot || !run.orchestrationRunId || run.materializationPhase !== 'ready_for_dispatch') {
    throw new Error(`Run "${automationRunId}" is not ready for dispatch.`)
  }
  const ledger = CoordinatedProgressLedger.claim({
    store: base.progressStore,
    automationRunId,
    orchestrationRunId: run.orchestrationRunId,
    snapshot,
    now: base.clock.now(),
    boundary: base.boundary
  })
  const ctx: CoordinatedPassContext = { ...base, ledger }
  let waiting: string[] = []
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    run = requireRun(ctx, automationRunId)
    let progressed = admitSettledAttempts(ctx, run, snapshot)
    reverifyAcceptedArtifacts(ctx, run, snapshot)
    if (ctx.effectAdapter) {
      progressed = (await advanceStageEffects(ctx, snapshot)) || progressed
    }
    if (ctx.ledger.progress.halt) {
      return haltedOutcome(ctx, requireRun(ctx, automationRunId))
    }
    const completion = await tryComplete(ctx, run, snapshot)
    if (completion) {
      return completion
    }
    const dispatched = await dispatchRunnableStages(ctx, requireRun(ctx, automationRunId), snapshot)
    waiting = dispatched.waiting
    if (!progressed && !dispatched.progressed && !ctx.ledger.progress.halt) {
      break
    }
  }
  run = requireRun(ctx, automationRunId)
  if (ctx.ledger.progress.halt) {
    return haltedOutcome(ctx, run)
  }
  const effects = unresolvedEffects(snapshot, ctx.ledger.progress)
  if (effects.uncertain.length > 0) {
    return {
      state: 'outcome_uncertain',
      reason: `Effects ${effects.uncertain.join(', ')} are uncertain and need a human decision.`,
      run,
      progress: ctx.ledger.progress
    }
  }
  if (waiting.length > 0 || effects.pending.length > 0) {
    return {
      state: 'waiting',
      reason: waiting.join(' ') || `Effects ${effects.pending.join(', ')} are not verified yet.`,
      run,
      progress: ctx.ledger.progress
    }
  }
  const reason = 'No stage can make progress.'
  ctx.ledger.update('no-progress', (progress) =>
    withHalt(progress, { state: 'failed', reason, at: ctx.clock.now() })
  )
  return haltedOutcome(ctx, run)
}
