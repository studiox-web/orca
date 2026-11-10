import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'
import {
  type CoordinatedHostApproval,
  validateLaunchPolicy,
  validateStructuredWorkerResult
} from './coordinated-automation-result-validation'
import type {
  CoordinatedWorkerIdentity,
  CoordinatedWorkerProvider
} from './coordinated-automation-adapter'

export function createDefaultFakeNoEffectsWorkerProvider(store: Store): CoordinatedWorkerProvider {
  return {
    capability: 'fake_no_effects',
    run: async (id) => {
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

export async function executeCoordinatedTaskDispatch(input: {
  automationRunId: string
  taskId: string
  retryOfDispatchId?: string
  store: Store
  orchestrationDb: OrchestrationDb
  probe: CoordinatedOrchestrationRecordProbe
  workerProvider: CoordinatedWorkerProvider
  hostApprovals?: readonly CoordinatedHostApproval[]
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  workspacePath?: string
  trustedAuthorIdentity?: string
}): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
  const {
    automationRunId,
    taskId,
    retryOfDispatchId,
    store,
    orchestrationDb,
    probe,
    workerProvider
  } = input
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

  const policyCheck = validateLaunchPolicy(child, snapshot)
  if (!policyCheck.allowed) {
    throw new CoordinatedAutomationLaunchRefusedError(policyCheck.reason)
  }

  const hasFakeNoEffectCapability =
    workerProvider.capability === 'fake_no_effects' ||
    workerProvider.capability === 'shadow_fake_worker' ||
    (Array.isArray(workerProvider.capabilities) &&
      (workerProvider.capabilities.includes('fake_no_effects') ||
        workerProvider.capabilities.includes('shadow_fake_worker')))

  if (!hasFakeNoEffectCapability) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'Provider rejected: Phase 4 disabled shadow implementation requires an explicit host-owned fake/no-effect provider capability.'
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

  store.recordCoordinatedChildDispatch({
    automationRunId: run.id,
    childDefinitionId: child.childDefinitionId,
    dispatchId: dispatch.id
  })

  const identity: CoordinatedWorkerIdentity = {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId: dispatch.id
  }

  let rawReport: unknown
  try {
    rawReport = await workerProvider.run(identity)
  } catch (error) {
    orchestrationDb.settleWorkerReport({
      taskId,
      dispatchId: dispatch.id,
      outcome: 'failed',
      result: error instanceof Error ? error.message : String(error)
    })
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }

  const currentRun = store.listAutomationRuns().find((r) => r.id === automationRunId)
  const currentMappedDispatchId = (currentRun?.childMappings ?? []).find(
    (m) => m.taskId === taskId && m.childDefinitionId === child.childDefinitionId
  )?.dispatchId
  if (!currentMappedDispatchId || currentMappedDispatchId !== dispatch.id) {
    orchestrationDb.settleWorkerReport({
      taskId,
      dispatchId: dispatch.id,
      outcome: 'failed',
      result: `Task "${taskId}" mapped dispatchId "${currentMappedDispatchId ?? ''}" does not match active dispatch "${dispatch.id}".`
    })
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }

  const automation = store.listAutomations().find((a) => a.id === run.automationId)
  const projectId =
    automation && 'projectId' in automation && typeof automation.projectId === 'string'
      ? automation.projectId
      : snapshot.executionTarget.id
  const repo = store.getRepo(projectId)
  const workspacePath = repo?.path

  const validation = validateStructuredWorkerResult(rawReport, {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    definitionRevision: snapshot.definitionRevision,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId: currentMappedDispatchId,
    canonicalDigest: snapshot.canonicalDigest,
    child,
    snapshot,
    workspacePath: input.workspacePath ?? workspacePath,
    hostApprovals: input.hostApprovals,
    hostEffectReceipts: input.hostEffectReceipts,
    trustedAuthorIdentity: input.trustedAuthorIdentity
  })

  if (!validation.valid) {
    orchestrationDb.settleWorkerReport({
      taskId,
      dispatchId: dispatch.id,
      outcome: 'failed',
      result: validation.error
    })
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }

  const outcome = validation.report.outcome === 'succeeded' ? 'succeeded' : 'failed'
  orchestrationDb.settleWorkerReport({
    taskId,
    dispatchId: dispatch.id,
    outcome,
    result: JSON.stringify(validation.report)
  })

  return { taskId, dispatchId: dispatch.id, outcome: validation.report.outcome }
}
