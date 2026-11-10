import type { AutomationRun } from '../../shared/automations-types'
import type {
  CoordinatedAttemptKind,
  CoordinatedAttemptRecord,
  CoordinatedAttemptStatus,
  CoordinatedRunProgress,
  CoordinatedStageProgress
} from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { stageAttemptLimit } from './coordinated-automation-ceilings'
import { withStage } from './coordinated-automation-progress-ledger'
import type { CoordinatedPassContext } from './coordinated-automation-recovery-context'

export const DEFAULT_MAX_ACTIVE_FIXERS_PER_ARTIFACT = 1

/** Each review reopening grants exactly one attempt, so totals stay bounded across resets. */
export function stageAttemptBudget(child: ResolvedChildSnapshot, stage: CoordinatedStageProgress) {
  return stageAttemptLimit(child) + stage.reopenings
}

/** Latest known attempt, including one started outside the coordinator and only admitted. */
export function lastAttemptDispatchId(stage: CoordinatedStageProgress): string | null {
  return (
    stage.activeDispatchId ??
    stage.lineage.findLast((record) => record.dispatchId !== null)?.dispatchId ??
    null
  )
}

export function planAttempt(stage: CoordinatedStageProgress): {
  kind: CoordinatedAttemptKind
  retryOfDispatchId: string | null
} {
  const previous = lastAttemptDispatchId(stage)
  if (previous === null) {
    return { kind: 'initial', retryOfDispatchId: null }
  }
  if (stage.status === 'revision_requested') {
    return { kind: 'fix', retryOfDispatchId: stage.acceptedDispatchId ?? previous }
  }
  return { kind: stage.status === 'rejected' ? 'retry' : 'rerun', retryOfDispatchId: previous }
}

/** Artifact identities a fixer works on: declared patterns plus already-accepted files. */
export function fixerLeaseKeys(
  child: ResolvedChildSnapshot,
  stage: CoordinatedStageProgress,
  kind: CoordinatedAttemptKind
): string[] {
  if (kind !== 'fix' && kind !== 'retry') {
    return []
  }
  const keys = new Set<string>()
  for (const requirement of child.stageAcceptance?.requiredArtifacts ?? []) {
    keys.add(`artifact-pattern:${requirement.pathPattern ?? requirement.kind}`)
  }
  for (const artifact of stage.acceptedArtifacts) {
    keys.add(`artifact-uri:${artifact.uri}`)
  }
  return [...keys].sort()
}

export function isOpenAttempt(record: CoordinatedAttemptRecord): boolean {
  return record.status === 'starting' || record.status === 'active'
}

/** First lease key already held by the per-artifact fixer ceiling, if any. */
export function saturatedLeaseKey(
  progress: CoordinatedRunProgress,
  snapshot: ResolvedAutomationRunSnapshot,
  keys: readonly string[]
): string | null {
  const limit =
    snapshot.globalCeilings.maxActiveFixersPerArtifact ?? DEFAULT_MAX_ACTIVE_FIXERS_PER_ARTIFACT
  for (const key of keys) {
    const holders = Object.values(progress.stages)
      .flatMap((stage) => stage.lineage)
      .filter((record) => isOpenAttempt(record) && record.leaseKeys.includes(key)).length
    if (holders >= limit) {
      return key
    }
  }
  return null
}

export function withAttemptStatus(
  progress: CoordinatedRunProgress,
  childDefinitionId: string,
  match: (record: CoordinatedAttemptRecord) => boolean,
  update: Partial<CoordinatedAttemptRecord> & { status: CoordinatedAttemptStatus }
): CoordinatedRunProgress {
  return withStage(progress, childDefinitionId, (stage) => ({
    ...stage,
    lineage: stage.lineage.map((record) => (match(record) ? { ...record, ...update } : record))
  }))
}

/** Write-ahead attempt record; the native Dispatch starts only after this is durable. */
export function reserveAttempt(
  ctx: CoordinatedPassContext,
  input: {
    child: ResolvedChildSnapshot
    taskId: string
    kind: CoordinatedAttemptKind
    retryOfDispatchId: string | null
    leaseKeys: string[]
  }
): CoordinatedAttemptRecord {
  const now = ctx.clock.now()
  const id = input.child.childDefinitionId
  const stage = ctx.ledger.progress.stages[id]
  const record: CoordinatedAttemptRecord = {
    attemptNumber: (stage?.lineage.length ?? 0) + 1,
    kind: input.kind,
    dispatchId: null,
    retryOfDispatchId: input.retryOfDispatchId,
    previousLatestDispatchId: ctx.orchestrationDb.getDispatchContext(input.taskId)?.id ?? null,
    startedAt: now,
    deadlineAt: now + input.child.launchConfig.timeoutSeconds * 1000,
    leaseKeys: input.leaseKeys,
    status: 'starting'
  }
  ctx.ledger.update(
    `attempt-reserved:${record.attemptNumber}`,
    (progress) =>
      withStage(progress, id, (current) => ({ ...current, lineage: [...current.lineage, record] })),
    id
  )
  return record
}

/**
 * A `starting` record survived a crash: bind it to the native Dispatch created after it, or
 * abandon it (releasing its lease) when no Dispatch was ever created.
 */
export function reconcileStartingAttempts(
  ctx: CoordinatedPassContext,
  run: AutomationRun
): boolean {
  const before = ctx.ledger.progress.sequence
  for (const [id, stage] of Object.entries(ctx.ledger.progress.stages)) {
    const taskId = (run.childMappings ?? []).find((m) => m.childDefinitionId === id)?.taskId
    if (!taskId || ctx.inFlightTaskIds.has(taskId)) {
      continue
    }
    for (const record of stage.lineage.filter((r) => r.status === 'starting')) {
      const latest = ctx.orchestrationDb.getDispatchContext(taskId)?.id ?? null
      const started = latest !== null && latest !== record.previousLatestDispatchId
      ctx.ledger.update(
        started ? 'attempt-bound-after-restart' : 'attempt-abandoned',
        (progress) =>
          withAttemptStatus(
            progress,
            id,
            (r) => r.attemptNumber === record.attemptNumber,
            started ? { status: 'active', dispatchId: latest } : { status: 'abandoned' }
          ),
        id
      )
    }
  }
  return ctx.ledger.progress.sequence !== before
}
