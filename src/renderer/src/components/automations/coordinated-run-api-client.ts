import { validateCoordinatedRunView } from './coordinated-run-view-validation'
export { validateCoordinatedRunView } from './coordinated-run-view-validation'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AutomationRun } from '../../../../shared/automations-types'
import type { AutomationOwnerRef } from '../../../../shared/automation-owner-ref'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type {
  CoordinatedRunView,
  CoordinatedFakeRunStartResponse,
  CoordinatedFakeRunReconcileResponse
} from '../../../../shared/coordinated-automation-run-view'
import type {
  CoordinatedFakeRunStartInput,
  CoordinatedRunSelectionInput
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import {
  coordinatedRunHostKind,
  coordinatedRunHostAvailability,
  type CoordinatedRunExecutionKind
} from './coordinated-run-host-kind'
import type { CoordinatedRunOperatorAction } from './coordinated-run-operator-client'
import type { CoordinatedRunBinding } from './coordinated-run-binding'
export { coordinatedRunBindingKey, type CoordinatedRunBinding } from './coordinated-run-binding'
import { getAutomationAuthorityTarget } from './automation-host-client'
import { listAutomationRunsForOwner } from './automation-scoped-list-client'
import { REQUEST_TIMEOUT_MS } from './automation-capability-probe'

export type CoordinatedRunRequest = {
  start?: CoordinatedFakeRunStartInput
  startExecutionKind?: CoordinatedRunExecutionKind
  reconcile?: CoordinatedRunSelectionInput
  reconcileExecutionKind?: CoordinatedRunExecutionKind
  /** An operator request that reached the host without a confirmed answer. */
  unconfirmedOperator?: { action: CoordinatedRunOperatorAction; label: string; detail: string }
}
export type CoordinatedRunRequests = Map<string, CoordinatedRunRequest>

async function callHost<T>(owner: AutomationOwnerRef, method: string, input?: unknown): Promise<T> {
  return callRuntimeRpc<T>(getAutomationAuthorityTarget(owner.authority), method, input, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...(owner.authority.kind === 'runtime'
      ? { expectedEnvironmentPairingRevision: owner.authority.pairingRevision }
      : {})
  })
}

export async function readCoordinatedRunHost(
  binding: CoordinatedRunBinding
): Promise<RuntimeStatus> {
  if (binding.owner.authority.kind !== 'desktop' || isWebClientLocation()) {
    throw new Error(
      translate(
        'auto.components.automations.coordinatedRuns.localCallerRequired',
        'This API requires an authenticated local caller. Remote and paired mobile run operations are unavailable.'
      )
    )
  }
  if (
    binding.owner.selector.kind !== 'self' ||
    binding.automation.executionTargetType !== 'local'
  ) {
    throw new Error(
      translate(
        'auto.components.automations.coordinatedRuns.localSelfRequired',
        'Coordinated runs require the owning host’s local Self target. SSH execution is unavailable.'
      )
    )
  }
  const status = await callHost<RuntimeStatus>(binding.owner, 'status.get')
  const availability = coordinatedRunHostAvailability(status)
  if (!availability?.available) {
    throw new Error(
      availability?.reason ??
        translate(
          'auto.components.automations.coordinatedRuns.availabilityMissing',
          'The host has not provided current coordinated-run availability.'
        )
    )
  }
  return status
}

function selectionFor(
  binding: CoordinatedRunBinding,
  runtimeId: string,
  runId: string
): CoordinatedRunSelectionInput {
  return {
    runtimeId,
    automationId: binding.automation.id,
    automationRunId: runId,
    expectedOwner: { selector: { kind: 'self' } }
  }
}

async function inspectAt(
  binding: CoordinatedRunBinding,
  selection: CoordinatedRunSelectionInput,
  revision?: number,
  key?: string,
  executionKind?: CoordinatedRunExecutionKind
): Promise<CoordinatedRunView> {
  const { view } = await callHost<{ view: CoordinatedRunView }>(
    binding.owner,
    'automation.inspectCoordinatedRun',
    selection
  )
  return validateCoordinatedRunView(view, selection, revision, key, executionKind)
}

export async function inspectCoordinatedRun(
  binding: CoordinatedRunBinding,
  runId: string,
  revision?: number
): Promise<CoordinatedRunView> {
  const status = await readCoordinatedRunHost(binding)
  return inspectAt(
    binding,
    selectionFor(binding, status.runtimeId, runId),
    revision,
    undefined,
    coordinatedRunHostKind(status)
  )
}

export async function startCoordinatedTestRun(
  binding: CoordinatedRunBinding,
  request: CoordinatedRunRequest
): Promise<CoordinatedRunView> {
  const status = await readCoordinatedRunHost(binding)
  const executionKind = coordinatedRunHostKind(status)
  if (request.start) {
    if ((request.startExecutionKind ?? 'fake') !== executionKind) {
      throw new Error(
        translate(
          'auto.components.automations.coordinatedRuns.startModeChanged',
          'The worker execution mode changed. Inspect the original start before retrying; its identity is retained.'
        )
      )
    }
    const submitted = request.start
    const runs = await listAutomationRunsForOwner(binding.owner, submitted.automationId)
    const matches = runs.filter(
      (run: AutomationRun) =>
        run.automationId === submitted.automationId &&
        run.idempotencyKey === submitted.idempotencyKey
    )
    if (matches.length > 1) {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.api.client.f0cdbdbb54',
          'Multiple runs match the original request. Host reconciliation is required; no new run was started.'
        )
      )
    }
    if (matches[0]) {
      const view = await inspectAt(
        binding,
        selectionFor(binding, status.runtimeId, matches[0].id),
        submitted.expectedDefinitionRevision,
        submitted.idempotencyKey,
        executionKind
      )
      delete request.start
      return view
    }
    if (status.runtimeId !== submitted.runtimeId) {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.api.client.6946118510',
          'The host restarted and the original request was not found. Its identity is retained; a fresh start could duplicate an uncertain run.'
        )
      )
    }
  } else {
    if (binding.automation.enabled || !binding.automation.definitionRevision) {
      throw new Error(
        translate(
          'auto.components.automations.coordinatedRuns.confirmedDefinitionRequired',
          'Save a disabled coordinated definition with a confirmed revision before starting a manual run.'
        )
      )
    }
    const nativeStart = status.coordinatedNativeRuns?.available
      ? status.coordinatedNativeRuns.nativeStart
      : undefined
    if (
      executionKind === 'native' &&
      (binding.automation.triggerPolicy !== 'manual_only' ||
        !nativeStart?.idempotencyKey.trim() ||
        nativeStart.workspaceId !== binding.automation.workspaceId ||
        !nativeStart.definitions.some(
          (definition) =>
            definition.automationId === binding.automation.id &&
            definition.expectedDefinitionRevision === binding.automation.definitionRevision
        ))
    ) {
      throw new Error(
        translate(
          'auto.components.automations.coordinatedRuns.nativeStartUnavailable',
          'The host has not admitted this manual definition revision and workspace for a native run.'
        )
      )
    }
    request.startExecutionKind = executionKind
    request.start = {
      runtimeId: status.runtimeId,
      automationId: binding.automation.id,
      expectedOwner: { selector: { kind: 'self' } },
      expectedDefinitionRevision: binding.automation.definitionRevision,
      idempotencyKey: executionKind === 'native' ? nativeStart!.idempotencyKey : createBrowserUuid()
    }
  }
  const submitted = request.start
  const response = await callHost<CoordinatedFakeRunStartResponse>(
    binding.owner,
    executionKind === 'native'
      ? 'automation.startCoordinatedNativeRun'
      : 'automation.startCoordinatedFakeRun',
    submitted
  )
  const view = validateCoordinatedRunView(
    response.view,
    selectionFor(binding, submitted.runtimeId, response.view.inspection.automationRunId),
    submitted.expectedDefinitionRevision,
    submitted.idempotencyKey,
    executionKind
  )
  delete request.start
  return view
}

export async function reconcileCoordinatedTestRun(
  binding: CoordinatedRunBinding,
  request: CoordinatedRunRequest,
  runId: string,
  revision?: number
): Promise<CoordinatedRunView> {
  const current = await inspectCoordinatedRun(binding, runId, revision)
  const executionKind = current.executionKind ?? 'fake'
  const selection = selectionFor(binding, current.runtimeId, runId)
  if (request.reconcile && (request.reconcileExecutionKind ?? 'fake') !== executionKind) {
    throw new Error(
      translate(
        'auto.components.automations.coordinatedRuns.reconcileModeChanged',
        'The worker execution mode changed. The original reconciliation identity is retained.'
      )
    )
  }
  if (request.reconcile && JSON.stringify(request.reconcile) !== JSON.stringify(selection)) {
    throw new Error(
      translate(
        'auto.components.automations.coordinated.run.api.client.8303fc2be1',
        'The original reconcile belongs to a different run or runtime. Inspect that run before retrying; its submitted identity is retained.'
      )
    )
  }
  if (current.inspection.receipt.kind === 'available') {
    delete request.reconcile
    return current
  }
  if (!current.actions.reconcile.available) {
    throw new Error(current.actions.reconcile.reason)
  }
  request.reconcile ??= selection
  request.reconcileExecutionKind = executionKind
  const response = await callHost<CoordinatedFakeRunReconcileResponse>(
    binding.owner,
    executionKind === 'native'
      ? 'automation.reconcileCoordinatedNativeRun'
      : 'automation.reconcileCoordinatedFakeRun',
    request.reconcile
  )
  const view = validateCoordinatedRunView(
    response.view,
    request.reconcile,
    revision,
    undefined,
    executionKind
  )
  delete request.reconcile
  return view
}
