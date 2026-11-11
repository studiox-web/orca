import {
  CoordinatedStageGateCandidateSchema,
  type CoordinatedStageGateCandidate
} from '../../shared/coordinated-automation-gate-candidate'
import type { AutomationRun } from '../../shared/automations-types'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { CoordinatedGateScope } from '../../shared/coordinated-automation-run-inspection'
import type { CoordinatedOperatorScopeInput } from './coordinated-automation-operator-actions'
import type { CoordinatedRecoveryContext } from './coordinated-automation-recovery-context'
import { nativeDispatchLineageProblem } from './coordinated-automation-native-validation'

export type CoordinatedOperatorGateInput = CoordinatedOperatorScopeInput & {
  gateId: string
  stageCandidate?: CoordinatedStageGateCandidate
  gateScope?: CoordinatedGateScope
  /** Legacy exact-report pair with dispatchId; never inferred from the current hold. */
  expectedReportDigest?: string
  decision: 'approve' | 'reject' | 'escalate'
  note?: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
}

export function resolveOperatorGateScope(
  ctx: CoordinatedRecoveryContext,
  run: AutomationRun,
  input: CoordinatedOperatorGateInput,
  recorded: CoordinatedRunProgress | null
) {
  const snapshot = run.resolvedSnapshot!
  const wants = (scope: CoordinatedGateScope): boolean =>
    input.gateScope === undefined || input.gateScope === scope
  const stageReqs = wants('stage')
    ? snapshot.resolvedChildren.flatMap((child) =>
        (child.stageAcceptance?.requiredApprovals ?? [])
          .filter(
            (requirement) =>
              requirement.id === input.gateId &&
              (!input.childDefinitionId || child.childDefinitionId === input.childDefinitionId)
          )
          .map((requirement) => ({ child, requirement }))
      )
    : []
  const parentReqs = wants('parent')
    ? snapshot.outcomeContract.requiredApprovals.filter(
        (requirement) => requirement.id === input.gateId
      )
    : []
  const escalations = wants('escalation')
    ? (recorded?.escalations ?? []).filter(
        (entry) => entry.key === input.gateId && entry.requiresHumanDecision
      )
    : []
  if (stageReqs.length + parentReqs.length + escalations.length !== 1) {
    throw new Error(
      `Gate "${input.gateId}" is missing or ambiguous; name one exact gate scope and child.`
    )
  }
  const stageReq = stageReqs[0]
  const parentReq = parentReqs[0]
  const escalation = escalations[0]
  const scope: CoordinatedGateScope = stageReq ? 'stage' : parentReq ? 'parent' : 'escalation'
  const mapping = stageReq
    ? run.childMappings?.find(
        (entry) => entry.childDefinitionId === stageReq.child.childDefinitionId
      )
    : undefined
  const held = stageReq
    ? (recorded?.stages[stageReq.child.childDefinitionId]?.pendingApproval ?? null)
    : null
  const candidate = stageReq ? requestedStageCandidate(input) : null
  if (stageReq) {
    if (
      !stageReq.child.enabled ||
      input.childDefinitionId !== stageReq.child.childDefinitionId ||
      !input.taskId ||
      input.taskId !== mapping?.taskId
    ) {
      throw new Error(`Gate "${input.gateId}" must name its exact enabled stage and mapped Task.`)
    }
    if (candidate?.kind !== 'no_attempt') {
      const problem = nativeDispatchLineageProblem(
        ctx.orchestrationDb,
        ctx.orchestrationDb.getDispatchContextById(candidate!.dispatchId),
        {
          dispatchId: candidate!.dispatchId,
          taskId: input.taskId,
          orchestrationRunId: run.orchestrationRunId!
        }
      )
      if (problem) {
        throw new Error(problem)
      }
    }
  } else if (parentReq) {
    if (
      input.childDefinitionId ||
      input.taskId ||
      input.dispatchId ||
      input.expectedReportDigest ||
      input.stageCandidate
    ) {
      throw new Error(
        `Gate "${input.gateId}" is parent-scoped and must not name stage scope fields.`
      )
    }
  } else if (
    input.childDefinitionId !== (escalation.childDefinitionId ?? undefined) ||
    input.taskId ||
    input.dispatchId ||
    input.expectedReportDigest ||
    input.stageCandidate
  ) {
    throw new Error(`Escalation "${input.gateId}" must name only its exact recorded scope.`)
  }
  return { stageReq, parentReq, escalation, scope, mapping, held, candidate }
}

function requestedStageCandidate(
  input: CoordinatedOperatorGateInput
): CoordinatedStageGateCandidate {
  const candidate =
    input.stageCandidate ??
    (input.dispatchId && input.expectedReportDigest
      ? {
          kind: 'report' as const,
          dispatchId: input.dispatchId,
          reportDigest: input.expectedReportDigest
        }
      : null)
  const parsed = CoordinatedStageGateCandidateSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(
      'A stage decision must name an explicit candidate; a report requires the exact Dispatch and report digest.'
    )
  }
  if (
    (input.dispatchId &&
      (parsed.data.kind === 'no_attempt' || parsed.data.dispatchId !== input.dispatchId)) ||
    (input.expectedReportDigest &&
      (parsed.data.kind !== 'report' || parsed.data.reportDigest !== input.expectedReportDigest))
  ) {
    throw new Error('Stage candidate conflicts with the supplied Dispatch or report digest.')
  }
  return parsed.data
}
