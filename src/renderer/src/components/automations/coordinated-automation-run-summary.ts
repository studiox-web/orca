export { deriveParentSemanticOutcome } from './coordinated-parent-semantic-outcome'
import type {
  Automation,
  AutomationRun,
  CoordinatedAutomationCeilings
} from '../../../../shared/automations-types'
import type {
  CoordinatedRunLiveObservation,
  FrozenStageSource,
  OccupiedMutationLaneObservation,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-types'

export type ProjectedCoordinatedBudgets = {
  elapsedSeconds: number | null
  maxWallClockSeconds: number | null
  wallClockExceeded: boolean
  estimatedCostUsd: number | null
  maxEstimatedCostUsd: number | null
  costExceeded: boolean
  totalTokens: number | null
  activeConcurrency: number
  maxConcurrency: number | null
  concurrencyAtCeiling: boolean
  activeFixersCount: number
  maxActiveFixersPerArtifact: number | null
  maxReviewIterationsUsed: number
  maxReviewIterationsCeiling: number | null
  reviewLimitReached: boolean
  dispatchStartFailuresCount: number
  maxDispatchStartFailuresCeiling: number
  circuitBreakerTripped: boolean
  occupiedMutationLanes: readonly OccupiedMutationLaneObservation[]
}

export type ProjectedCoordinatedStageCounts = {
  total: number
  ready: number
  queued: number
  active: number
  waitingForApproval: number
  blocked: number
  accepted: number
  superseded: number
  failed: number
  uncertain: number
  skipped: number
}

export function extractStageSources(
  automation: Automation,
  run: AutomationRun
): FrozenStageSource[] {
  if (run.resolvedSnapshot) {
    return run.resolvedSnapshot.resolvedChildren.map((child) => ({
      childDefinitionId: child.childDefinitionId,
      name: child.name,
      role: child.role,
      enabled: child.enabled,
      dependencies: child.dependencies,
      mutationClass: child.mutationClass,
      mutationLane: child.mutationLane ?? null,
      launchConfig: child.launchConfig,
      promptSummary: {
        kind: child.prompt.kind,
        text: child.prompt.text,
        path: child.prompt.path,
        digest: child.prompt.digest
      },
      requiredArtifacts: child.stageAcceptance?.requiredArtifacts ?? [],
      requiredChecks: child.stageAcceptance?.requiredChecks ?? [],
      requiredApprovals: child.stageAcceptance?.requiredApprovals ?? []
    }))
  }
  if (run.retainedEvidence) {
    return run.retainedEvidence.children.map((child) => ({
      childDefinitionId: child.childDefinitionId,
      name: child.name,
      role: child.role,
      enabled: true,
      dependencies: [],
      mutationClass: 'read_only',
      mutationLane: null,
      launchConfig: {},
      promptSummary: null,
      requiredArtifacts: [],
      requiredChecks: [],
      requiredApprovals: []
    }))
  }
  return (automation.children ?? []).map((child) => ({
    childDefinitionId: child.id,
    name: child.name,
    role: child.role,
    enabled: child.enabled,
    dependencies: child.dependencies,
    mutationClass: child.mutationClass,
    mutationLane: child.mutationLane ?? null,
    launchConfig: child.launchConfig,
    promptSummary:
      child.promptSource.kind === 'inline'
        ? { kind: 'inline', text: child.promptSource.text }
        : {
            kind: 'source_reference',
            text: child.promptSource.path,
            path: child.promptSource.path,
            digest: child.promptSource.digest
          },
    requiredArtifacts: child.stageAcceptance?.requiredArtifacts ?? [],
    requiredChecks: child.stageAcceptance?.requiredChecks ?? [],
    requiredApprovals: child.stageAcceptance?.requiredApprovals ?? []
  }))
}

export function computeCoordinatedBudgetsAndCounts(input: {
  run: AutomationRun
  stages: readonly ProjectedCoordinatedStage[]
  ceilings: CoordinatedAutomationCeilings | undefined
  observation: CoordinatedRunLiveObservation | null | undefined
  now: number | undefined
}): {
  stageCounts: ProjectedCoordinatedStageCounts
  budgetsAndCeilings: ProjectedCoordinatedBudgets
} {
  const { run, stages, ceilings, observation, now } = input
  const stageCounts: ProjectedCoordinatedStageCounts = {
    total: stages.length,
    ready: stages.filter((s) => s.stageExecutionStatus === 'ready').length,
    queued: stages.filter((s) => s.stageExecutionStatus === 'queued').length,
    active: stages.filter((s) => s.stageExecutionStatus === 'active').length,
    waitingForApproval: stages.filter((s) => s.stageExecutionStatus === 'waiting_for_approval')
      .length,
    blocked: stages.filter((s) => s.stageExecutionStatus === 'blocked').length,
    accepted: stages.filter((s) => s.stageExecutionStatus === 'accepted').length,
    superseded: stages.filter((s) => s.stageExecutionStatus === 'superseded').length,
    failed: stages.filter((s) => s.stageExecutionStatus === 'failed').length,
    uncertain: stages.filter((s) => s.stageExecutionStatus === 'uncertain').length,
    skipped: stages.filter((s) => s.stageExecutionStatus === 'skipped').length
  }

  const stageDurationSum = stages.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0)
  const elapsedSeconds =
    observation?.elapsedWallClockSeconds ??
    (stageDurationSum > 0
      ? stageDurationSum
      : run.startedAt && now && now >= run.startedAt
        ? Math.round((now - run.startedAt) / 1000)
        : null)
  const stageCostSum = stages.reduce((acc, s) => acc + (s.estimatedCostUsd ?? 0), 0)
  const estimatedCostUsd =
    run.usage?.status === 'known' && run.usage.estimatedCostUsd !== null
      ? run.usage.estimatedCostUsd
      : stageCostSum > 0
        ? stageCostSum
        : null
  const stageTokensSum = stages.reduce((acc, s) => acc + (s.totalTokens ?? 0), 0)
  const totalTokens =
    run.usage?.status === 'known' && run.usage.totalTokens !== null
      ? run.usage.totalTokens
      : stageTokensSum > 0
        ? stageTokensSum
        : null
  const maxReviewIterationsUsed = stages.reduce(
    (max, s) => Math.max(max, s.reviewIteration ?? 0),
    0
  )
  const maxReviewCeiling = ceilings?.maxReviewIterations ?? null
  const maxDispatchStartFailuresCeiling = ceilings?.maxDispatchStartFailures ?? 3
  const dispatchStartFailuresCount = observation?.dispatchStartFailuresCount ?? 0

  return {
    stageCounts,
    budgetsAndCeilings: {
      elapsedSeconds,
      maxWallClockSeconds: ceilings?.maxWallClockSeconds ?? null,
      wallClockExceeded:
        ceilings?.maxWallClockSeconds != null &&
        elapsedSeconds !== null &&
        elapsedSeconds >= ceilings.maxWallClockSeconds,
      estimatedCostUsd,
      maxEstimatedCostUsd: ceilings?.maxEstimatedCostUsd ?? null,
      costExceeded:
        ceilings?.maxEstimatedCostUsd != null &&
        estimatedCostUsd !== null &&
        estimatedCostUsd >= ceilings.maxEstimatedCostUsd,
      totalTokens,
      activeConcurrency: stageCounts.active,
      maxConcurrency: ceilings?.maxConcurrency ?? null,
      concurrencyAtCeiling:
        ceilings?.maxConcurrency != null && stageCounts.active >= ceilings.maxConcurrency,
      activeFixersCount: observation?.activeFixersCount ?? 0,
      maxActiveFixersPerArtifact: ceilings?.maxActiveFixersPerArtifact ?? null,
      maxReviewIterationsUsed,
      maxReviewIterationsCeiling: maxReviewCeiling,
      reviewLimitReached: maxReviewCeiling !== null && maxReviewIterationsUsed >= maxReviewCeiling,
      dispatchStartFailuresCount,
      maxDispatchStartFailuresCeiling,
      circuitBreakerTripped: dispatchStartFailuresCount >= maxDispatchStartFailuresCeiling,
      occupiedMutationLanes: observation?.occupiedMutationLanes ?? []
    }
  }
}
