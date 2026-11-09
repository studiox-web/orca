import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'
import {
  validateLaunchPolicy,
  validateStructuredWorkerResult
} from './coordinated-automation-result-validation'
import type {
  CoordinatedWorkerIdentity,
  CoordinatedWorkerProvider
} from './coordinated-automation-adapter'

export async function executeCoordinatedTaskDispatch(input: {
  automationRunId: string
  taskId: string
  retryOfDispatchId?: string
  store: Store
  orchestrationDb: OrchestrationDb
  probe: CoordinatedOrchestrationRecordProbe
  workerProvider: CoordinatedWorkerProvider
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

  const validation = validateStructuredWorkerResult(rawReport, {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    definitionRevision: snapshot.definitionRevision,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId: dispatch.id,
    canonicalDigest: snapshot.canonicalDigest,
    child,
    snapshot
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
    result: validation.report.summary || JSON.stringify(validation.report)
  })

  return { taskId, dispatchId: dispatch.id, outcome: validation.report.outcome }
}
