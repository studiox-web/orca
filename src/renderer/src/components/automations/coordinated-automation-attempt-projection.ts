import type {
  Automation,
  StageAcceptanceRecord,
  StageAcceptanceStatus
} from '../../../../shared/automations-types'
import type {
  OrchestrationCrewRow,
  OrchestrationCrewSnapshot
} from '../../../../shared/orchestration-crew'
import type {
  ChildDefinitionDriftState,
  CoordinatedAttemptTechnicalStatus,
  CoordinatedDispatchAttemptObservation,
  CoordinatedStageExecutionStatus,
  ProjectedCoordinatedStage,
  FrozenStageSource,
  ProjectedCoordinatedAttempt
} from './coordinated-automation-run-types'

function findCrewRowForAttempt(
  attempt: CoordinatedDispatchAttemptObservation,
  crewSnapshot: OrchestrationCrewSnapshot | null | undefined,
  fallbackAgent: string,
  fallbackHostLabel: string | null
): OrchestrationCrewRow | null {
  if (attempt.crewRow) {
    return attempt.crewRow
  }
  if (crewSnapshot?.status === 'ok') {
    const allRows = [
      ...crewSnapshot.sections.managing,
      ...crewSnapshot.sections.talkingWith,
      ...crewSnapshot.sections.managedBy
    ]
    const matched = allRows.find(
      (row) =>
        row.partyKey === attempt.dispatchId ||
        row.partyKey === attempt.taskId ||
        (row.openTarget?.kind === 'dispatch' && row.openTarget.address === attempt.dispatchId)
    )
    if (matched) {
      return matched
    }
  }
  if (attempt.openTarget) {
    return {
      partyKey: attempt.dispatchId,
      role: 'worker',
      label: attempt.ownerLabel ?? `${attempt.childDefinitionId} (${attempt.dispatchId})`,
      agentKind: attempt.agentKind ?? fallbackAgent,
      ...((attempt.hostLabel ?? fallbackHostLabel)
        ? { hostLabel: attempt.hostLabel ?? fallbackHostLabel ?? undefined }
        : {}),
      status: attempt.technicalStatus,
      openTarget: attempt.openTarget
    }
  }
  return null
}

function resolveAttemptOpenStatus(
  crewRow: OrchestrationCrewRow | null,
  technicalStatus: CoordinatedAttemptTechnicalStatus
): { canOpenWorker: boolean; reason: string | null } {
  if (crewRow?.openTarget) {
    return { canOpenWorker: true, reason: null }
  }
  if (technicalStatus === 'queued') {
    return {
      canOpenWorker: false,
      reason: 'Worker attempt is queued and has not started a live session yet.'
    }
  }
  return {
    canOpenWorker: false,
    reason: 'No live chat, terminal, or dispatch open target is recorded for this attempt.'
  }
}

export function projectCoordinatedAttempt(input: {
  obs: CoordinatedDispatchAttemptObservation
  index: number
  activeDispatchId: string | null
  stageAcceptance: StageAcceptanceRecord | null
  crewSnapshot: OrchestrationCrewSnapshot | null | undefined
  fallbackAgent: string
  fallbackHostLabel: string | null
}): ProjectedCoordinatedAttempt {
  const { obs, index, activeDispatchId, stageAcceptance, crewSnapshot } = input
  const isActive = activeDispatchId !== null ? obs.dispatchId === activeDispatchId : index === 0
  const effectiveTechnical: CoordinatedAttemptTechnicalStatus =
    !isActive && obs.technicalStatus !== 'superseded' ? 'superseded' : obs.technicalStatus
  const acceptanceRecord = obs.stageAcceptance ?? (isActive ? stageAcceptance : null)
  // Why: a superseded attempt is a technical fact, not a semantic verdict.
  // Show only an acceptance decision actually recorded for that attempt.
  const semanticAcceptanceStatus: StageAcceptanceStatus | 'unverified' = !isActive
    ? (acceptanceRecord?.status ?? 'unverified')
    : (acceptanceRecord?.status ??
      (obs.workerReportOutcome === 'succeeded' ? 'evaluating' : 'unverified'))
  const crewRow = findCrewRowForAttempt(
    obs,
    crewSnapshot,
    input.fallbackAgent,
    input.fallbackHostLabel
  )
  const openStatus = resolveAttemptOpenStatus(crewRow, effectiveTechnical)
  const report = obs.structuredResult

  return {
    dispatchId: obs.dispatchId,
    taskId: obs.taskId,
    childDefinitionId: obs.childDefinitionId,
    attemptNumber: obs.attemptNumber ?? index + 1,
    retryOfDispatchId: obs.retryOfDispatchId ?? null,
    isActive,
    technicalStatus: effectiveTechnical,
    workerReportOutcome: obs.workerReportOutcome ?? report?.outcome ?? null,
    semanticAcceptanceStatus,
    summary: report?.summary ?? null,
    ownerLabel: obs.ownerLabel ?? crewRow?.label ?? `${obs.childDefinitionId} worker`,
    agentKind: obs.agentKind ?? crewRow?.agentKind ?? input.fallbackAgent,
    hostLabel: obs.hostLabel ?? crewRow?.hostLabel ?? input.fallbackHostLabel,
    crewRow,
    canOpenWorker: openStatus.canOpenWorker,
    openWorkerUnavailableReason: openStatus.reason,
    latestActivity:
      obs.latestActivity ??
      (crewRow?.latest
        ? {
            preview: crewRow.latest.preview,
            at: crewRow.latest.at,
            direction: crewRow.latest.direction
          }
        : null),
    pendingQuestion: obs.pendingQuestion ?? crewRow?.pendingQuestion ?? null,
    artifacts: report?.artifacts ?? [],
    checks: report?.checks ?? [],
    effects: report?.effects ?? [],
    blockers: report?.blockers ?? [],
    durationSeconds: obs.durationSeconds ?? null,
    estimatedCostUsd: obs.estimatedCostUsd ?? null,
    totalTokens: obs.totalTokens ?? null,
    reviewIteration: obs.reviewIteration ?? null
  }
}

export function detectDefinitionDrift(
  source: FrozenStageSource,
  automation: Automation,
  runRevision: number
): {
  drift: ChildDefinitionDriftState
  currentName: string | null
  tombstonedInRevision: number | null
} {
  const tombstone = (automation.childTombstones ?? []).find(
    (t) => t.childDefinitionId === source.childDefinitionId
  )
  if (tombstone) {
    return {
      drift: 'tombstoned',
      currentName: null,
      tombstonedInRevision: tombstone.removedInRevision
    }
  }
  const currentChild = (automation.children ?? []).find((c) => c.id === source.childDefinitionId)
  if (!currentChild && (automation.definitionRevision ?? 1) > runRevision) {
    return {
      drift: 'tombstoned',
      currentName: null,
      tombstonedInRevision: automation.definitionRevision ?? null
    }
  }
  if (currentChild && currentChild.name !== source.name) {
    return { drift: 'renamed', currentName: currentChild.name, tombstonedInRevision: null }
  }
  return { drift: 'unchanged', currentName: null, tombstonedInRevision: null }
}

export function deriveStageExecutionStatus(input: {
  enabledInSnapshot: boolean
  skippedReason: string | null
  activeAttempt: ProjectedCoordinatedAttempt | null
  attempts: readonly ProjectedCoordinatedAttempt[]
  semanticAcceptanceStatus: StageAcceptanceStatus | 'unverified'
  hasUncertainEffect: boolean
  hasPendingApproval: boolean
  hasBlocker: boolean
  upstreamSatisfied: boolean
  runCompletedWithReceipt: boolean
}): CoordinatedStageExecutionStatus {
  if (!input.enabledInSnapshot || input.skippedReason) {
    return 'skipped'
  }
  if (input.hasUncertainEffect || input.activeAttempt?.workerReportOutcome === 'uncertain') {
    return 'uncertain'
  }
  if (
    input.semanticAcceptanceStatus === 'accepted' ||
    input.semanticAcceptanceStatus === 'waived' ||
    input.runCompletedWithReceipt
  ) {
    return 'accepted'
  }
  if (input.hasPendingApproval) {
    return 'waiting_for_approval'
  }
  if (
    input.hasBlocker ||
    input.activeAttempt?.technicalStatus === 'blocked' ||
    input.activeAttempt?.workerReportOutcome === 'blocked' ||
    input.semanticAcceptanceStatus === 'revision_requested'
  ) {
    return 'blocked'
  }
  if (
    input.activeAttempt?.technicalStatus === 'failed' ||
    input.activeAttempt?.workerReportOutcome === 'failed' ||
    input.semanticAcceptanceStatus === 'rejected'
  ) {
    return 'failed'
  }
  if (
    input.activeAttempt &&
    (input.activeAttempt.technicalStatus === 'working' ||
      input.activeAttempt.technicalStatus === 'starting' ||
      input.activeAttempt.technicalStatus === 'waiting')
  ) {
    return 'active'
  }
  if (input.attempts.length > 0 && input.attempts.every((a) => !a.isActive)) {
    return 'superseded'
  }
  if (input.activeAttempt?.technicalStatus === 'queued') {
    return 'queued'
  }
  return input.upstreamSatisfied ? 'ready' : 'queued'
}

const WORKER_OPEN_UNBOUND_REASON =
  'Opening workers is unavailable here because this view has no bound runtime host.'

function unbindAttempt(attempt: ProjectedCoordinatedAttempt): ProjectedCoordinatedAttempt {
  return attempt.canOpenWorker
    ? { ...attempt, canOpenWorker: false, openWorkerUnavailableReason: WORKER_OPEN_UNBOUND_REASON }
    : attempt
}

export function withWorkerOpenUnbound<T extends { stages: readonly ProjectedCoordinatedStage[] }>(
  projection: T
): T {
  return {
    ...projection,
    stages: projection.stages.map((stage) => ({
      ...stage,
      attempts: stage.attempts.map(unbindAttempt),
      activeAttempt: stage.activeAttempt ? unbindAttempt(stage.activeAttempt) : null
    }))
  }
}
