import type { AutomationService } from '../automations/service'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { RuntimeStore } from './runtime-store-contract'
import type { AutomationListParams, AutomationListResult } from '../../shared/automation-list-scope'
import type {
  AutomationOwnerFenceOperation,
  AutomationOwnerPrecondition,
  AutomationDestination,
  AutomationUpdatePreconditions
} from '../../shared/automation-owner-precondition'
import {
  CoordinatedDefinitionWriteGate,
  assertCoordinatedDefinitionLocalTarget,
  assertCoordinatedDefinitionSelf,
  type CoordinatedDefinitionWriteHost
} from './coordinated-definition-write-gate'
import {
  CoordinatedAutomationCreateRequest,
  CoordinatedAutomationUpdate,
  type RuntimeCoordinatedAutomationCreateInput,
  type RuntimeCoordinatedAutomationUpdateInput
} from '../../shared/rpc-contract/coordinated-automation-params'
import { runAutomationNowFenced } from '../automations/refused-manual-run'
import { paginateAutomationRuns } from '../../shared/automation-run-cursor'
import { RuntimeCoordinatedRunController } from './runtime-coordinated-run-controller'
import { RuntimeAutomationDefinitionWriter } from './runtime-automation-definition-writer'
import type {
  RuntimeAutomationTargetResolvers,
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-run-context'

export type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-run-context'

export class RuntimeAutomationController {
  private service: AutomationService | null = null
  readonly coordinatedRuns: RuntimeCoordinatedRunController
  private readonly coordinatedDefinitions: CoordinatedDefinitionWriteGate
  private readonly definitions: RuntimeAutomationDefinitionWriter

  constructor(
    private readonly store: RuntimeStore | null,
    resolvers: RuntimeAutomationTargetResolvers,
    coordinatedDefinitionWrites?: CoordinatedDefinitionWriteHost,
    isLocalAuthority: () => boolean = () => true
  ) {
    this.coordinatedDefinitions = new CoordinatedDefinitionWriteGate(
      store,
      coordinatedDefinitionWrites,
      isLocalAuthority
    )
    this.definitions = new RuntimeAutomationDefinitionWriter(store, resolvers)
    this.coordinatedRuns = new RuntimeCoordinatedRunController(
      store,
      () => this.coordinatedDefinitionCapabilities() !== null,
      () => this.service?.coordinatedRuns ?? null
    )
  }

  coordinatedDefinitionCapabilities() {
    return this.coordinatedDefinitions.capabilities()
  }

  async createCoordinated(input: RuntimeCoordinatedAutomationCreateInput): Promise<Automation> {
    this.coordinatedDefinitions.assertAvailable()
    const parsed = CoordinatedAutomationCreateRequest.parse(input)
    assertCoordinatedDefinitionSelf(parsed.destination, parsed.runContext)
    return this.definitions.create(
      { ...parsed, rrule: parsed.rrule ?? '', dtstart: parsed.dtstart ?? 0 },
      (base, options) => {
        this.coordinatedDefinitions.assertAvailable()
        assertCoordinatedDefinitionLocalTarget(options.resolvedRepo)
        const replay = parsed.creationKey
          ? this.list().find((entry) => entry.creationKey === parsed.creationKey)
          : undefined
        if (replay) {
          this.assertCoordinatedOwner(replay.id, { selector: { kind: 'self' } })
        }
        return this.store!.createCoordinatedAutomation!(
          parsed.triggerPolicy === 'manual_only'
            ? {
                ...parsed,
                ...base,
                triggerPolicy: 'manual_only',
                rrule: undefined,
                dtstart: undefined,
                enabled: false
              }
            : { ...parsed, ...base, triggerPolicy: undefined, enabled: false },
          options
        )
      },
      parsed.destination
    )
  }

  async updateCoordinated(
    id: string,
    updates: RuntimeCoordinatedAutomationUpdateInput,
    options: AutomationUpdatePreconditions & { expectedOwner: AutomationOwnerPrecondition }
  ): Promise<Automation> {
    this.coordinatedDefinitions.assertAvailable()
    const parsed = CoordinatedAutomationUpdate.parse({ id, updates, ...options })
    const destination = parsed.destination ?? { selector: { kind: 'self' as const } }
    assertCoordinatedDefinitionSelf(destination, parsed.updates.runContext)
    this.assertCoordinatedOwner(id, parsed.expectedOwner)
    return this.definitions.update(
      this.show(id),
      parsed.updates,
      {
        expectedOwner: parsed.expectedOwner,
        destination,
        expectedWorkspaceMode: parsed.expectedWorkspaceMode
      },
      (patch, preconditions) => {
        this.coordinatedDefinitions.assertAvailable()
        this.assertCoordinatedOwner(id, parsed.expectedOwner)
        const current = this.show(id)
        assertCoordinatedDefinitionLocalTarget(
          preconditions.resolvedRepo ?? this.store!.getRepo(current.projectId)
        )
        return this.store!.updateCoordinatedAutomation!(
          id,
          { ...parsed.updates, ...patch, enabled: false },
          preconditions
        )
      }
    )
  }

  private assertCoordinatedOwner(id: string, expectedOwner: AutomationOwnerPrecondition): void {
    this.assertOwner(id, expectedOwner, 'mutate')
    const current = this.show(id)
    if (
      expectedOwner.selector.kind !== 'self' ||
      this.ownerPrecondition(id)?.selector.kind !== 'self' ||
      current.executionTargetType !== 'local' ||
      current.schedulerOwner !== 'local_host_service'
    ) {
      throw new Error('Coordinated definition writes require a confirmed local owner.')
    }
  }

  setService(service: AutomationService): void {
    this.service = service
  }

  /** Completed automation run terminals no client used, closed before an update; 0 off-headless. */
  releaseFinishedRunTerminals(): Promise<number> {
    return this.service?.releaseFinishedRunTerminals?.() ?? Promise.resolve(0)
  }

  /** Keep runtime-owned automation work ahead of queued external probes. */
  withExternalProbePriority<T>(run: () => T): T {
    const wrap = this.service?.externalProbePriority
    return wrap ? wrap(run) : run()
  }

  list(): Automation[] {
    if (!this.store?.listAutomations) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomations()
  }

  listRuns(automationId?: string): AutomationRun[] {
    if (!this.store?.listAutomationRuns) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomationRuns(automationId)
  }

  listRunsPage(automationId?: string, limit?: number, cursor?: string) {
    if (this.store?.listAutomationRunsPage) {
      return this.store.listAutomationRunsPage(automationId, limit, cursor)
    }
    return paginateAutomationRuns(this.listRuns(automationId), limit, cursor)
  }

  listForScope(params: AutomationListParams = {}): AutomationListResult {
    if (!this.store?.listAutomationsForScope) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomationsForScope(params)
  }

  ownerPrecondition(id: string): AutomationOwnerPrecondition | null {
    return this.store?.automationOwnerPrecondition?.(id) ?? null
  }

  show(id: string): Automation {
    const automation = this.list().find((entry) => entry.id === id)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    return automation
  }

  async create(
    input: RuntimeAutomationCreateInput,
    destination?: AutomationDestination
  ): Promise<Automation> {
    if (!this.store?.createAutomation) {
      throw new Error('runtime_unavailable')
    }
    return this.definitions.create(
      input,
      (base, options) => this.store!.createAutomation!(base, options),
      destination
    )
  }

  async update(
    id: string,
    updates: RuntimeAutomationUpdateInput,
    // Forwarded unchanged so the store checks every precondition against the record it writes.
    options?: Parameters<NonNullable<RuntimeStore['updateAutomation']>>[2]
  ): Promise<Automation> {
    if (!this.store?.updateAutomation) {
      throw new Error('runtime_unavailable')
    }
    return this.definitions.update(this.show(id), updates, options, (patch, preconditions) =>
      this.store!.updateAutomation!(id, patch, preconditions)
    )
  }

  async delete(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<{ removed: boolean; id: string }> {
    if (!this.store?.deleteAutomation) {
      throw new Error('runtime_unavailable')
    }
    this.show(id)
    this.store.deleteAutomation(id, expectedOwner ? { expectedOwner } : undefined)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return { removed: true, id }
  }

  async runNow(id: string, expectedOwner?: AutomationOwnerPrecondition): Promise<AutomationRun> {
    if (!this.service) {
      throw new Error('runtime_unavailable')
    }
    return await runAutomationNowFenced({
      automationId: id,
      service: this.service,
      fence: () => this.assertOwner(id, expectedOwner, 'execute')
    })
  }

  assertOwner(
    id: string,
    expectedOwner: AutomationOwnerPrecondition | undefined,
    operation: AutomationOwnerFenceOperation
  ): void {
    if (!this.store?.assertAutomationOwnerFence) {
      if (expectedOwner) {
        throw new Error('runtime_unavailable')
      }
      return
    }
    this.store.assertAutomationOwnerFence({ id, expectedOwner, operation })
  }
}
