import { translate } from '@/i18n/i18n'
import type {
  CoordinatedPendingDecision,
  CoordinatedStagePendingApprovalView
} from '../../../../shared/coordinated-automation-run-inspection'
import {
  sameStageGateCandidate,
  type CoordinatedStageGateCandidate
} from '../../../../shared/coordinated-automation-gate-candidate'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import type {
  ResolveCoordinatedGateInput,
  StopCoordinatedRunInput
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import { coordinatedRunBindingKey, type CoordinatedRunBinding } from './coordinated-run-binding'

export type CoordinatedGateCandidate = {
  bindingKey: string
  canonicalDigest: string | null
  base: StopCoordinatedRunInput
  gate: CoordinatedPendingDecision
  taskId: string | null
  stageCandidate?: CoordinatedStageGateCandidate | null
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
    return translate(
      'auto.components.automations.coordinated.run.gate.candidate.bef536105e',
      'Approval requires the available held report.'
    )
  }
  if (held.report.kind !== 'available') {
    return translate(
      'auto.components.automations.coordinated.run.gate.candidate.5a023d6ea1',
      'Approval requires the available held report. Report {{value0}}: {{value1}}',
      { value0: held.report.kind, value1: held.report.reason }
    )
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
    return translate(
      'auto.components.automations.coordinated.run.gate.candidate.144266572e',
      'The held report is not eligible for this stage approval.'
    )
  }
  return null
}

function runScope(view: CoordinatedRunView): StopCoordinatedRunInput {
  const { inspection } = view
  if (!inspection.targetExecutionAuthority) {
    throw new Error(
      translate(
        'auto.components.automations.coordinated.run.gate.candidate.43a1efea45',
        'The host reports no frozen execution authority. Nothing was submitted.'
      )
    )
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
    ...(stage
      ? {
          stageCandidate: stage.pendingApproval
            ? {
                kind: 'report' as const,
                dispatchId: stage.pendingApproval.dispatchId,
                reportDigest: stage.pendingApproval.reportDigest
              }
            : (stage.gateResolutionEligibility.stageCandidate ?? null)
        }
      : {}),
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
      translate(
        'auto.components.automations.coordinated.run.gate.candidate.294ca75f91',
        'The decision scope changed since it was opened. Nothing was submitted; reopen the decision.'
      )
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
        translate(
          'auto.components.automations.coordinated.run.gate.candidate.c1498a7982',
          'The host no longer reports this decision as pending in this scope. Nothing was submitted.'
        )
      )
    }
  }
  const approval = action.scope === 'stage' && action.decision === 'approve'
  const held = candidate.heldReport
  if (action.scope === 'stage') {
    if (!candidate.taskId || !candidate.stageCandidate) {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.gate.candidate.97fa3fd260',
          'The host has not identified an exact stage candidate. Nothing was submitted.'
        )
      )
    }
    const current = stage?.pendingApproval
      ? {
          kind: 'report' as const,
          dispatchId: stage.pendingApproval.dispatchId,
          reportDigest: stage.pendingApproval.reportDigest
        }
      : stage?.gateResolutionEligibility.stageCandidate
    if (
      !replay &&
      (!sameStageGateCandidate(candidate.stageCandidate, current) ||
        (held && JSON.stringify(held.report) !== JSON.stringify(stage?.pendingApproval?.report)))
    ) {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.gate.candidate.161dde48d1',
          'The held report or attempt changed since this decision was opened. Nothing was submitted; review the current candidate.'
        )
      )
    }
  }
  if (approval) {
    if (candidate.approveUnavailableReason || !held || held.report.kind !== 'available') {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.gate.candidate.9f2cae37be',
          '{{value0}} Nothing was submitted.',
          {
            value0:
              candidate.approveUnavailableReason ?? 'Approval requires the available held report.'
          }
        )
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
        translate(
          'auto.components.automations.coordinated.run.gate.candidate.39cf2e6cab',
          'The stage has a different attempt. The original approval is retained; nothing was submitted.'
        )
      )
    }
    if (!replay || current) {
      const refusal = replay
        ? current?.report.kind === 'available'
          ? null
          : translate(
              'auto.components.automations.coordinated.run.gate.candidate.5353a7895c',
              'The held report is no longer available.'
            )
        : approveRefusal(view, action)
      if (refusal) {
        throw new Error(
          translate(
            'auto.components.automations.coordinated.run.gate.candidate.9f2cae37be',
            '{{value0}} Nothing was submitted.',
            { value0: refusal }
          )
        )
      }
      if (
        current?.dispatchId !== held.dispatchId ||
        current.reportDigest !== held.reportDigest ||
        JSON.stringify(current.report) !== JSON.stringify(held.report)
      ) {
        throw new Error(
          translate(
            'auto.components.automations.coordinated.run.gate.candidate.37bfb2293c',
            'The held report changed since this decision was opened. Nothing was submitted; review the current report.'
          )
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
    ...(action.scope === 'stage' && candidate.stageCandidate
      ? { stageCandidate: candidate.stageCandidate }
      : {}),
    ...(action.scope === 'stage' && held
      ? { dispatchId: held.dispatchId, expectedReportDigest: held.reportDigest }
      : {})
  }
}
