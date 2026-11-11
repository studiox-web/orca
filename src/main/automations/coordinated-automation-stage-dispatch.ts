import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedEscalationCode } from '../../shared/coordinated-automation-progress-types'
import { DEFAULT_MUTATION_LANE_SENTINEL } from '../../shared/coordinated-automation-lane-validation'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import type { TaskRow } from '../runtime/orchestration/types'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { evaluateDispatchCeilings } from './coordinated-automation-ceilings'
import {
  fixerLeaseKeys,
  isOpenAttempt,
  planAttempt,
  reserveAttempt,
  saturatedLeaseKey,
  stageAttemptBudget,
  withAttemptStatus
} from './coordinated-automation-attempt-lineage'
import { unresolvedEffects } from './coordinated-automation-effect-gate'
import { selectEligibleTasksForDispatch } from './coordinated-automation-lane-scheduler'
import { withEscalation, withHalt } from './coordinated-automation-progress-ledger'
import {
  assertCoordinatorActive,
  type CoordinatedPassContext
} from './coordinated-automation-recovery-context'
import { executeCoordinatedTaskDispatch } from './coordinated-automation-task-execution'

export type StageDispatchResult = { progressed: boolean; waiting: string[] }

function haltWith(
  ctx: CoordinatedPassContext,
  input: {
    key: string
    code: CoordinatedEscalationCode
    childDefinitionId: string | null
    detail: string
    state: 'failed' | 'blocked'
  }
): void {
  const now = ctx.clock.now()
  ctx.ledger.update(`halt:${input.code}`, (progress) =>
    withHalt(
      withEscalation(progress, {
        key: input.key,
        code: input.code,
        childDefinitionId: input.childDefinitionId,
        detail: input.detail,
        requiresHumanDecision: input.state === 'blocked',
        at: now
      }),
      { state: input.state, reason: input.detail, at: now }
    )
  )
}

/** Stages whose dependencies are semantically accepted and whose own budget allows an attempt. */
function runnableStages(
  ctx: CoordinatedPassContext,
  snapshot: ResolvedAutomationRunSnapshot
): ResolvedChildSnapshot[] {
  const stages = ctx.ledger.progress.stages
  const runnable: ResolvedChildSnapshot[] = []
  for (const child of snapshot.resolvedChildren) {
    const stage = stages[child.childDefinitionId]
    if (!child.enabled || !stage || stage.status === 'accepted' || stage.status === 'invalidated') {
      continue
    }
    // Durable acceptance gates every dependency; native completion never does.
    if (!child.dependencies.every((dep) => stages[dep.childId]?.status === 'accepted')) {
      continue
    }
    if (stage.lineage.some(isOpenAttempt)) {
      continue
    }
    const budget = stageAttemptBudget(child, stage)
    if (stage.attempts >= budget) {
      haltWith(ctx, {
        key: `stage_rejected:${child.childDefinitionId}:${stage.activeDispatchId ?? ''}`,
        code: 'stage_rejected',
        childDefinitionId: child.childDefinitionId,
        detail: `Stage "${child.childDefinitionId}" used all ${budget} attempt(s): ${stage.lastError ?? 'no reason recorded'}`,
        state: 'failed'
      })
      return []
    }
    runnable.push(child)
  }
  return runnable
}

/**
 * Native retry lineage is used whenever orchestration allows it (failed predecessor); otherwise
 * the Task is reopened and the durable attempt record alone carries the logical `retryOf`.
 */
function prepareNativeTask(
  ctx: CoordinatedPassContext,
  task: TaskRow,
  retryOfDispatchId: string | null
): string | undefined {
  const latest = ctx.orchestrationDb.getDispatchContext(task.id)
  if (
    retryOfDispatchId !== null &&
    latest?.id === retryOfDispatchId &&
    latest.status === 'failed' &&
    (task.status === 'failed' || task.status === 'blocked')
  ) {
    return latest.id
  }
  if (task.status !== 'ready') {
    ctx.orchestrationDb.updateTaskStatus(task.id, 'ready')
  }
  return undefined
}

export async function dispatchRunnableStages(
  ctx: CoordinatedPassContext,
  run: AutomationRun,
  snapshot: ResolvedAutomationRunSnapshot
): Promise<StageDispatchResult> {
  const waiting: string[] = []
  const effects = unresolvedEffects(snapshot, ctx.ledger.progress)
  const effectsInFlight = Object.values(ctx.ledger.progress.effects).some(
    (entry) => entry.status !== 'verified'
  )
  if (
    !ctx.isActive() ||
    ctx.ledger.progress.halt ||
    ctx.ledger.progress.operatorStop ||
    effects.uncertain.length > 0 ||
    effectsInFlight
  ) {
    return { progressed: false, waiting }
  }
  const candidates = runnableStages(ctx, snapshot).filter(
    (child) => !ctx.inFlightTaskIds.has(taskIdFor(run, child))
  )
  if (candidates.length === 0 || ctx.ledger.progress.halt) {
    return { progressed: false, waiting }
  }
  const breach = evaluateDispatchCeilings({
    snapshot,
    progress: ctx.ledger.progress,
    now: ctx.clock.now(),
    pendingCostUsd: ctx.workerProvider.estimateCostUsd
      ? candidates.reduce(
          (sum, child) =>
            sum +
            ctx.workerProvider.estimateCostUsd!({
              automationRunId: run.id,
              orchestrationRunId: run.orchestrationRunId!,
              childDefinitionId: child.childDefinitionId,
              taskId: taskIdFor(run, child),
              dispatchId: 'pending'
            }),
          0
        )
      : 0
  })
  if (breach) {
    haltWith(ctx, { key: breach.code, ...breach, childDefinitionId: null, state: 'blocked' })
    return { progressed: true, waiting }
  }

  const taskToChild = new Map(candidates.map((child) => [taskIdFor(run, child), child]))
  const inFlightTasks = [...ctx.inFlightTaskIds].flatMap((id) => {
    const task = ctx.orchestrationDb.getTask(id)
    return task ? [task] : []
  })
  for (const task of inFlightTasks) {
    const mapping = (run.childMappings ?? []).find((m) => m.taskId === task.id)
    const child = snapshot.resolvedChildren.find(
      (c) => c.childDefinitionId === mapping?.childDefinitionId
    )
    if (child) {
      taskToChild.set(task.id, child)
    }
  }
  const readyTasks = candidates.flatMap((child) => {
    const task = ctx.orchestrationDb.getTask(taskIdFor(run, child))
    return task ? [task] : []
  })
  const selected = selectEligibleTasksForDispatch({
    readyTasks,
    inFlightTasks,
    taskToChild,
    maxConcurrency: snapshot.globalCeilings.maxConcurrency ?? Infinity
  })

  const launches: Promise<unknown>[] = []
  for (const task of selected) {
    const child = taskToChild.get(task.id)!
    let release: (() => void) | undefined
    if (child.mutationClass !== 'read_only' && ctx.laneLocks) {
      const lane = child.mutationLane ?? DEFAULT_MUTATION_LANE_SENTINEL
      const lock = ctx.laneLocks.tryAcquire(lane, `${run.id}:${child.childDefinitionId}`)
      if (!lock.acquired) {
        waiting.push(`Lane "${lane}" is held by ${lock.holder}.`)
        const now = ctx.clock.now()
        ctx.ledger.update('lock-unavailable', (progress) =>
          withEscalation(progress, {
            key: `lock_unavailable:${lane}:${lock.holder}`,
            code: 'lock_unavailable',
            childDefinitionId: child.childDefinitionId,
            detail: `Lane "${lane}" lock is held by ${lock.holder}${lock.expiresAt !== undefined ? ` (expires ${lock.expiresAt})` : ''}; waiting without bypassing it.`,
            requiresHumanDecision: false,
            at: now
          })
        )
        continue
      }
      release = lock.release
    }
    const stage = ctx.ledger.progress.stages[child.childDefinitionId]!
    const plan = planAttempt(stage)
    const leaseKeys = fixerLeaseKeys(child, stage, plan.kind)
    const saturated = saturatedLeaseKey(ctx.ledger.progress, snapshot, leaseKeys)
    if (saturated) {
      waiting.push(`Fixer limit reached for ${saturated}; "${child.childDefinitionId}" waits.`)
      release?.()
      continue
    }
    const record = reserveAttempt(ctx, { child, taskId: task.id, ...plan, leaseKeys })
    const nativeRetryOf = prepareNativeTask(ctx, task, plan.retryOfDispatchId)
    ctx.inFlightTaskIds.add(task.id)
    const id = child.childDefinitionId
    launches.push(
      executeCoordinatedTaskDispatch(ctx, {
        automationRunId: run.id,
        taskId: task.id,
        retryOfDispatchId: nativeRetryOf,
        deadlineAt: record.deadlineAt,
        assertCurrent: () => {
          assertCoordinatorActive(ctx)
          ctx.ledger.refresh()
        },
        onDispatchCreated: (dispatchId) =>
          void ctx.ledger.update(
            `attempt-bound:${record.attemptNumber}`,
            (progress) =>
              withAttemptStatus(progress, id, (r) => r.attemptNumber === record.attemptNumber, {
                status: 'active',
                dispatchId
              }),
            id
          )
      })
        .catch((error: unknown) => {
          if (!(error instanceof OrchestrationError) || error.code !== 'task_not_startable') {
            throw error
          }
          haltWith(ctx, {
            key: `stage_rejected:${child.childDefinitionId}:native_refusal`,
            code: 'stage_rejected',
            childDefinitionId: child.childDefinitionId,
            detail: `Native orchestration refused another attempt: ${error.message}`,
            state: 'failed'
          })
        })
        .finally(() => {
          ctx.inFlightTaskIds.delete(task.id)
          release?.()
        })
    )
  }
  const settled = await Promise.allSettled(launches)
  const failure = settled.find((result) => result.status === 'rejected')
  if (failure) {
    throw failure.reason
  }
  return { progressed: launches.length > 0, waiting }
}

function taskIdFor(run: AutomationRun, child: ResolvedChildSnapshot): string {
  return (run.childMappings ?? []).find((m) => m.childDefinitionId === child.childDefinitionId)!
    .taskId
}
