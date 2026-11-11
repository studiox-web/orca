import { translate } from '@/i18n/i18n'
import { scopedCoordinatedEvidence } from './coordinated-run-observation-scope'
import type {
  Automation,
  AutomationExecutionTargetType,
  AutomationOutcomeContract,
  AutomationRun,
  AutomationRunStatus,
  CoordinatedCompletionTrust,
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase,
  CoordinatedRunQuarantineSummary,
  CoordinatedRunRetainedEvidence,
  ResolvedAutomationRunSnapshot,
  SemanticCompletionReceipt
} from '../../../../shared/automations-types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  computeCoordinatedBudgetsAndCounts,
  deriveParentSemanticOutcome,
  extractStageSources,
  type ProjectedCoordinatedBudgets,
  type ProjectedCoordinatedStageCounts
} from './coordinated-automation-run-summary'
import { projectCoordinatedStage } from './coordinated-automation-stage-projection'
import type {
  CoordinatedApprovalObservation,
  CoordinatedParentSemanticState,
  CoordinatedRunLiveObservation,
  CoordinatedRunOperatorActions,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-types'

export * from './coordinated-automation-run-types'
export type { ProjectedCoordinatedBudgets, ProjectedCoordinatedStageCounts }

export type ProjectedCoordinatedRun = {
  automationId: string
  automationName: string
  definitionRevision: number
  currentAutomationRevision: number
  automationRunId: string
  orchestrationRunId: string | null
  executionTargetType: AutomationExecutionTargetType
  targetExecutionAuthority: string
  hostLabel: string
  workspaceLabel: string
  isFolderWorkspace: boolean
  isRemoteAuthority: boolean
  selectedOutcomeItemIdentity: string | null
  replanOfAutomationRunId: string | null
  replanOfDefinitionRevision: number | null
  replanReason: string | null
  lifecycleState: 'enabled' | 'paused'
  scheduleState: {
    rrule: string
    nextRunAt: number
    enabled: boolean
    missedRunGraceMinutes: number
    precheckEnabled: boolean
  }
  technicalRunStatus: AutomationRunStatus
  materializationPhase: CoordinatedRunMaterializationPhase | null
  materializationError: string | null
  semanticOutcomeState: CoordinatedParentSemanticState
  semanticOutcomeReason: string
  outcomeContract: AutomationOutcomeContract | null
  quarantine: CoordinatedRunQuarantineSummary | null
  retainedEvidence: CoordinatedRunRetainedEvidence | null
  resolvedSnapshot: ResolvedAutomationRunSnapshot | null
  completionReceipt: SemanticCompletionReceipt | null
  completionTrust: CoordinatedCompletionTrust | null
  childMappings: readonly CoordinatedRunChildMapping[]
  stages: readonly ProjectedCoordinatedStage[]
  stageCounts: ProjectedCoordinatedStageCounts
  budgetsAndCeilings: ProjectedCoordinatedBudgets
  parentApprovals: readonly CoordinatedApprovalObservation[]
  hasUncertainEffects: boolean
  hasPendingQuestions: boolean
  hasBlockers: boolean
  stopEligibility: { canStop: boolean; reason: string | null }
}

export function projectCoordinatedAutomationRun(input: {
  automation: Automation
  run: AutomationRun
  observation?: CoordinatedRunLiveObservation | null
  operatorActions?: CoordinatedRunOperatorActions | null
  options?: {
    hostLabel?: string | null
    workspaceLabel?: string | null
    isFolderWorkspace?: boolean
    isFeatureFlagEnabled?: boolean
    now?: number
  }
}): ProjectedCoordinatedRun {
  const { automation, operatorActions, options } = input
  const { run, observation } = scopedCoordinatedEvidence(automation, input.run, input.observation)
  const isFeatureFlagEnabled = options?.isFeatureFlagEnabled ?? true
  const snapshot = run.resolvedSnapshot ?? null
  const definitionRevision =
    run.automationDefinitionRevision ??
    snapshot?.definitionRevision ??
    run.retainedEvidence?.definitionRevision ??
    automation.definitionRevision ??
    1
  const quarantine: CoordinatedRunQuarantineSummary | null = run.coordinatedQuarantine
    ? {
        reason: run.coordinatedQuarantine.reason,
        payloadDigest: run.coordinatedQuarantine.payloadDigest,
        payloadRetained:
          'payloadRetained' in run.coordinatedQuarantine
            ? run.coordinatedQuarantine.payloadRetained
            : run.coordinatedQuarantine.payload !== null
      }
    : null

  const targetType = snapshot?.executionTarget.type ?? automation.executionTargetType
  const targetId = snapshot?.executionTarget.id ?? automation.executionTargetId
  const targetExecutionAuthority =
    run.retainedEvidence?.executionAuthority ?? `${targetType}:${targetId}`
  const isRemoteAuthority =
    targetType === 'ssh' ||
    targetExecutionAuthority.startsWith('ssh:') ||
    targetExecutionAuthority.startsWith('runtime:')
  const isFolderWorkspace =
    options?.isFolderWorkspace ??
    (parseWorkspaceKey(run.workspaceId ?? '')?.type === 'folder' ||
      (run.workspaceId?.startsWith('folder:') ?? false))

  const hostLabel = options?.hostLabel ?? targetExecutionAuthority
  const workspaceLabel =
    options?.workspaceLabel ??
    run.workspaceDisplayName ??
    run.workspaceId ??
    (automation.workspaceMode === 'new_per_run'
      ? translate(
          'auto.components.automations.coordinated.automation.run.projection.09b3511f8a',
          'New workspace per run'
        )
      : translate(
          'auto.components.automations.coordinated.automation.run.projection.5ea6fa8583',
          'Default workspace'
        ))

  const childMappings = run.childMappings ?? run.completionReceipt?.identityChain.taskMappings ?? []
  const mappingByChild = new Map(childMappings.map((m) => [m.childDefinitionId, m]))
  const sources = extractStageSources(automation, run)

  const acceptedStageIds = new Set<string>()
  const completedStageIds = new Set<string>()
  for (const s of observation?.stageAcceptances ?? []) {
    if (s.status === 'accepted' || s.status === 'waived') {
      acceptedStageIds.add(s.childDefinitionId)
      completedStageIds.add(s.childDefinitionId)
    }
  }
  for (const a of observation?.attempts ?? []) {
    if (a.technicalStatus === 'completed') {
      completedStageIds.add(a.childDefinitionId)
    }
  }
  if (run.completionReceipt) {
    for (const m of run.completionReceipt.identityChain.taskMappings) {
      acceptedStageIds.add(m.childDefinitionId)
      completedStageIds.add(m.childDefinitionId)
    }
  }

  const stages = sources.map((source) => {
    const mapping = mappingByChild.get(source.childDefinitionId)
    return projectCoordinatedStage({
      source,
      automation,
      run,
      runRevision: definitionRevision,
      mappedTaskId: mapping?.taskId ?? null,
      mappedDispatchId: mapping?.dispatchId ?? null,
      observation,
      operatorActions,
      acceptedStageIds,
      completedStageIds,
      isFeatureFlagEnabled,
      isQuarantined: quarantine !== null,
      hostLabel
    })
  })

  const outcomeContract = snapshot?.outcomeContract ?? automation.outcomeContract ?? null
  const parentApprovals: CoordinatedApprovalObservation[] = [
    ...(observation?.parentApprovals ?? [])
  ]
  for (const req of outcomeContract?.requiredApprovals ?? []) {
    if (!parentApprovals.some((a) => a.approvalId === req.id)) {
      const receiptApp = run.completionReceipt?.approvals.find((a) => a.approvalId === req.id)
      parentApprovals.push({
        approvalId: req.id,
        role: req.role,
        description: req.description,
        disallowAuthorApproval: req.disallowAuthorApproval,
        status: receiptApp ? 'approved' : 'pending',
        approverIdentity: receiptApp?.approverIdentity ?? null,
        authorIdentity: receiptApp?.authorIdentity ?? null,
        approvedAt: receiptApp?.approvedAt ?? null,
        evidence: receiptApp?.evidence ?? null,
        scope: {
          automationRunId: run.id,
          orchestrationRunId: run.orchestrationRunId ?? null,
          childDefinitionId: req.targetChildId
        }
      })
    }
  }

  const { stageCounts, budgetsAndCeilings } = computeCoordinatedBudgetsAndCounts({
    run,
    stages,
    ceilings: snapshot?.globalCeilings ?? automation.globalCeilings,
    observation,
    now: options?.now
  })

  const semantic = deriveParentSemanticOutcome({ run, quarantine, stages, parentApprovals })
  const isRunInFlight =
    run.status === 'pending' ||
    run.status === 'dispatching' ||
    run.status === 'dispatched' ||
    stageCounts.active > 0
  const stopAvailability = operatorActions?.stopRun?.availability
  const stopReason = !isFeatureFlagEnabled
    ? translate(
        'auto.components.automations.coordinated.automation.run.projection.0f27295e39',
        'Coordinated automations feature flag is disabled.'
      )
    : quarantine
      ? translate(
          'auto.components.automations.coordinated.automation.run.projection.9d0b915442',
          'Run is quarantined due to integrity validation failure.'
        )
      : !isRunInFlight
        ? translate(
            'auto.components.automations.coordinated.automation.run.projection.7f6ad37f78',
            'Run is already settled and has no active workers to stop.'
          )
        : !stopAvailability?.supported || !operatorActions?.stopRun?.onStopRun
          ? (stopAvailability?.reason ??
            translate(
              'auto.components.automations.coordinated.automation.run.projection.08fc36ae58',
              'Host stop-run operation binding is not yet connected.'
            ))
          : null

  return {
    automationId: automation.id,
    automationName: automation.name,
    definitionRevision,
    currentAutomationRevision: automation.definitionRevision ?? 1,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? null,
    executionTargetType: targetType,
    targetExecutionAuthority,
    hostLabel,
    workspaceLabel,
    isFolderWorkspace,
    isRemoteAuthority,
    selectedOutcomeItemIdentity: run.completionReceipt?.selectedOutcomeItemIdentity ?? null,
    replanOfAutomationRunId: run.replanOfAutomationRunId ?? null,
    replanOfDefinitionRevision: run.replanOfDefinitionRevision ?? null,
    replanReason: run.replanReason ?? null,
    lifecycleState: automation.enabled ? 'enabled' : 'paused',
    scheduleState: {
      rrule: automation.rrule,
      nextRunAt: automation.nextRunAt,
      enabled: automation.enabled,
      missedRunGraceMinutes: automation.missedRunGraceMinutes,
      precheckEnabled: automation.precheck !== null
    },
    technicalRunStatus: run.status,
    materializationPhase: run.materializationPhase ?? null,
    materializationError: run.materializationError ?? null,
    semanticOutcomeState: semantic.state,
    semanticOutcomeReason: semantic.reason,
    outcomeContract,
    quarantine,
    retainedEvidence: run.retainedEvidence ?? null,
    resolvedSnapshot: snapshot,
    completionReceipt: run.completionReceipt ?? null,
    completionTrust: run.completionTrust ?? null,
    childMappings,
    stages,
    stageCounts,
    budgetsAndCeilings,
    parentApprovals,
    hasUncertainEffects: stages.some((s) => s.hasUncertainEffect),
    hasPendingQuestions: stages.some((s) => s.pendingQuestion !== null),
    hasBlockers: stages.some((s) => s.blockers.length > 0),
    stopEligibility: { canStop: stopReason === null, reason: stopReason }
  }
}
