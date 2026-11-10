import type { AutomationRun } from '../../shared/automations-types'
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
  assertCoordinatorActive,
  type CoordinatedPassContext,
  type CoordinatedRecoveryContext,
  coordinatedWorkerAuthorIdentity
} from './coordinated-automation-recovery-context'
import { acceptedStageReports } from './coordinated-automation-accepted-reports'
import { admitSettledAttempts } from './coordinated-automation-stage-admission'
import { isCompleteCoordinatedHostApproval } from './coordinated-automation-approval-validation'
import { resolveRunWorkspacePath } from './coordinated-automation-attempt-validation'
import { dispatchRunnableStages } from './coordinated-automation-stage-dispatch'
import {
  reconcileStartingAttempts,
  repairNativeChildDispatchMappings,
  abandonStoppedAttempts
} from './coordinated-automation-attempt-lineage'
import { syncNativeReadiness } from './coordinated-automation-native-readiness'
import { settleStoppingAttemptsForReconcile } from './coordinated-automation-native-stub-stop'
import {
  haltedOrNativeUncertain,
  nativeSettlementHolds,
  operatorStopOutcome
} from './coordinated-automation-halt-outcome'
import type { CoordinatedRunOutcome } from './coordinated-automation-halt-outcome'

export type {
  CoordinatedRunOutcome,
  CoordinatedRunOutcomeState
} from './coordinated-automation-halt-outcome'

const MAX_PASSES = 500

/** Orphaned attempts still inside their persisted deadline; a report may yet arrive. */
function awaitedAttempts(ctx: CoordinatedPassContext): string[] {
  return Object.entries(ctx.ledger.progress.stages).flatMap(([id, stage]) =>
    stage.lineage
      .filter((record) => record.status === 'active' && record.dispatchId !== null)
      .map(
        (record) =>
          `Stage "${id}" attempt ${record.dispatchId} awaits its report until ${record.deadlineAt}.`
      )
  )
}

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
  assertCoordinatorActive(ctx)
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
    const held = ctx.store.recordCoordinatedRunHold({
      automationRunId: run.id,
      state: 'blocked',
      reason
    })
    return { state: 'blocked', reason, run: held, progress }
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

/**
 * Derives every next action from persisted Automation, orchestration, artifact, and effect
 * evidence. A replacement generation first admits orphaned attempts and queries effects,
 * and only then may it dispatch.
 */
export async function reconcileCoordinatedRun(
  base: CoordinatedRecoveryContext,
  automationRunId: string,
  onClaimed?: (ledger: CoordinatedProgressLedger) => void
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
  assertCoordinatorActive(base)
  const ledger = CoordinatedProgressLedger.claim({
    store: base.progressStore,
    automationRunId,
    orchestrationRunId: run.orchestrationRunId,
    snapshot,
    now: base.clock.now(),
    boundary: base.boundary,
    isActive: base.isActive
  })
  onClaimed?.(ledger)
  const ctx: CoordinatedPassContext = { ...base, ledger }
  // Operator approvals are durable progress; acceptance reads only fully scoped records.
  ctx.hostApprovals = () => [
    ...base.hostApprovals(),
    ...(ledger.progress.approvals ?? []).filter(isCompleteCoordinatedHostApproval)
  ]
  let waiting: string[] = []
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    assertCoordinatorActive(ctx)
    run = requireRun(ctx, automationRunId)
    let progressed = reconcileStartingAttempts(ctx, run)
    progressed = repairNativeChildDispatchMappings(ctx, run) || progressed
    progressed = (await settleStoppingAttemptsForReconcile(ctx, run)) || progressed
    progressed = abandonStoppedAttempts(ctx, run) || progressed
    progressed = admitSettledAttempts(ctx, run, snapshot) || progressed
    syncNativeReadiness(ctx, run, snapshot)
    reverifyAcceptedArtifacts(ctx, run, snapshot)
    if (ctx.effectAdapter) {
      progressed = (await advanceStageEffects(ctx, snapshot)) || progressed
      assertCoordinatorActive(ctx)
    }
    if (ctx.ledger.progress.halt) {
      return haltedOrNativeUncertain(ctx, automationRunId)
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
  assertCoordinatorActive(ctx)
  run = requireRun(ctx, automationRunId)
  if (ctx.ledger.progress.halt) {
    return haltedOrNativeUncertain(ctx, automationRunId)
  }
  const stopOutcome = await operatorStopOutcome(ctx, run, snapshot)
  if (stopOutcome) {
    return stopOutcome
  }
  const effects = unresolvedEffects(snapshot, ctx.ledger.progress)
  if (effects.uncertain.length > 0) {
    const reason = `Effects ${effects.uncertain.join(', ')} are uncertain and need a human decision.`
    const held = ctx.store.recordCoordinatedRunHold({
      automationRunId,
      state: 'outcome_uncertain',
      reason
    })
    return { state: 'outcome_uncertain', reason, run: held, progress: ctx.ledger.progress }
  }
  const nativeHolds = nativeSettlementHolds(ctx, run)
  if (nativeHolds.length > 0) {
    const reason = nativeHolds.join(' ')
    const held = ctx.store.recordCoordinatedRunHold({
      automationRunId,
      state: 'outcome_uncertain',
      reason
    })
    return { state: 'outcome_uncertain', reason, run: held, progress: ctx.ledger.progress }
  }
  waiting = [...waiting, ...awaitedAttempts(ctx)]
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
  return haltedOrNativeUncertain(ctx, automationRunId)
}
