import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import type {
  Availability,
  CoordinatedRunInspection,
  CoordinatedStageInspection
} from './coordinated-automation-run-host-types'

const HUMAN_RESOLUTION_UNAVAILABLE =
  'Uncertain effects, effect-reset conflicts, and review limits need a separately reviewed host resolution API.'

const NO_SESSION_TARGET =
  'The fake_no_effects provider runs in-process; there is no chat or terminal session to open.'

function readProgress(
  progressStore: CoordinatedRunProgressStore,
  automationRunId: string
): Availability<{ progress: CoordinatedRunProgress }> {
  try {
    const progress = progressStore.read(automationRunId)
    return progress
      ? { kind: 'available', progress }
      : { kind: 'absent', reason: 'No coordinator generation has claimed this run yet.' }
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
}

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
  return {
    kind: 'available',
    taskStatus: task.status,
    latestDispatchId: latest?.id ?? null,
    latestDispatchStatus: latest?.status ?? null
  }
}

/**
 * Joins the exact Store run, frozen snapshot, native Task/Dispatch rows, and validated progress
 * for one run. Missing or unreadable evidence is reported as such, never filled in.
 */
export function inspectCoordinatedRun(input: {
  run: AutomationRun
  orchestrationDb: OrchestrationDb
  progressStore: CoordinatedRunProgressStore
}): CoordinatedRunInspection {
  const { run } = input
  const snapshot = run.resolvedSnapshot
  const orchestrationRunId = run.orchestrationRunId ?? null
  const progress = readProgress(input.progressStore, run.id)
  const stages: CoordinatedStageInspection[] = (snapshot?.resolvedChildren ?? []).map((child) => {
    const mapping = (run.childMappings ?? []).find(
      (m) => m.childDefinitionId === child.childDefinitionId
    )
    const stage =
      progress.kind === 'available' ? progress.progress.stages[child.childDefinitionId] : undefined
    return {
      childDefinitionId: child.childDefinitionId,
      name: child.name,
      role: child.role,
      enabled: child.enabled,
      taskId: mapping?.taskId ?? null,
      mappedDispatchId: mapping?.dispatchId ?? null,
      native: nativeStage(input.orchestrationDb, orchestrationRunId, mapping?.taskId ?? null),
      semantic: stage
        ? {
            kind: 'available',
            status: stage.status,
            attempts: stage.attempts,
            acceptedDispatchId: stage.acceptedDispatchId,
            lastError: stage.lastError,
            lineage: stage.lineage
          }
        : progress.kind === 'available'
          ? { kind: 'absent', reason: 'This child has no stage progress (disabled).' }
          : { kind: progress.kind, reason: progress.reason },
      sessionTarget: { kind: 'unavailable', reason: NO_SESSION_TARGET }
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
    receipt: run.completionReceipt
      ? {
          kind: 'available',
          receipt: run.completionReceipt,
          trust: run.completionTrust ?? null
        }
      : { kind: 'absent', reason: 'No semantic completion receipt has been persisted.' },
    humanResolution: { available: false, reason: HUMAN_RESOLUTION_UNAVAILABLE }
  }
}
