import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AutomationRun } from '../../../../shared/automations-types'
import type {
  CoordinatedOperatorActionDisposition,
  CoordinatedPendingDecision
} from '../../../../shared/coordinated-automation-run-inspection'
import type {
  CoordinatedOperatorActionResponse,
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

import {
  coordinatedGateParams,
  pendingGateKey,
  type CoordinatedGateAction
} from './coordinated-run-gate-candidate'
export { approveRefusal, pendingGateKey } from './coordinated-run-gate-candidate'

export type CoordinatedGateDecision = ResolveCoordinatedGateInput['decision']

/** One operator request, identified by the host's natural key: no renderer request id exists. */
export type CoordinatedRunOperatorAction =
  | { kind: 'stop' }
  | { kind: 'retry'; childDefinitionId: string; retryOfDispatchId: string }
  | CoordinatedGateAction

export type CoordinatedRunOperatorOutcome = {
  action: CoordinatedRunOperatorAction
  /** `already_recorded`: an identical earlier request took effect and this one wrote nothing. */
  disposition: CoordinatedOperatorActionDisposition
  state: CoordinatedOperatorActionResponse['state']
  reason: string | null
  view: CoordinatedRunView
}

/** The request left the renderer and no valid host answer came back; its effect is unknown. */
export class CoordinatedOperatorUnconfirmedError extends Error {}

export function operatorActionLabel(action: CoordinatedRunOperatorAction): string {
  return action.kind === 'stop'
    ? 'stop request'
    : action.kind === 'retry'
      ? `retry of stage ${action.childDefinitionId}`
      : `${action.decision} decision for ${action.scope} gate ${action.gateId}`
}

/** One host-reported pending decision; the same gate id may appear once per scope. */
export type CoordinatedPendingGate = CoordinatedPendingDecision & { key: string; label: string }

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

/**
 * Why operator scope cannot be named, or null. The host field is the authority; matching frozen
 * history may only confirm it, never replace it.
 */
export function operatorScopeRefusal(
  view: CoordinatedRunView,
  snapshot: FrozenSnapshot | null
): string | null {
  const authority = view.inspection.targetExecutionAuthority
  if (!authority) {
    return 'The host reports no frozen execution authority for this run. Controls are unavailable.'
  }
  if (snapshot && `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}` !== authority) {
    return 'Run history names a different execution authority than the host. Controls are unavailable.'
  }
  return null
}

/** Host-scoped pending decisions; frozen history and escalations only add a readable label. */
export function describePendingGates(
  view: CoordinatedRunView,
  snapshot: FrozenSnapshot | null
): CoordinatedPendingGate[] {
  const escalations =
    view.inspection.progress.kind === 'available' ? view.inspection.progress.escalations : []
  return view.inspection.humanResolution.pendingDecisions.map((gate) => {
    const stageName =
      view.inspection.stages.find((stage) => stage.childDefinitionId === gate.childDefinitionId)
        ?.name ?? gate.childDefinitionId
    let label: string
    if (gate.scope === 'stage') {
      const role = snapshot?.resolvedChildren
        .find((child) => child.childDefinitionId === gate.childDefinitionId)
        ?.stageAcceptance?.requiredApprovals?.find((entry) => entry.id === gate.gateId)?.role
      label = `${stageName ?? 'Stage'} · ${role ? `${role} approval` : 'stage approval'}`
    } else if (gate.scope === 'parent') {
      const role = snapshot?.outcomeContract.requiredApprovals.find(
        (entry) => entry.id === gate.gateId
      )?.role
      label = `Parent outcome · ${role ? `${role} approval` : 'approval'}`
    } else {
      const escalation = escalations.find((entry) => entry.key === gate.gateId)
      label = escalation
        ? `${escalation.code}: ${escalation.detail}`
        : `Escalation${stageName ? ` · ${stageName}` : ''}`
    }
    return { ...gate, key: pendingGateKey(gate), label }
  })
}

function operatorParams(
  binding: CoordinatedRunBinding,
  view: CoordinatedRunView,
  action: CoordinatedRunOperatorAction,
  authority: string,
  replay: boolean
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
    targetExecutionAuthority: authority
  }
  if (action.kind === 'stop') {
    if (!replay && !view.actions.stop.available) {
      throw new Error(view.actions.stop.reason)
    }
    return { method: 'automation.stopCoordinatedRun', params: base }
  }
  const stage = inspection.stages.find(
    (entry) => entry.childDefinitionId === action.childDefinitionId
  )
  if (action.kind === 'retry') {
    if (!stage?.taskId) {
      throw new Error('The host no longer reports this stage with a Task. Nothing was submitted.')
    }
    // Why: a replay of the identical natural key is answered by the host; a fresh retry must still be host-eligible.
    if (!replay) {
      if (!view.actions.retry.available) {
        throw new Error(view.actions.retry.reason)
      }
      if (!stage.retryEligibility.canRetry) {
        throw new Error(stage.retryEligibility.reason ?? 'The host no longer admits this retry.')
      }
      if (stage.retryEligibility.retryOfDispatchId !== action.retryOfDispatchId) {
        throw new Error(
          'The stage has a newer attempt than the one confirmed. Nothing was submitted; review the current attempt first.'
        )
      }
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
  return {
    method: 'automation.resolveCoordinatedGate',
    params: coordinatedGateParams(binding, view, action, replay)
  }
}

/**
 * Submits one operator action. Gate scope and consent come from the captured view; fresh inspection
 * can refuse stale context, never replace it. Replay retains consent for the original candidate.
 */
export async function submitCoordinatedRunOperatorAction(
  binding: CoordinatedRunBinding,
  run: AutomationRun,
  action: CoordinatedRunOperatorAction,
  options: { replay?: boolean } = {}
): Promise<CoordinatedRunOperatorOutcome> {
  const current = await inspectCoordinatedRun(
    binding,
    run.id,
    run.automationDefinitionRevision ?? undefined
  )
  const refusal = operatorScopeRefusal(current, matchingFrozenSnapshot(current, run))
  const authority = current.inspection.targetExecutionAuthority
  if (refusal || !authority) {
    throw new Error(`${refusal} Nothing was submitted.`)
  }
  const { method, params } = operatorParams(
    binding,
    current,
    action,
    authority,
    options.replay === true
  )
  try {
    const response = await callRuntimeRpc<CoordinatedOperatorActionResponse>(
      getAutomationAuthorityTarget(binding.owner.authority),
      method,
      params,
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    if (response.disposition !== 'recorded' && response.disposition !== 'already_recorded') {
      throw new Error('The host answered without saying whether the request was recorded.')
    }
    const view = validateCoordinatedRunView(response.view, params, params.definitionRevision)
    if (
      view.inspection.targetExecutionAuthority !== authority ||
      view.inspection.orchestrationRunId !== params.orchestrationRunId
    ) {
      throw new Error('The host answered for a different execution authority.')
    }
    return {
      action,
      disposition: response.disposition,
      state: response.state,
      reason: response.reason,
      view
    }
  } catch (error) {
    throw new CoordinatedOperatorUnconfirmedError(
      error instanceof Error ? error.message : String(error)
    )
  }
}
