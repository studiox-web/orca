import type {
  CoordinatedFakeRunStartInput,
  CoordinatedRunSelectionInput
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import type { AutomationsChangedPayload } from '../../../../shared/runtime-client-events'
import type {
  AutomationOwnerPrecondition,
  AutomationDestination,
  AutomationUpdatePreconditions
} from '../../../../shared/automation-owner-precondition'
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from '../../runtime-automation-controller'
import {
  automationChangePublications,
  type AutomationChangeSelector,
  type AutomationListResult
} from '../../../../shared/automation-list-scope'
import { OrcaRuntimeWithCrewOperations } from './crew-operations'
import type {
  RuntimeCoordinatedAutomationCreateInput,
  RuntimeCoordinatedAutomationUpdateInput
} from '../../../../shared/rpc-contract/coordinated-automation-params'

export abstract class OrcaRuntimeWithAutomationApiOperations extends OrcaRuntimeWithCrewOperations {
  abstract notifyAutomationsChanged(payload?: AutomationsChangedPayload): void

  private assertCoordinatedDefinitionHost(): void {
    if (this.servesHeadlessGraph) {
      throw new Error(
        'Coordinated definition writes are unavailable on remote runtime authorities.'
      )
    }
  }

  createCoordinatedAutomation(input: RuntimeCoordinatedAutomationCreateInput): Promise<Automation> {
    this.assertCoordinatedDefinitionHost()
    return this.automation.withExternalProbePriority(() =>
      this.automation.createCoordinated(input).then((automation) => {
        const selector = this.automationChangeSelector(automation.id)
        this.publishAutomationDefinitionChange(selector, selector)
        return automation
      })
    )
  }

  updateCoordinatedAutomation(
    id: string,
    updates: RuntimeCoordinatedAutomationUpdateInput,
    options: AutomationUpdatePreconditions & { expectedOwner: AutomationOwnerPrecondition }
  ): Promise<Automation> {
    this.assertCoordinatedDefinitionHost()
    return this.automation.withExternalProbePriority(() => {
      const source = this.automationChangeSelector(id)
      return this.automation.updateCoordinated(id, updates, options).then((automation) => {
        this.publishAutomationDefinitionChange(source, this.automationChangeSelector(automation.id))
        return automation
      })
    })
  }

  startCoordinatedFakeRun(input: CoordinatedFakeRunStartInput) {
    return this.automation.withExternalProbePriority(async () => {
      const result = await this.automation.coordinatedRuns.start(input, this.getRuntimeId())
      this.notifyAutomationsChanged({ reason: 'run', selector: { kind: 'self' } })
      return result
    })
  }

  inspectCoordinatedRun(input: CoordinatedRunSelectionInput) {
    return this.automation.withExternalProbePriority(() =>
      this.automation.coordinatedRuns.inspect(input, this.getRuntimeId())
    )
  }

  reconcileCoordinatedFakeRun(input: CoordinatedRunSelectionInput) {
    return this.automation.withExternalProbePriority(async () => {
      const result = await this.automation.coordinatedRuns.reconcile(input, this.getRuntimeId())
      this.notifyAutomationsChanged({ reason: 'run', selector: { kind: 'self' } })
      return result
    })
  }

  private readAutomationRuns<T>(
    automationId: string | undefined,
    expectedOwner: AutomationOwnerPrecondition | undefined,
    read: () => T
  ): T {
    if (expectedOwner && !automationId) {
      throw new Error('An expected owner requires an automation id.')
    }
    return this.automation.withExternalProbePriority(() => {
      if (automationId) {
        this.automation.assertOwner(automationId, expectedOwner, 'read')
      }
      return read()
    })
  }

  listAutomationRuns(
    automationId?: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): AutomationRun[] {
    return this.readAutomationRuns(automationId, expectedOwner, () =>
      this.automation.listRuns(automationId)
    )
  }

  listAutomationRunsPage(
    automationId?: string,
    expectedOwner?: AutomationOwnerPrecondition,
    limit?: number,
    cursor?: string
  ) {
    return this.readAutomationRuns(automationId, expectedOwner, () =>
      this.automation.listRunsPage(automationId, limit, cursor)
    )
  }

  showAutomation(id: string, expectedOwner?: AutomationOwnerPrecondition): Automation {
    const automation = this.automation.show(id)
    this.automation.assertOwner(id, expectedOwner, 'read')
    return automation
  }

  protected automationChangeSelector(id: string): AutomationChangeSelector | null {
    return this.store?.automationChangeSelector?.(id) ?? null
  }

  /** A store that cannot name the affected host degrades to one unscoped authority event. */
  protected publishAutomationDefinitionChange(
    before: AutomationChangeSelector | null,
    after: AutomationChangeSelector | null
  ): void {
    for (const selector of automationChangePublications(before, after)) {
      this.notifyAutomationsChanged({ reason: 'definition', ...(selector ? { selector } : {}) })
    }
  }

  createAutomation(
    input: RuntimeAutomationCreateInput,
    destination?: AutomationDestination
  ): Promise<Automation> {
    return this.automation.withExternalProbePriority(() =>
      this.automation.create(input, destination).then((automation) => {
        const selector = this.automationChangeSelector(automation.id)
        this.publishAutomationDefinitionChange(selector, selector)
        return automation
      })
    )
  }

  updateAutomation(
    id: string,
    updates: RuntimeAutomationUpdateInput,
    options?: AutomationUpdatePreconditions
  ): Promise<Automation> {
    return this.automation.withExternalProbePriority(() => {
      const source = this.automationChangeSelector(id)
      return this.automation.update(id, updates, options).then((automation) => {
        this.publishAutomationDefinitionChange(source, this.automationChangeSelector(automation.id))
        return automation
      })
    })
  }

  deleteAutomation(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<{ removed: boolean; id: string }> {
    return this.automation.withExternalProbePriority(() => {
      const selector = this.automationChangeSelector(id)
      return this.automation.delete(id, expectedOwner).then((result) => {
        this.publishAutomationDefinitionChange(selector, selector)
        return result
      })
    })
  }

  runAutomationNow(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<AutomationRun> {
    return this.automation.withExternalProbePriority(() =>
      this.automation.runNow(id, expectedOwner)
    )
  }

  listAutomationsForScope(params = {}): AutomationListResult {
    return this.automation.withExternalProbePriority(() => this.automation.listForScope(params))
  }

  automationOwnerPrecondition(id: string): AutomationOwnerPrecondition | null {
    return this.automation.ownerPrecondition(id)
  }
}
