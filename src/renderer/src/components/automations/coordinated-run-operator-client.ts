import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AutomationRun } from '../../../../shared/automations-types'
import type {
  CoordinatedFakeRunReconcileResponse,
  CoordinatedRunView
} from '../../../../shared/coordinated-automation-run-view'
import type {
  ResolveCoordinatedGateInput,
  RetryCoordinatedStageInput,
  StopCoordinatedRunInput
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import { getAutomationAuthorityTarget } from './automation-host-client'
import { REQUEST_TIMEOUT_MS } from './automation-capability-probe'
import {
  inspectCoordinatedRun,
  validateCoordinatedRunView,
  type CoordinatedRunBinding
} from './coordinated-run-api-client'

export type CoordinatedGateDecision = ResolveCoordinatedGateInput['decision']

export type CoordinatedRunOperatorAction =
  | { kind: 'stop' }
  | { kind: 'retry'; childDefinitionId: string; retryOfDispatchId: string }
  | { kind: 'gate'; gateId: string; decision: CoordinatedGateDecision; note?: string }

export type CoordinatedRunOperatorOutcome = {
  action: CoordinatedRunOperatorAction
  state: CoordinatedFakeRunReconcileResponse['state']
  reason: string | null
  view: CoordinatedRunView
}

/** Where one pending decision key binds; derived only from the frozen snapshot and host escalations. */
export type CoordinatedPendingGate =
  | { gateId: string; scope: 'stage'; childDefinitionId: string; label: string }
  | { gateId: string; scope: 'parent'; label: string }
  | { gateId: string; scope: 'escalation'; childDefinitionId: string | null; label: string }
  | { gateId: string; scope: 'unclassified'; label: string }

type FrozenSnapshot = NonNullable<AutomationRun['resolvedSnapshot']>

/** The history snapshot is usable only when it is the exact frozen definition the host inspected. */
export function matchingFrozenSnapshot(
  view: CoordinatedRunView,
  run: AutomationRun | undefined
): FrozenSnapshot | null {
  const snapshot = run?.resolvedSnapshot
  return snapshot &&
    run.id === view.inspection.automationRunId &&
    snapshot.canonicalDigest === view.inspection.canonicalDigest &&
    snapshot.definitionRevision === view.inspection.definitionRevision
    ? snapshot
    : null
}

/** Mirrors the host's gate lookup order: stage requirement, parent requirement, then escalation. */
export function classifyPendingGates(
  view: CoordinatedRunView,
  snapshot: FrozenSnapshot | null
): CoordinatedPendingGate[] {
  const escalations =
    view.inspection.progress.kind === 'available' ? view.inspection.progress.escalations : []
  return [...new Set(view.inspection.humanResolution.pendingDecisionKeys)].map((gateId) => {
    for (const child of snapshot?.resolvedChildren ?? []) {
      const requirement = child.stageAcceptance?.requiredApprovals?.find(
        (entry) => entry.id === gateId
      )
      if (requirement) {
        return {
          gateId,
          scope: 'stage',
          childDefinitionId: child.childDefinitionId,
          label: `${child.name} · ${requirement.role} approval`
        }
      }
    }
    const parent = snapshot?.outcomeContract.requiredApprovals.find((entry) => entry.id === gateId)
    if (parent) {
      return { gateId, scope: 'parent', label: `Parent outcome · ${parent.role} approval` }
    }
    const escalation = escalations.find(
      (entry) => entry.key === gateId && entry.requiresHumanDecision
    )
    if (escalation) {
      return {
        gateId,
        scope: 'escalation',
        childDefinitionId: escalation.childDefinitionId ?? null,
        label: `${escalation.code}: ${escalation.detail}`
      }
    }
    return {
      gateId,
      scope: 'unclassified',
      label: 'Scope unavailable until matching run history is refreshed.'
    }
  })
}

function operatorParams(
  view: CoordinatedRunView,
  snapshot: FrozenSnapshot,
  action: CoordinatedRunOperatorAction
): {
  method: string
  params: StopCoordinatedRunInput | RetryCoordinatedStageInput | ResolveCoordinatedGateInput
} {
  const { inspection } = view
  const base: StopCoordinatedRunInput = {
    runtimeId: view.runtimeId,
    automationId: inspection.automationId,
    automationRunId: inspection.automationRunId,
    expectedOwner: { selector: { kind: 'self' } },
    orchestrationRunId: inspection.orchestrationRunId,
    definitionRevision: inspection.definitionRevision,
    targetExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`
  }
  if (action.kind === 'stop') {
    if (!view.actions.stop.available) {
      throw new Error(view.actions.stop.reason)
    }
    return { method: 'automation.stopCoordinatedRun', params: base }
  }
  if (action.kind === 'retry') {
    if (!view.actions.retry.available) {
      throw new Error(view.actions.retry.reason)
    }
    const stage = inspection.stages.find(
      (entry) => entry.childDefinitionId === action.childDefinitionId
    )
    if (!stage?.retryEligibility.canRetry || !stage.taskId) {
      throw new Error(stage?.retryEligibility.reason ?? 'The host no longer admits this retry.')
    }
    if (stage.retryEligibility.retryOfDispatchId !== action.retryOfDispatchId) {
      throw new Error(
        'The stage has a newer attempt than the one confirmed. Nothing was submitted; review the current attempt first.'
      )
    }
    return {
      method: 'automation.retryCoordinatedStage',
      params: {
        ...base,
        childDefinitionId: stage.childDefinitionId,
        taskId: stage.taskId,
        retryOfDispatchId: action.retryOfDispatchId
      }
    }
  }
  if (!view.actions.humanResolution.available) {
    throw new Error(view.actions.humanResolution.reason)
  }
  const gate = classifyPendingGates(view, snapshot).find((entry) => entry.gateId === action.gateId)
  if (!gate || gate.scope === 'unclassified') {
    throw new Error('The host no longer reports this decision as pending. Nothing was submitted.')
  }
  const childDefinitionId = gate.scope === 'parent' ? null : gate.childDefinitionId
  const taskId =
    gate.scope === 'stage'
      ? inspection.stages.find((entry) => entry.childDefinitionId === childDefinitionId)?.taskId
      : null
  return {
    method: 'automation.resolveCoordinatedGate',
    params: {
      ...base,
      gateId: action.gateId,
      decision: action.decision,
      ...(action.note ? { note: action.note } : {}),
      ...(childDefinitionId ? { childDefinitionId } : {}),
      ...(taskId ? { taskId } : {})
    }
  }
}

/**
 * Submits one operator action. Scope and eligibility come from a fresh host inspection, never from
 * the rendered view, so a replay after an uncertain reply is checked against what the host recorded.
 */
export async function submitCoordinatedRunOperatorAction(
  binding: CoordinatedRunBinding,
  run: AutomationRun,
  action: CoordinatedRunOperatorAction
): Promise<CoordinatedRunOperatorOutcome> {
  const current = await inspectCoordinatedRun(
    binding,
    run.id,
    run.automationDefinitionRevision ?? undefined
  )
  const snapshot = matchingFrozenSnapshot(current, run)
  if (!snapshot) {
    throw new Error(
      'The frozen run scope is unavailable until matching run history is refreshed. Nothing was submitted.'
    )
  }
  const { method, params } = operatorParams(current, snapshot, action)
  const response = await callRuntimeRpc<CoordinatedFakeRunReconcileResponse>(
    getAutomationAuthorityTarget(binding.owner.authority),
    method,
    params,
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  return {
    action,
    state: response.state,
    reason: response.reason,
    view: validateCoordinatedRunView(response.view, params, params.definitionRevision)
  }
}
