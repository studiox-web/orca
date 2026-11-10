import { isWebClientLocation } from '@/lib/web-client-location'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
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
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY } from '../../../../shared/automation-runtime-capabilities'
import { ownerKey } from '../../../../shared/automation-owner-key'
import { getAutomationAuthorityTarget } from './automation-host-client'
import { listAutomationRunsForOwner } from './automation-scoped-list-client'
import { REQUEST_TIMEOUT_MS } from './automation-capability-probe'

export type CoordinatedRunRequest = {
  start?: CoordinatedFakeRunStartInput
  reconcile?: CoordinatedRunSelectionInput
  /** An operator request that reached the host without a confirmed answer. */
  unconfirmedOperator?: { kind: 'stop' | 'retry' | 'gate'; label: string }
}
export type CoordinatedRunRequests = Map<string, CoordinatedRunRequest>
export type CoordinatedRunBinding = { automation: Automation; owner: AutomationOwnerRef }

export function coordinatedRunBindingKey(binding: CoordinatedRunBinding): string {
  return JSON.stringify([ownerKey(binding.owner), binding.automation.id])
}

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
      'This API requires an authenticated local caller. Remote and paired mobile test-run operations are unavailable.'
    )
  }
  if (
    binding.owner.selector.kind !== 'self' ||
    binding.automation.executionTargetType !== 'local'
  ) {
    throw new Error(
      'No-effect test runs require the owning host’s local Self target. SSH execution is unavailable.'
    )
  }
  const status = await callHost<RuntimeStatus>(binding.owner, 'status.get')
  if (!status.capabilities?.includes(COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY)) {
    throw new Error('This host does not support isolated no-effect test runs.')
  }
  if (!status.coordinatedFakeRuns?.available) {
    throw new Error(
      status.coordinatedFakeRuns?.reason ??
        'The host has not provided current test-run availability.'
    )
  }
  return status
}

export function validateCoordinatedRunView(
  view: CoordinatedRunView,
  selection: CoordinatedRunSelectionInput,
  expectedRevision?: number,
  expectedKey?: string
): CoordinatedRunView {
  const inspection = view.inspection
  if (
    view.runtimeId !== selection.runtimeId ||
    inspection.automationId !== selection.automationId ||
    inspection.automationRunId !== selection.automationRunId ||
    (expectedRevision !== undefined && inspection.definitionRevision !== expectedRevision) ||
    (expectedKey !== undefined && inspection.idempotencyKey !== expectedKey)
  ) {
    throw new Error(
      'The host returned a different runtime, parent, run, revision, or request identity. Refresh to inspect the exact run.'
    )
  }
  if (inspection.receipt.kind === 'available') {
    const receipt = inspection.receipt.receipt
    const identity = receipt.identityChain
    if (
      identity.automationId !== inspection.automationId ||
      identity.automationRunId !== inspection.automationRunId ||
      identity.orchestrationRunId !== inspection.orchestrationRunId ||
      identity.definitionRevision !== inspection.definitionRevision ||
      receipt.frozenConfigDigest !== inspection.canonicalDigest ||
      identity.taskMappings.some(
        (mapping) =>
          !inspection.stages.some(
            (stage) =>
              stage.childDefinitionId === mapping.childDefinitionId &&
              stage.taskId === mapping.taskId &&
              stage.mappedDispatchId === mapping.dispatchId
          )
      )
    ) {
      throw new Error(
        'The receipt identity does not match the selected host run. Evidence is unavailable.'
      )
    }
  }
  return view
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
  key?: string
): Promise<CoordinatedRunView> {
  const { view } = await callHost<{ view: CoordinatedRunView }>(
    binding.owner,
    'automation.inspectCoordinatedRun',
    selection
  )
  return validateCoordinatedRunView(view, selection, revision, key)
}

export async function inspectCoordinatedRun(
  binding: CoordinatedRunBinding,
  runId: string,
  revision?: number
): Promise<CoordinatedRunView> {
  const status = await readCoordinatedRunHost(binding)
  return inspectAt(binding, selectionFor(binding, status.runtimeId, runId), revision)
}

export async function startCoordinatedTestRun(
  binding: CoordinatedRunBinding,
  request: CoordinatedRunRequest
): Promise<CoordinatedRunView> {
  const status = await readCoordinatedRunHost(binding)
  if (request.start) {
    const submitted = request.start
    const runs = await listAutomationRunsForOwner(binding.owner, submitted.automationId)
    const matches = runs.filter(
      (run: AutomationRun) =>
        run.automationId === submitted.automationId &&
        run.idempotencyKey === submitted.idempotencyKey
    )
    if (matches.length > 1) {
      throw new Error(
        'Multiple runs match the original request. Host reconciliation is required; no new run was started.'
      )
    }
    if (matches[0]) {
      const view = await inspectAt(
        binding,
        selectionFor(binding, status.runtimeId, matches[0].id),
        submitted.expectedDefinitionRevision,
        submitted.idempotencyKey
      )
      delete request.start
      return view
    }
    if (status.runtimeId !== submitted.runtimeId) {
      throw new Error(
        'The host restarted and the original request was not found. Its identity is retained; a fresh start could duplicate an uncertain run.'
      )
    }
  } else {
    if (binding.automation.enabled || !binding.automation.definitionRevision) {
      throw new Error(
        'Save a disabled coordinated definition with a confirmed revision before starting a test run.'
      )
    }
    request.start = {
      runtimeId: status.runtimeId,
      automationId: binding.automation.id,
      expectedOwner: { selector: { kind: 'self' } },
      expectedDefinitionRevision: binding.automation.definitionRevision,
      idempotencyKey: createBrowserUuid()
    }
  }
  const submitted = request.start
  const response = await callHost<CoordinatedFakeRunStartResponse>(
    binding.owner,
    'automation.startCoordinatedFakeRun',
    submitted
  )
  const view = validateCoordinatedRunView(
    response.view,
    selectionFor(binding, submitted.runtimeId, response.view.inspection.automationRunId),
    submitted.expectedDefinitionRevision,
    submitted.idempotencyKey
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
  if (current.inspection.receipt.kind === 'available') {
    delete request.reconcile
    return current
  }
  if (!current.actions.reconcile.available) {
    throw new Error(current.actions.reconcile.reason)
  }
  const selection = selectionFor(binding, current.runtimeId, runId)
  if (request.reconcile && JSON.stringify(request.reconcile) !== JSON.stringify(selection)) {
    throw new Error(
      'The original reconcile belongs to a different run or runtime. Inspect that run before retrying; its submitted identity is retained.'
    )
  }
  request.reconcile ??= selection
  const response = await callHost<CoordinatedFakeRunReconcileResponse>(
    binding.owner,
    'automation.reconcileCoordinatedFakeRun',
    request.reconcile
  )
  const view = validateCoordinatedRunView(response.view, request.reconcile, revision)
  delete request.reconcile
  return view
}
