import type { CoordinatedAutomationRunHost } from '../automations/coordinated-automation-run-host-types'
import type {
  AutomationOwnerPrecondition,
  AutomationOwnerFenceOperation
} from '../../shared/automation-owner-precondition'
import type { CoordinatedRunInspection } from '../../shared/coordinated-automation-run-inspection'
import type {
  CoordinatedFakeRunReconcileResponse,
  CoordinatedFakeRunStartResponse,
  CoordinatedRunActionAvailability,
  CoordinatedRunView
} from '../../shared/coordinated-automation-run-view'
import {
  CoordinatedFakeRunStart,
  CoordinatedRunSelection,
  type CoordinatedFakeRunStartInput,
  type CoordinatedRunSelectionInput
} from '../../shared/rpc-contract/coordinated-automation-run-params'
import { assertCoordinatedDefinitionLocalTarget } from './coordinated-definition-write-gate'
import type { RuntimeStore } from './runtime-store-contract'

type ParentSelection = {
  runtimeId: string
  automationId: string
  expectedOwner: AutomationOwnerPrecondition
}

export class RuntimeCoordinatedRunController {
  constructor(
    private readonly store: RuntimeStore | null,
    private readonly definitionGateOpen: () => boolean,
    private readonly getHost: () => CoordinatedAutomationRunHost | null
  ) {}

  availability(): CoordinatedRunActionAvailability {
    const host = this.getHost()
    if (!host || !host.startManualRun || !host.reconcileRun || !host.inspectRun) {
      return {
        available: false,
        state: 'unconfigured',
        reason: 'This host does not support coordinated fake runs.'
      }
    }
    const availability = host.availability
    if (!availability.available) {
      return { ...availability }
    }
    if (!this.definitionGateOpen() || !this.store?.listAutomationRuns) {
      return {
        available: false,
        state: 'refused',
        reason: 'The isolated local coordinated capability is unavailable.'
      }
    }
    const state = 'state' in availability ? availability.state : undefined
    if (state !== 'running') {
      return {
        available: false,
        state: 'refused',
        reason: 'This host cannot confirm an active coordinated fake run lifecycle.'
      }
    }
    return { available: true, state }
  }

  async start(
    input: CoordinatedFakeRunStartInput,
    runtimeId: string
  ): Promise<CoordinatedFakeRunStartResponse> {
    const request = CoordinatedFakeRunStart.parse(input)
    const host = this.requireHost()
    this.assertParent(request, runtimeId, 'mutate')
    const result = await host.startManualRun({
      automationId: request.automationId,
      expectedOwner: request.expectedOwner,
      expectedDefinitionRevision: request.expectedDefinitionRevision,
      idempotencyKey: request.idempotencyKey
    })
    const selection = { ...request, automationRunId: result.automationRunId }
    const inspection = await this.finishMutation(host, selection, runtimeId)
    return {
      created: result.created,
      state: result.state,
      reason: result.reason,
      view: this.view(inspection, selection, runtimeId)
    }
  }

  inspect(input: CoordinatedRunSelectionInput, runtimeId: string): { view: CoordinatedRunView } {
    const request = CoordinatedRunSelection.parse(input)
    const host = this.requireHost()
    this.assertSelection(request, runtimeId)
    const inspection = host.inspectRun({
      automationId: request.automationId,
      automationRunId: request.automationRunId,
      expectedOwner: request.expectedOwner
    })
    this.assertCurrentHost(host)
    return { view: this.view(inspection, request, runtimeId) }
  }

  async reconcile(
    input: CoordinatedRunSelectionInput,
    runtimeId: string
  ): Promise<CoordinatedFakeRunReconcileResponse> {
    const request = CoordinatedRunSelection.parse(input)
    const host = this.requireHost()
    this.assertSelection(request, runtimeId)
    const result = await host.reconcileRun({
      automationId: request.automationId,
      automationRunId: request.automationRunId,
      expectedOwner: request.expectedOwner
    })
    if (result.automationRunId !== request.automationRunId) {
      throw new Error('Coordinated host returned a different AutomationRun.')
    }
    const inspection = await this.finishMutation(host, request, runtimeId)
    return {
      state: result.state,
      reason: result.reason,
      view: this.view(inspection, request, runtimeId)
    }
  }

  private async finishMutation(
    host: CoordinatedAutomationRunHost,
    selection: CoordinatedRunSelectionInput,
    runtimeId: string
  ): Promise<CoordinatedRunInspection> {
    this.assertCurrentHost(host)
    this.assertSelection(selection, runtimeId)
    await this.store!.flushPendingOrThrowAsync!({ drainToStableGeneration: false })
    this.assertCurrentHost(host)
    this.assertSelection(selection, runtimeId)
    return host.inspectRun({
      automationId: selection.automationId,
      automationRunId: selection.automationRunId,
      expectedOwner: selection.expectedOwner
    })
  }

  private requireHost(): CoordinatedAutomationRunHost {
    const availability = this.availability()
    if (!availability.available) {
      throw new Error(availability.reason)
    }
    const host = this.getHost()
    if (!host) {
      throw new Error('Coordinated fake run host is unavailable.')
    }
    return host
  }

  private assertCurrentHost(host: CoordinatedAutomationRunHost): void {
    if (this.requireHost() !== host) {
      throw new Error('Coordinated fake run host changed while the request was pending.')
    }
  }

  private assertParent(
    input: ParentSelection,
    runtimeId: string,
    operation: AutomationOwnerFenceOperation
  ): void {
    if (input.runtimeId !== runtimeId) {
      throw new Error('Coordinated request belongs to a different runtime authority.')
    }
    const store = this.store!
    const parent = store.listAutomations!().find((entry) => entry.id === input.automationId)
    if (!parent || parent.kind !== 'coordinated' || parent.enabled) {
      throw new Error('A disabled coordinated Automation is required.')
    }
    store.assertAutomationOwnerFence!({
      id: parent.id,
      expectedOwner: input.expectedOwner,
      operation
    })
    if (
      input.expectedOwner.selector.kind !== 'self' ||
      store.automationOwnerPrecondition!(parent.id)?.selector.kind !== 'self' ||
      parent.executionTargetType !== 'local' ||
      parent.schedulerOwner !== 'local_host_service'
    ) {
      throw new Error('Coordinated fake runs require a confirmed local desktop owner.')
    }
    assertCoordinatedDefinitionLocalTarget(store.getRepo(parent.projectId))
  }

  private assertSelection(input: CoordinatedRunSelectionInput, runtimeId: string): void {
    if (input.runtimeId !== runtimeId || input.expectedOwner.selector.kind !== 'self') {
      throw new Error(
        'Coordinated run selection requires the exact local runtime and frozen owner.'
      )
    }
    const parent = this.store!.listAutomations!().find((entry) => entry.id === input.automationId)
    if (!parent || parent.kind !== 'coordinated') {
      throw new Error('The coordinated parent is unavailable or archived.')
    }
    const run = this.store!.listAutomationRuns!().find(
      (entry) => entry.id === input.automationRunId
    )
    if (
      !run ||
      run.automationId !== input.automationId ||
      run.materializationPhase === undefined ||
      run.coordinatedQuarantine !== undefined
    ) {
      throw new Error(
        'Coordinated AutomationRun does not belong to this Automation or is unavailable.'
      )
    }
  }

  private startAvailability(
    selection: CoordinatedRunSelectionInput,
    runtimeId: string
  ): CoordinatedRunActionAvailability {
    const availability = this.availability()
    if (!availability.available) {
      return availability
    }
    try {
      this.assertParent(selection, runtimeId, 'mutate')
      return availability
    } catch (error) {
      return {
        available: false,
        state: availability.state,
        reason: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private view(
    inspection: CoordinatedRunInspection,
    selection: CoordinatedRunSelectionInput,
    runtimeId: string
  ): CoordinatedRunView {
    this.assertSelection(selection, runtimeId)
    if (
      inspection.automationId !== selection.automationId ||
      inspection.automationRunId !== selection.automationRunId
    ) {
      throw new Error('Coordinated inspection does not match the selected AutomationRun.')
    }
    const available = this.availability()
    return structuredClone({
      runtimeId,
      inspection,
      actions: {
        start: this.startAvailability(selection, runtimeId),
        reconcile: available,
        stop: { available: false, reason: 'This host has no reviewed coordinated stop operation.' },
        retry: {
          available: false,
          reason: 'This host has no reviewed coordinated retry operation.'
        },
        humanResolution: inspection.humanResolution
      },
      findings: {
        kind: 'unavailable',
        reason: 'This host inspection does not expose the complete finding records.'
      },
      limits: {
        kind: 'unavailable',
        reason:
          'This host inspection does not expose resolved limits; retained halts and escalations are shown in progress.'
      }
    })
  }
}
