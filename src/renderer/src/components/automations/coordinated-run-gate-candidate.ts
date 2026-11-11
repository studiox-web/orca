import type {
  CoordinatedPendingDecision,
  CoordinatedStagePendingApprovalView
} from '../../../../shared/coordinated-automation-run-inspection'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import type {
  ResolveCoordinatedGateInput,
  StopCoordinatedRunInput
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import { coordinatedRunBindingKey, type CoordinatedRunBinding } from './coordinated-run-api-client'

export type CoordinatedGateCandidate = {
  bindingKey: string
  canonicalDigest: string | null
  base: StopCoordinatedRunInput
  gate: CoordinatedPendingDecision
  taskId: string | null
  heldReport?: CoordinatedStagePendingApprovalView
  approveUnavailableReason: string | null
}

export type CoordinatedGateAction = CoordinatedPendingDecision & {
  kind: 'gate'
  candidate: CoordinatedGateCandidate
  decision: ResolveCoordinatedGateInput['decision']
  note?: string
}

export function pendingGateKey(gate: CoordinatedPendingDecision): string {
  return JSON.stringify([gate.scope, gate.childDefinitionId, gate.gateId])
}

export function approveRefusal(
  view: CoordinatedRunView,
  gate: CoordinatedPendingDecision
): string | null {
  if (gate.scope !== 'stage') {
    return null
  }
  const stage = view.inspection.stages.find(
    (entry) => entry.childDefinitionId === gate.childDefinitionId
  )
  const held = stage?.pendingApproval
  if (!held) {
    return 'Approval requires the available held report.'
  }
  if (held.report.kind !== 'available') {
    return `Approval requires the available held report. Report ${held.report.kind}: ${held.report.reason}`
  }
  if (
    !stage.taskId ||
    !held.dispatchId ||
    !held.reportDigest ||
    !stage.gateResolutionEligibility.canResolve ||
    stage.gateResolutionEligibility.approvableDispatchId !== held.dispatchId ||
    !stage.gateResolutionEligibility.pendingGateIds.includes(gate.gateId) ||
    !held.gateIds.includes(gate.gateId)
  ) {
    return 'The held report is not eligible for this stage approval.'
  }
  return null
}

function runScope(view: CoordinatedRunView): StopCoordinatedRunInput {
  const { inspection } = view
  if (!inspection.targetExecutionAuthority) {
    throw new Error('The host reports no frozen execution authority. Nothing was submitted.')
  }
  return {
    runtimeId: view.runtimeId,
    automationId: inspection.automationId,
    automationRunId: inspection.automationRunId,
    expectedOwner: { selector: { kind: 'self' } },
    orchestrationRunId: inspection.orchestrationRunId,
    definitionRevision: inspection.definitionRevision,
    targetExecutionAuthority: inspection.targetExecutionAuthority
  }
}

export function captureCoordinatedGateCandidate(
  binding: CoordinatedRunBinding,
  view: CoordinatedRunView,
  gate: CoordinatedPendingDecision
): CoordinatedGateCandidate {
  const stage =
    gate.scope === 'stage'
      ? view.inspection.stages.find((entry) => entry.childDefinitionId === gate.childDefinitionId)
      : undefined
  return structuredClone({
    bindingKey: coordinatedRunBindingKey(binding),
    canonicalDigest: view.inspection.canonicalDigest,
    base: runScope(view),
    gate: { scope: gate.scope, gateId: gate.gateId, childDefinitionId: gate.childDefinitionId },
    taskId: stage?.taskId ?? null,
    ...(stage?.pendingApproval ? { heldReport: stage.pendingApproval } : {}),
    approveUnavailableReason: approveRefusal(view, gate)
  })
}

export function coordinatedGateParams(
  binding: CoordinatedRunBinding,
  view: CoordinatedRunView,
  action: CoordinatedGateAction,
  replay: boolean
): ResolveCoordinatedGateInput {
  const candidate = action.candidate
  const stage = view.inspection.stages.find(
    (entry) => entry.childDefinitionId === action.childDefinitionId
  )
  if (
    !candidate ||
    candidate.bindingKey !== coordinatedRunBindingKey(binding) ||
    JSON.stringify(candidate.base) !== JSON.stringify(runScope(view)) ||
    candidate.canonicalDigest !== view.inspection.canonicalDigest ||
    pendingGateKey(candidate.gate) !== pendingGateKey(action) ||
    (action.scope === 'stage' && (!stage || candidate.taskId !== stage.taskId))
  ) {
    throw new Error(
      'The decision scope changed since it was opened. Nothing was submitted; reopen the decision.'
    )
  }
  if (!replay) {
    if (!view.actions.humanResolution.available) {
      throw new Error(view.actions.humanResolution.reason)
    }
    if (
      !view.inspection.humanResolution.pendingDecisions.some(
        (gate) => pendingGateKey(gate) === pendingGateKey(action)
      )
    ) {
      throw new Error(
        'The host no longer reports this decision as pending in this scope. Nothing was submitted.'
      )
    }
  }
  const approval = action.scope === 'stage' && action.decision === 'approve'
  const held = candidate.heldReport
  if (approval) {
    if (candidate.approveUnavailableReason || !held || held.report.kind !== 'available') {
      throw new Error(
        `${candidate.approveUnavailableReason ?? 'Approval requires the available held report.'} Nothing was submitted.`
      )
    }
    const current = stage?.pendingApproval
    // A settled replay may have no hold; only the original payload can ask for its receipt.
    if (
      replay &&
      !current &&
      stage &&
      ((stage.native.kind === 'available' && stage.native.latestDispatchId !== held.dispatchId) ||
        (stage.semantic.kind === 'available' &&
          stage.semantic.activeDispatchId !== held.dispatchId))
    ) {
      throw new Error(
        'The stage has a different attempt. The original approval is retained; nothing was submitted.'
      )
    }
    if (!replay || current) {
      const refusal = replay
        ? current?.report.kind === 'available'
          ? null
          : 'The held report is no longer available.'
        : approveRefusal(view, action)
      if (refusal) {
        throw new Error(`${refusal} Nothing was submitted.`)
      }
      if (
        current?.dispatchId !== held.dispatchId ||
        current.reportDigest !== held.reportDigest ||
        JSON.stringify(current.report) !== JSON.stringify(held.report)
      ) {
        throw new Error(
          'The held report changed since this decision was opened. Nothing was submitted; review the current report.'
        )
      }
    }
  }
  return {
    ...candidate.base,
    gateScope: candidate.gate.scope,
    gateId: candidate.gate.gateId,
    decision: action.decision,
    ...(action.note ? { note: action.note } : {}),
    ...(action.scope !== 'parent' && candidate.gate.childDefinitionId
      ? { childDefinitionId: candidate.gate.childDefinitionId }
      : {}),
    ...(action.scope === 'stage' && candidate.taskId ? { taskId: candidate.taskId } : {}),
    ...(approval && held
      ? { dispatchId: held.dispatchId, expectedReportDigest: held.reportDigest }
      : {})
  }
}
