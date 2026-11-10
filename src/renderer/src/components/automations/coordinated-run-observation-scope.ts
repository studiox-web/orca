import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import type {
  CoordinatedApprovalObservation,
  CoordinatedRunLiveObservation
} from './coordinated-automation-run-types'

export type CoordinatedObservationScope = {
  automationId: string
  automationRunId: string
  orchestrationRunId: string | null
  definitionRevision: number
  executionAuthority: string
  canonicalDigest: string
}

export function coordinatedObservationScope(
  run: AutomationRun
): CoordinatedObservationScope | null {
  const snapshot = run.resolvedSnapshot
  const retained = run.retainedEvidence
  const revision =
    run.automationDefinitionRevision ?? snapshot?.definitionRevision ?? retained?.definitionRevision
  const digest = snapshot?.canonicalDigest ?? retained?.canonicalDigest
  const authority = snapshot
    ? `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`
    : retained?.executionAuthority
  if (
    !revision ||
    !digest ||
    !authority ||
    (snapshot &&
      (snapshot.automationId !== run.automationId || snapshot.definitionRevision !== revision))
  ) {
    return null
  }
  return {
    automationId: run.automationId,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? null,
    definitionRevision: revision,
    executionAuthority: authority,
    canonicalDigest: digest
  }
}

export function scopedCoordinatedEvidence(
  automation: Automation,
  source: AutomationRun,
  raw?: CoordinatedRunLiveObservation | null
): { run: AutomationRun; observation: CoordinatedRunLiveObservation | null } {
  const scope = coordinatedObservationScope(source)
  const identity = source.completionReceipt?.identityChain
  const mappings = source.childMappings ?? []
  const receiptValid =
    scope &&
    source.automationId === automation.id &&
    identity &&
    identity.automationId === scope.automationId &&
    identity.automationRunId === scope.automationRunId &&
    identity.orchestrationRunId === scope.orchestrationRunId &&
    identity.definitionRevision === scope.definitionRevision &&
    identity.targetExecutionAuthority === scope.executionAuthority &&
    source.completionReceipt?.frozenConfigDigest === scope.canonicalDigest &&
    identity.taskMappings.length === mappings.length &&
    identity.taskMappings.every((entry) =>
      mappings.some(
        (mapping) =>
          entry.childDefinitionId === mapping.childDefinitionId &&
          entry.taskId === mapping.taskId &&
          entry.dispatchId === mapping.dispatchId
      )
    )
  const run = receiptValid ? source : { ...source, completionReceipt: null, completionTrust: null }
  if (
    !scope ||
    source.automationId !== automation.id ||
    !raw?.scope ||
    (
      [
        'automationId',
        'automationRunId',
        'orchestrationRunId',
        'definitionRevision',
        'executionAuthority',
        'canonicalDigest'
      ] as const
    ).some((key) => raw.scope?.[key] !== scope[key]) ||
    source.coordinatedQuarantine ||
    receiptValid
  ) {
    return { run, observation: null }
  }
  const attemptMatches = (item: { childDefinitionId: string; taskId: string }) =>
    mappings.some(
      (mapping) =>
        mapping.childDefinitionId === item.childDefinitionId && mapping.taskId === item.taskId
    )
  const reportMatches = (item: {
    automationRunId: string
    orchestrationRunId: string
    definitionRevision: number
    resolvedConfigDigest: string
  }) =>
    item.automationRunId === scope.automationRunId &&
    item.orchestrationRunId === scope.orchestrationRunId &&
    item.definitionRevision === scope.definitionRevision &&
    item.resolvedConfigDigest === scope.canonicalDigest
  const acceptanceMatches = (
    item: NonNullable<CoordinatedRunLiveObservation['stageAcceptances']>[number]
  ) =>
    reportMatches(item) &&
    mappings.some(
      (mapping) =>
        mapping.childDefinitionId === item.childDefinitionId &&
        mapping.taskId === item.taskId &&
        mapping.dispatchId === item.dispatchId
    )
  const approvalMatches = (approval: CoordinatedApprovalObservation) => {
    const item = approval.scope
    return (
      item.automationRunId === scope.automationRunId &&
      item.orchestrationRunId === scope.orchestrationRunId &&
      (!item.childDefinitionId ||
        mappings.some(
          (mapping) =>
            mapping.childDefinitionId === item.childDefinitionId &&
            (!item.taskId || item.taskId === mapping.taskId) &&
            (!item.dispatchId || item.dispatchId === mapping.dispatchId)
        )) &&
      (Boolean(item.childDefinitionId) || (!item.taskId && !item.dispatchId))
    )
  }
  const attempts = (raw.attempts ?? []).filter(attemptMatches).map((attempt) => {
    const report = attempt.structuredResult
    const acceptance = attempt.stageAcceptance
    return {
      ...attempt,
      crewRow: null,
      openTarget: null,
      structuredResult:
        report &&
        reportMatches(report) &&
        report.childDefinitionId === attempt.childDefinitionId &&
        report.taskId === attempt.taskId &&
        report.dispatchId === attempt.dispatchId
          ? report
          : null,
      stageAcceptance:
        acceptance &&
        reportMatches(acceptance) &&
        acceptance.childDefinitionId === attempt.childDefinitionId &&
        acceptance.taskId === attempt.taskId &&
        acceptance.dispatchId === attempt.dispatchId
          ? acceptance
          : null
    }
  })
  return {
    run,
    observation: {
      ...raw,
      attempts,
      stageAcceptances: raw.stageAcceptances?.filter(acceptanceMatches),
      stageApprovals: raw.stageApprovals?.filter(approvalMatches),
      parentApprovals: raw.parentApprovals?.filter(approvalMatches),
      occupiedMutationLanes: raw.occupiedMutationLanes?.filter(
        (lane) =>
          mappings.some(
            (mapping) =>
              mapping.childDefinitionId === lane.holderChildId &&
              mapping.taskId === lane.holderTaskId
          ) && lane.waitingTaskIds.every((id) => mappings.some((mapping) => mapping.taskId === id))
      ),
      skippedStages: Object.fromEntries(
        Object.entries(raw.skippedStages ?? {}).filter(([id]) =>
          mappings.some((mapping) => mapping.childDefinitionId === id)
        )
      )
    }
  }
}
