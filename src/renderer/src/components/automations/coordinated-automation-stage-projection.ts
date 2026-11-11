import { translate } from '@/i18n/i18n'
import type {
  Automation,
  AutomationRun,
  StageAcceptanceStatus
} from '../../../../shared/automations-types'
import {
  deriveStageExecutionStatus,
  detectDefinitionDrift,
  projectCoordinatedAttempt
} from './coordinated-automation-attempt-projection'
import type {
  CoordinatedApprovalObservation,
  CoordinatedDispatchAttemptObservation,
  CoordinatedRunLiveObservation,
  CoordinatedRunOperatorActions,
  FrozenStageSource,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-types'

export type { FrozenStageSource }

export function projectCoordinatedStage(input: {
  source: FrozenStageSource
  automation: Automation
  run: AutomationRun
  runRevision: number
  mappedTaskId: string | null
  mappedDispatchId: string | null
  observation: CoordinatedRunLiveObservation | null | undefined
  operatorActions: CoordinatedRunOperatorActions | null | undefined
  acceptedStageIds: ReadonlySet<string>
  completedStageIds: ReadonlySet<string>
  isFeatureFlagEnabled: boolean
  isQuarantined: boolean
  hostLabel: string | null
}): ProjectedCoordinatedStage {
  const { source, automation, run, mappedTaskId, mappedDispatchId, observation } = input
  const driftInfo = detectDefinitionDrift(source, automation, input.runRevision)
  const latestAcceptance =
    (observation?.stageAcceptances ?? []).findLast(
      (s) =>
        s.childDefinitionId === source.childDefinitionId &&
        s.automationRunId === run.id &&
        s.orchestrationRunId === run.orchestrationRunId &&
        s.taskId === mappedTaskId &&
        s.dispatchId === mappedDispatchId
    ) ?? null

  const rawAttempts = (observation?.attempts ?? []).filter(
    (a) =>
      a.childDefinitionId === source.childDefinitionId &&
      (mappedTaskId === null || a.taskId === mappedTaskId)
  )
  const synthesizedAttempts: CoordinatedDispatchAttemptObservation[] = [...rawAttempts]
  if (
    mappedTaskId &&
    mappedDispatchId &&
    !rawAttempts.some((a) => a.dispatchId === mappedDispatchId)
  ) {
    synthesizedAttempts.push({
      dispatchId: mappedDispatchId,
      taskId: mappedTaskId,
      childDefinitionId: source.childDefinitionId,
      technicalStatus: 'outcome_unknown'
    })
  }

  const fallbackAgent = source.launchConfig.agentId ?? automation.agentId
  const projectedAttempts = synthesizedAttempts.map((obs, index) =>
    projectCoordinatedAttempt({
      obs,
      index,
      activeDispatchId: mappedDispatchId ?? synthesizedAttempts.at(-1)?.dispatchId ?? null,
      stageAcceptance: latestAcceptance,
      crewSnapshot: observation?.crewSnapshot,
      fallbackAgent,
      fallbackHostLabel: input.hostLabel
    })
  )

  const activeAttempt =
    projectedAttempts.find((a) => a.isActive) ?? projectedAttempts.at(-1) ?? null
  const supersededAttemptsCount = projectedAttempts.filter((a) => !a.isActive).length
  const runCompletedWithReceipt =
    run.completionReceipt !== null &&
    run.completionReceipt?.identityChain.taskMappings.some(
      (m) => m.childDefinitionId === source.childDefinitionId
    ) === true

  const semanticAcceptanceStatus: StageAcceptanceStatus | 'unverified' = runCompletedWithReceipt
    ? 'accepted'
    : (latestAcceptance?.status ?? activeAttempt?.semanticAcceptanceStatus ?? 'pending')

  const stageApprovals: CoordinatedApprovalObservation[] = (
    observation?.stageApprovals ?? []
  ).filter((a) => a.scope.childDefinitionId === source.childDefinitionId)
  for (const req of source.requiredApprovals) {
    if (!stageApprovals.some((a) => a.approvalId === req.id)) {
      const receiptApproval = run.completionReceipt?.approvals.find((a) => a.approvalId === req.id)
      stageApprovals.push({
        approvalId: req.id,
        role: req.role,
        description: req.description,
        disallowAuthorApproval: req.disallowAuthorApproval,
        status: receiptApproval ? 'approved' : 'pending',
        approverIdentity: receiptApproval?.approverIdentity ?? null,
        authorIdentity: receiptApproval?.authorIdentity ?? null,
        approvedAt: receiptApproval?.approvedAt ?? null,
        evidence: receiptApproval?.evidence ?? null,
        scope: {
          automationRunId: run.id,
          orchestrationRunId: run.orchestrationRunId ?? null,
          childDefinitionId: source.childDefinitionId,
          taskId: mappedTaskId ?? undefined,
          dispatchId: activeAttempt?.dispatchId ?? mappedDispatchId ?? undefined
        }
      })
    }
  }

  const effects = activeAttempt?.effects ?? []
  const blockers = activeAttempt?.blockers ?? []
  const hasUncertainEffect = effects.some((e) => e.status === 'uncertain')
  const hasPendingApproval = stageApprovals.some((a) => a.status === 'pending')
  const skippedReason = !source.enabled
    ? translate(
        'auto.components.automations.coordinated.automation.stage.projection.3eec909757',
        'Disabled in frozen run snapshot'
      )
    : (observation?.skippedStages?.[source.childDefinitionId] ?? null)

  const upstreamSatisfied = source.dependencies.every((dep) =>
    (dep.condition ?? 'accepted') === 'completed'
      ? input.completedStageIds.has(dep.childId)
      : input.acceptedStageIds.has(dep.childId)
  )

  const stageExecutionStatus = deriveStageExecutionStatus({
    enabledInSnapshot: source.enabled,
    skippedReason,
    activeAttempt,
    attempts: projectedAttempts,
    semanticAcceptanceStatus,
    hasUncertainEffect,
    hasPendingApproval,
    hasBlocker: blockers.length > 0,
    upstreamSatisfied,
    runCompletedWithReceipt
  })

  const technicalStatusLabel = !source.enabled
    ? translate('auto.components.automations.coordinatedLabels.disabled', 'Disabled')
    : activeAttempt
      ? activeAttempt.technicalStatus
      : mappedTaskId
        ? 'materialized'
        : 'not_materialized'

  const retryOfDispatchId = activeAttempt?.dispatchId ?? mappedDispatchId ?? null
  const isRetryableState = stageExecutionStatus === 'failed' || stageExecutionStatus === 'blocked'
  const retryAvailability = input.operatorActions?.retryStage?.availability
  const retryReason = !input.isFeatureFlagEnabled
    ? translate(
        'auto.components.automations.coordinated.automation.stage.projection.0f27295e39',
        'Coordinated automations feature flag is disabled.'
      )
    : input.isQuarantined
      ? translate(
          'auto.components.automations.coordinated.automation.stage.projection.9d0b915442',
          'Run is quarantined due to integrity validation failure.'
        )
      : hasUncertainEffect
        ? translate(
            'auto.components.automations.coordinated.automation.stage.projection.24c8098734',
            'Retry is blocked after an uncertain external effect; reconcile receipt and external state first.'
          )
        : !mappedTaskId || !retryOfDispatchId || !run.orchestrationRunId
          ? translate(
              'auto.components.automations.coordinated.automation.stage.projection.59e7319386',
              'Stage has no materialized Task or prior Dispatch attempt to retry.'
            )
          : !isRetryableState
            ? translate(
                'auto.components.automations.coordinated.automation.stage.projection.25c9e3078c',
                'Only failed or blocked stages can be retried.'
              )
            : !retryAvailability?.supported || !input.operatorActions?.retryStage?.onRetryStage
              ? (retryAvailability?.reason ??
                translate(
                  'auto.components.automations.coordinated.automation.stage.projection.d478d09ac6',
                  'Host stage-retry operation binding is not yet connected.'
                ))
              : null

  const pendingGate =
    stageApprovals.find((a) => a.status === 'pending')?.approvalId ??
    (hasUncertainEffect ? `uncertain-effect:${source.childDefinitionId}` : null)
  const gateAvailability = input.operatorActions?.resolveGate?.availability
  const gateReason = !input.isFeatureFlagEnabled
    ? translate(
        'auto.components.automations.coordinated.automation.stage.projection.0f27295e39',
        'Coordinated automations feature flag is disabled.'
      )
    : input.isQuarantined
      ? translate(
          'auto.components.automations.coordinated.automation.stage.projection.9d0b915442',
          'Run is quarantined due to integrity validation failure.'
        )
      : !pendingGate
        ? translate(
            'auto.components.automations.coordinated.automation.stage.projection.d09166bfc6',
            'No pending approval or uncertainty gate on this stage.'
          )
        : !run.orchestrationRunId
          ? translate(
              'auto.components.automations.coordinated.automation.stage.projection.afdb492cb7',
              'Run has no linked orchestration Run.'
            )
          : !gateAvailability?.supported || !input.operatorActions?.resolveGate?.onResolveGate
            ? (gateAvailability?.reason ??
              translate(
                'auto.components.automations.coordinated.automation.stage.projection.7bd8d66152',
                'Host gate-resolution operation binding is not yet connected.'
              ))
            : null

  return {
    childDefinitionId: source.childDefinitionId,
    name: source.name,
    role: source.role,
    definitionDrift: driftInfo.drift,
    currentDefinitionName: driftInfo.currentName,
    tombstonedInRevision: driftInfo.tombstonedInRevision,
    enabledInSnapshot: source.enabled,
    taskId: mappedTaskId,
    activeDispatchId: activeAttempt?.dispatchId ?? mappedDispatchId,
    dependencies: source.dependencies,
    mutationClass: source.mutationClass,
    mutationLane: source.mutationLane,
    launchConfig: source.launchConfig,
    promptSummary: source.promptSummary,
    stageExecutionStatus,
    skippedReason,
    technicalStatusLabel,
    semanticAcceptanceStatus,
    acceptanceEvidence: latestAcceptance?.acceptanceEvidence ?? [],
    unmetCriteria: latestAcceptance?.unmetCriteria ?? [],
    attempts: projectedAttempts,
    activeAttempt,
    supersededAttemptsCount,
    artifacts: activeAttempt?.artifacts ?? [],
    requiredArtifacts: source.requiredArtifacts,
    checks: activeAttempt?.checks ?? [],
    requiredChecks: source.requiredChecks,
    effects,
    blockers,
    approvals: stageApprovals,
    pendingQuestion: activeAttempt?.pendingQuestion ?? null,
    hasUncertainEffect,
    durationSeconds: activeAttempt?.durationSeconds ?? null,
    estimatedCostUsd: activeAttempt?.estimatedCostUsd ?? null,
    totalTokens: activeAttempt?.totalTokens ?? null,
    reviewIteration: activeAttempt?.reviewIteration ?? null,
    maxReviewIterations: source.launchConfig.maxReviewIterations ?? null,
    maxRetries: source.launchConfig.maxRetries ?? null,
    timeoutSeconds: source.launchConfig.timeoutSeconds ?? null,
    retryEligibility: { canRetry: retryReason === null, reason: retryReason, retryOfDispatchId },
    gateResolutionEligibility: {
      canResolve: gateReason === null,
      reason: gateReason,
      pendingGateId: pendingGate
    }
  }
}
