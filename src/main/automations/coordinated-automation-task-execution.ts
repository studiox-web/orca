import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { Store } from '../persistence/loading-store/store'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'
import { validateLaunchPolicy } from './coordinated-automation-result-validation'
import {
  type CoordinatedRecoveryContext,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider,
  CoordinatedWorkerStartError,
  FAKE_EFFECT_ADAPTER_KIND
} from './coordinated-automation-recovery-context'
import { validateAttemptReport } from './coordinated-automation-attempt-validation'
import { COORDINATED_START_FAILURE_PREFIX } from './coordinated-automation-stage-admission'
import { encodeCoordinatedWorkerReport } from './coordinated-automation-worker-report-envelope'

export function createDefaultFakeNoEffectsWorkerProvider(store: Store): CoordinatedWorkerProvider {
  return {
    capability: 'fake_no_effects',
    run: async (id): Promise<StructuredWorkerResult> => {
      const run = store.listAutomationRuns().find((r) => r.id === id.automationRunId)
      const checks = (run?.resolvedSnapshot?.outcomeContract.acceptanceCriteria ?? []).map((c) => ({
        id: c.id,
        outcome: 'passed' as const,
        evidence: [`Criterion ${c.id} verified passed by fake worker`]
      }))
      return {
        schemaVersion: 1,
        ...id,
        definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
        resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
        outcome: 'succeeded',
        summary: `Fake worker ${id.childDefinitionId} completed`,
        reportMarkdown: `Fake worker ${id.childDefinitionId} report`,
        artifacts: [],
        checks,
        effects: [],
        blockers: []
      }
    }
  }
}

const FAKE_WORKER_CAPABILITIES = new Set(['fake_no_effects', 'shadow_fake_worker'])

function hasFakeWorkerCapability(provider: CoordinatedWorkerProvider): boolean {
  return (
    (provider.capability !== undefined && FAKE_WORKER_CAPABILITIES.has(provider.capability)) ||
    (provider.capabilities ?? []).some((capability) => FAKE_WORKER_CAPABILITIES.has(capability))
  )
}

export async function executeCoordinatedTaskDispatch(
  ctx: CoordinatedRecoveryContext,
  input: { automationRunId: string; taskId: string; retryOfDispatchId?: string }
): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
  const { automationRunId, taskId, retryOfDispatchId } = input
  const { store, orchestrationDb, probe, workerProvider } = ctx
  const run = store.listAutomationRuns().find((r) => r.id === automationRunId)
  if (!run) {
    throw new Error(`Automation run "${automationRunId}" not found.`)
  }
  if (run.status === 'completed' || run.completionReceipt !== null) {
    throw new CoordinatedAutomationLaunchRefusedError(
      `Run "${automationRunId}" is already completed; cannot dispatch task "${taskId}".`
    )
  }
  if (run.materializationPhase !== 'ready_for_dispatch') {
    throw new Error(
      `Run "${automationRunId}" is in phase "${run.materializationPhase}", expected "ready_for_dispatch".`
    )
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot || !run.orchestrationRunId) {
    throw new Error(
      `Run "${automationRunId}" has no resolved snapshot or linked orchestration Run.`
    )
  }
  if (!probe.hasRun(run.orchestrationRunId)) {
    throw new Error(
      `Orchestration Run "${run.orchestrationRunId}" not found for run "${automationRunId}".`
    )
  }

  const mapping = (run.childMappings ?? []).find((m) => m.taskId === taskId)
  if (!mapping) {
    throw new Error(`Task "${taskId}" has no mapped child definition in run "${automationRunId}".`)
  }
  const child = snapshot.resolvedChildren.find(
    (c) => c.childDefinitionId === mapping.childDefinitionId
  )
  if (!child || !child.enabled) {
    throw new Error(
      `Child definition "${mapping.childDefinitionId}" not found or disabled in snapshot.`
    )
  }
  if (!probe.hasTask(run.orchestrationRunId, taskId)) {
    throw new Error(
      `Task "${taskId}" does not exist in orchestration Run "${run.orchestrationRunId}".`
    )
  }

  const policyCheck = validateLaunchPolicy(child, snapshot, {
    fakeEffects: ctx.effectAdapter?.kind === FAKE_EFFECT_ADAPTER_KIND
  })
  if (!policyCheck.allowed) {
    throw new CoordinatedAutomationLaunchRefusedError(policyCheck.reason)
  }
  if (!hasFakeWorkerCapability(workerProvider)) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'Provider rejected: the disabled shadow implementation requires an explicit host-owned fake/no-effect provider capability.'
    )
  }

  const { dispatch } = orchestrationDb.createStartingWorkerDispatch({
    taskId,
    taskRunId: run.orchestrationRunId,
    retryOf: retryOfDispatchId,
    creator: { kind: 'system' },
    maxDepth: 5,
    startOptions: {
      agent: child.launchConfig.agentId,
      model: child.launchConfig.model,
      reasoningEffort: child.launchConfig.reasoningEffort,
      surface: child.launchConfig.surface,
      extraAgentArgs: child.launchConfig.extraAgentArgs,
      reuseSession: child.launchConfig.reuseSession,
      workspaceMode: child.launchConfig.workspaceMode,
      workspaceId: child.launchConfig.workspaceId,
      baseBranch: child.launchConfig.baseBranch,
      setupDecision: child.launchConfig.setupDecision,
      timeoutMs: (child.launchConfig.timeoutSeconds ?? 60) * 1000,
      maxRetries: child.launchConfig.maxRetries,
      maxReviewIterations: child.launchConfig.maxReviewIterations,
      mode: { mode: 'headless' }
    }
  })
  const boundaryDetail = {
    automationRunId,
    childDefinitionId: child.childDefinitionId,
    label: dispatch.id
  }
  ctx.boundary('dispatch.after-native-start', boundaryDetail)

  store.recordCoordinatedChildDispatch({
    automationRunId: run.id,
    childDefinitionId: child.childDefinitionId,
    dispatchId: dispatch.id
  })
  ctx.boundary('dispatch.after-mapping', boundaryDetail)

  const identity: CoordinatedWorkerIdentity = {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId: dispatch.id
  }
  const settle = (outcome: 'succeeded' | 'failed', result: string): void => {
    orchestrationDb.settleWorkerReport({ taskId, dispatchId: dispatch.id, outcome, result })
    ctx.boundary('report.after-native-settle', boundaryDetail)
  }

  let rawReport: unknown
  try {
    rawReport = await workerProvider.run(identity)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const started = !(error instanceof CoordinatedWorkerStartError)
    settle('failed', started ? message : `${COORDINATED_START_FAILURE_PREFIX} ${message}`)
    return { taskId, dispatchId: dispatch.id, outcome: started ? 'failed' : 'start_failed' }
  }

  const currentRun = store.listAutomationRuns().find((r) => r.id === automationRunId)
  const currentMappedDispatchId = (currentRun?.childMappings ?? []).find(
    (m) => m.taskId === taskId && m.childDefinitionId === child.childDefinitionId
  )?.dispatchId
  if (!currentMappedDispatchId || currentMappedDispatchId !== dispatch.id) {
    settle(
      'failed',
      encodeCoordinatedWorkerReport(
        rawReport,
        `Task "${taskId}" mapped dispatchId "${currentMappedDispatchId ?? ''}" does not match active dispatch "${dispatch.id}".`
      )
    )
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }

  const validation = validateAttemptReport(ctx, {
    report: rawReport,
    run,
    snapshot,
    child,
    taskId,
    dispatchId: currentMappedDispatchId
  })
  if (!validation.valid) {
    settle('failed', encodeCoordinatedWorkerReport(rawReport, validation.error))
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }
  settle(
    validation.report.outcome === 'succeeded' ? 'succeeded' : 'failed',
    encodeCoordinatedWorkerReport(validation.report)
  )
  return { taskId, dispatchId: dispatch.id, outcome: validation.report.outcome }
}
