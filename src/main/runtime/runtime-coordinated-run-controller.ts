import type { CoordinatedAutomationRunHost } from '../automations/coordinated-automation-run-host-types'
import type {
  CoordinatedOperatorActionResult,
  CoordinatedRunInspection
} from '../../shared/coordinated-automation-run-inspection'
import type {
  CoordinatedFakeRunReconcileResponse,
  CoordinatedOperatorActionResponse,
  CoordinatedFakeRunStartResponse,
  CoordinatedRunActionAvailability,
  CoordinatedRunView
} from '../../shared/coordinated-automation-run-view'
import {
  CoordinatedFakeRunStart,
  CoordinatedRunSelection,
  ResolveCoordinatedGate,
  RetryCoordinatedStage,
  StopCoordinatedRun,
  type CoordinatedFakeRunStartInput,
  type CoordinatedRunSelectionInput,
  type ResolveCoordinatedGateInput,
  type RetryCoordinatedStageInput,
  type StopCoordinatedRunInput
} from '../../shared/rpc-contract/coordinated-automation-run-params'
import {
  assertCoordinatedRunParent,
  assertCoordinatedRunSelection,
  humanResolutionActionAvailability,
  retryActionAvailability,
  stopActionAvailability
} from './runtime-coordinated-run-actions'
import type { RuntimeStore } from './runtime-store-contract'

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
    assertCoordinatedRunParent(this.store!, request, runtimeId, 'mutate')
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
    assertCoordinatedRunSelection(this.store!, request, runtimeId)
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
    assertCoordinatedRunSelection(this.store!, request, runtimeId)
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

  async stop(
    input: StopCoordinatedRunInput,
    runtimeId: string
  ): Promise<CoordinatedOperatorActionResponse> {
    const request = StopCoordinatedRun.parse(input)
    return this.operatorAction(request, runtimeId, (host, req) => host.stopRun(req))
  }

  async retryStage(
    input: RetryCoordinatedStageInput,
    runtimeId: string
  ): Promise<CoordinatedOperatorActionResponse> {
    const request = RetryCoordinatedStage.parse(input)
    return this.operatorAction(request, runtimeId, (host, req) => host.retryStage(req))
  }

  async resolveGate(
    input: ResolveCoordinatedGateInput,
    runtimeId: string
  ): Promise<CoordinatedOperatorActionResponse> {
    const request = ResolveCoordinatedGate.parse(input)
    return this.operatorAction(request, runtimeId, (host, req) => host.resolveGate(req))
  }

  private async operatorAction<T extends CoordinatedRunSelectionInput>(
    request: T,
    runtimeId: string,
    invoke: (
      host: CoordinatedAutomationRunHost,
      request: T
    ) => Promise<CoordinatedOperatorActionResult>
  ): Promise<CoordinatedOperatorActionResponse> {
    const host = this.requireHost()
    assertCoordinatedRunSelection(this.store!, request, runtimeId)
    const result = await invoke(host, request)
    const inspection = await this.finishMutation(host, request, runtimeId)
    return {
      state: result.state,
      reason: result.reason,
      disposition: result.disposition,
      view: this.view(inspection, request, runtimeId)
    }
  }

  private async finishMutation(
    host: CoordinatedAutomationRunHost,
    selection: CoordinatedRunSelectionInput,
    runtimeId: string
  ): Promise<CoordinatedRunInspection> {
    this.assertCurrentHost(host)
    assertCoordinatedRunSelection(this.store!, selection, runtimeId)
    await this.store!.flushPendingOrThrowAsync!({ drainToStableGeneration: false })
    this.assertCurrentHost(host)
    assertCoordinatedRunSelection(this.store!, selection, runtimeId)
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

  private startAvailability(
    selection: CoordinatedRunSelectionInput,
    runtimeId: string
  ): CoordinatedRunActionAvailability {
    const availability = this.availability()
    if (!availability.available) {
      return availability
    }
    try {
      assertCoordinatedRunParent(this.store!, selection, runtimeId, 'mutate')
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
    assertCoordinatedRunSelection(this.store!, selection, runtimeId)
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
        stop: stopActionAvailability(available, inspection),
        retry: retryActionAvailability(available, inspection),
        humanResolution: humanResolutionActionAvailability(available, inspection)
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
