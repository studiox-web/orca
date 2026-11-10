import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import { validateReceiptAgainstSnapshot } from '../../shared/coordinated-automation-receipt-validation'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { progressIdentityProblem } from './coordinated-automation-progress-ledger'
import {
  coordinatedMappingProblem,
  nativeDispatchLineageProblem
} from './coordinated-automation-native-validation'
import { runIsOperatorSettled } from './coordinated-automation-operator-actions'
import {
  approvalObservations,
  runHumanResolution,
  stageEvidenceProblem,
  stageOperatorEligibility,
  stageSessionTarget
} from './coordinated-automation-run-inspection-details'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import type {
  Availability,
  CoordinatedRunInspection,
  CoordinatedStageInspection
} from './coordinated-automation-run-host-types'

type ProgressRead = Availability<{ progress: CoordinatedRunProgress }>

/** Reads progress without claiming a generation and accepts it only for this exact frozen run. */
function readTrustedProgress(
  progressStore: CoordinatedRunProgressStore,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot | null
): ProgressRead {
  let progress: CoordinatedRunProgress | null
  try {
    progress = progressStore.read(run.id)
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
  if (!progress) {
    return { kind: 'absent', reason: 'No coordinator generation has claimed this run yet.' }
  }
  const problem =
    !snapshot || !run.orchestrationRunId
      ? 'The run has no frozen snapshot or orchestration Run to validate progress against.'
      : progressIdentityProblem(progress, {
          automationRunId: run.id,
          orchestrationRunId: run.orchestrationRunId,
          snapshot
        })
  return problem
    ? { kind: 'unavailable', reason: `Progress is not this run’s: ${problem}` }
    : { kind: 'available', progress }
}

/** Every Dispatch the stage names must be a native attempt of exactly this run's mapped Task. */
function nativeStage(
  db: OrchestrationDb,
  orchestrationRunId: string | null,
  taskId: string | null
): CoordinatedStageInspection['native'] {
  if (!orchestrationRunId || !taskId) {
    return { kind: 'absent', reason: 'The run has not materialized this Task yet.' }
  }
  const task = db.getTask(taskId)
  if (!task || task.run_id !== orchestrationRunId) {
    return {
      kind: 'unavailable',
      reason: `Task ${taskId} is missing from orchestration Run ${orchestrationRunId}.`
    }
  }
  const latest = db.getDispatchContext(taskId)
  const latestProblem = latest
    ? nativeDispatchLineageProblem(db, latest, {
        dispatchId: latest.id,
        taskId,
        orchestrationRunId
      })
    : null
  if (latestProblem) {
    return { kind: 'unavailable', reason: `Latest native attempt is not trusted: ${latestProblem}` }
  }
  return {
    kind: 'available',
    taskStatus: task.status,
    latestDispatchId: latest?.id ?? null,
    latestDispatchStatus: latest?.status ?? null
  }
}

function semanticStage(
  db: OrchestrationDb,
  run: AutomationRun,
  child: ResolvedChildSnapshot,
  taskId: string | null,
  progress: ProgressRead
): CoordinatedStageInspection['semantic'] {
  if (progress.kind !== 'available') {
    return { kind: progress.kind, reason: progress.reason }
  }
  const stage = progress.progress.stages[child.childDefinitionId]
  if (!stage) {
    return { kind: 'absent', reason: 'This child has no stage progress (disabled).' }
  }
  const problem = stageEvidenceProblem(
    db,
    run.orchestrationRunId ?? '',
    taskId,
    child.childDefinitionId,
    stage,
    progress.progress
  )
  return problem
    ? { kind: 'unavailable', reason: problem }
    : {
        kind: 'available',
        status: stage.status,
        attempts: stage.attempts,
        acceptedDispatchId: stage.acceptedDispatchId,
        lastError: stage.lastError,
        lineage: stage.lineage
      }
}

/** Revalidates the persisted receipt against the frozen snapshot, Store trust, and native rows. */
function trustedReceipt(
  db: OrchestrationDb,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot | null
): CoordinatedRunInspection['receipt'] {
  const receipt = run.completionReceipt
  if (!receipt) {
    return { kind: 'absent', reason: 'No semantic completion receipt has been persisted.' }
  }
  const trust = run.completionTrust
  if (!trust || !snapshot || !run.orchestrationRunId) {
    return { kind: 'unavailable', reason: 'The receipt has no host trust record or frozen run.' }
  }
  const attemptTask = db.getTask(trust.activeAttempt.taskId)
  if (
    attemptTask?.run_id !== run.orchestrationRunId ||
    nativeDispatchLineageProblem(db, db.getDispatchContextById(trust.activeAttempt.dispatchId), {
      dispatchId: trust.activeAttempt.dispatchId,
      taskId: trust.activeAttempt.taskId,
      orchestrationRunId: run.orchestrationRunId
    }) !== null
  ) {
    return {
      kind: 'unavailable',
      reason: 'The receipt’s active attempt is not a native attempt of this run.'
    }
  }
  const validation = validateReceiptAgainstSnapshot(receipt, snapshot, {
    trustedAuthorIdentity: trust.authorIdentity,
    trustedHostId: snapshot.executionTarget.id,
    trustedExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    activeAttempt: trust.activeAttempt,
    trustedTaskMappings: (run.childMappings ?? []).map((m) => ({ ...m })),
    ...(trust.waiverPolicy ? { waiverPolicy: trust.waiverPolicy } : {}),
    ...(trust.productionDecision ? { productionDecision: trust.productionDecision } : {})
  })
  return validation.valid
    ? { kind: 'available', receipt, trust }
    : { kind: 'unavailable', reason: `Receipt is not trusted: ${validation.errors.join('; ')}` }
}

/**
 * Joins the exact Store run, frozen snapshot, native Task/Dispatch rows, and validated progress
 * and receipt for one run. Missing, foreign, or inconsistent evidence is reported as such.
 */
export function inspectCoordinatedRun(input: {
  run: AutomationRun
  orchestrationDb: OrchestrationDb
  progressStore: CoordinatedRunProgressStore
}): CoordinatedRunInspection {
  const { run, orchestrationDb: db } = input
  const snapshot = run.resolvedSnapshot ?? null
  const orchestrationRunId = run.orchestrationRunId ?? null
  const progress = readTrustedProgress(input.progressStore, run, snapshot)
  // Nothing native or semantic is exposed unless the whole mapping is exactly the materialized one.
  const mappingProblem =
    snapshot && run.materializationPhase === 'ready_for_dispatch'
      ? coordinatedMappingProblem(db, run, snapshot)
      : null
  const stages: CoordinatedStageInspection[] = (snapshot?.resolvedChildren ?? []).map((child) => {
    const mapping = (run.childMappings ?? []).find(
      (m) => m.childDefinitionId === child.childDefinitionId
    )
    const taskId = mapping?.taskId ?? null
    const untrusted = mappingProblem
      ? {
          kind: 'unavailable' as const,
          reason: `Child mappings are not trusted: ${mappingProblem}`
        }
      : null
    const runSettled = runIsOperatorSettled(run)
    const operator = stageOperatorEligibility({ progress, child, runSettled })
    return {
      childDefinitionId: child.childDefinitionId,
      name: child.name,
      role: child.role,
      enabled: child.enabled,
      taskId: untrusted ? null : taskId,
      mappedDispatchId: untrusted ? null : (mapping?.dispatchId ?? null),
      native: untrusted ?? nativeStage(db, orchestrationRunId, taskId),
      semantic: untrusted ?? semanticStage(db, run, child, taskId, progress),
      sessionTarget: untrusted
        ? { kind: 'unavailable', reason: untrusted.reason }
        : stageSessionTarget(db, run, child, taskId, mapping?.dispatchId ?? null),
      retryEligibility: operator.retry,
      gateResolutionEligibility: operator.gate
    }
  })
  return {
    automationId: run.automationId,
    automationRunId: run.id,
    runStatus: run.status,
    runError: run.error,
    definitionRevision: run.automationDefinitionRevision ?? snapshot?.definitionRevision ?? 0,
    canonicalDigest: snapshot?.canonicalDigest ?? null,
    idempotencyKey: run.idempotencyKey ?? null,
    materializationPhase: run.materializationPhase ?? null,
    orchestrationRunId,
    stages,
    progress:
      progress.kind === 'available'
        ? {
            kind: 'available',
            generation: progress.progress.generation,
            sequence: progress.progress.sequence,
            halt: progress.progress.halt,
            escalations: progress.progress.escalations,
            effects: Object.values(progress.progress.effects),
            reportCount: progress.progress.reports.length
          }
        : progress,
    receipt: mappingProblem
      ? { kind: 'unavailable', reason: `Child mappings are not trusted: ${mappingProblem}` }
      : trustedReceipt(db, run, snapshot),
    approvals: snapshot
      ? approvalObservations({ run, snapshot, progress: trustedProgressOrNull(progress) })
      : { stage: [], parent: [] },
    operatorStop: trustedProgressOrNull(progress)?.operatorStop ?? null,
    humanResolution: snapshot
      ? runHumanResolution({ snapshot, progress: trustedProgressOrNull(progress) })
      : { available: false, reason: 'The run has no frozen snapshot.', pendingDecisionKeys: [] }
  }
}

function trustedProgressOrNull(
  progress: Availability<{ progress: CoordinatedRunProgress }>
): CoordinatedRunProgress | null {
  return progress.kind === 'available' ? progress.progress : null
}
