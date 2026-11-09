import type { Repo } from '../../../shared/repo-types'
import type {
  Automation,
  AutomationRun,
  CoordinatedAutomationCreateInput,
  CoordinatedAutomationUpdateInput
} from '../../../shared/automations-types'
import type { CoordinatedRunChildMapping } from '../../../shared/coordinated-automation-saga-types'
import type {
  AutomationDestination,
  AutomationUpdatePreconditions
} from '../../../shared/automation-owner-precondition'
import {
  createCoordinatedAutomation as createCoordinatedAutomationOperation,
  updateCoordinatedAutomation as updateCoordinatedAutomationOperation
} from '../scheduling-automations/coordinated-automation-definition-operations'
import {
  createCoordinatedAutomationRun as createCoordinatedAutomationRunOperation,
  type CreateCoordinatedAutomationRunInput
} from '../scheduling-automations/coordinated-automation-run-operations'
import {
  linkCoordinatedOrchestrationRun as linkCoordinatedOrchestrationRunOperation,
  markCoordinatedRunReadyForDispatch as markCoordinatedRunReadyForDispatchOperation,
  persistCoordinatedChildMappings as persistCoordinatedChildMappingsOperation,
  recordCoordinatedMaterializationFailure as recordCoordinatedMaterializationFailureOperation
} from '../scheduling-automations/coordinated-automation-run-links'
import type { CoordinatedOrchestrationRecordProbe } from '../scheduling-automations/coordinated-automation-run-records'
import {
  getAutomationDefinitionOperations,
  getCoordinatedAutomationRunOperations,
  type AutomationPersistence
} from './automation-persistence'

const coordinatedAutomationPersistenceContext = Symbol('CoordinatedAutomationPersistence')

/** Coordinated definitions and run links share the Automation store's records and write path. */
export class CoordinatedAutomationPersistence {
  readonly [coordinatedAutomationPersistenceContext]: AutomationPersistence

  constructor(automations: AutomationPersistence) {
    this[coordinatedAutomationPersistenceContext] = automations
  }

  createCoordinatedAutomation(
    input: CoordinatedAutomationCreateInput,
    options?: { destination?: AutomationDestination; resolvedRepo?: Repo }
  ): Automation {
    return createCoordinatedAutomationOperation(
      getAutomationDefinitionOperations(this[coordinatedAutomationPersistenceContext]),
      input,
      options
    )
  }

  updateCoordinatedAutomation(
    id: string,
    updates: CoordinatedAutomationUpdateInput & { expectedDefinitionRevision?: number },
    options?: AutomationUpdatePreconditions & { resolvedRepo?: Repo }
  ): Automation {
    return updateCoordinatedAutomationOperation(
      getAutomationDefinitionOperations(this[coordinatedAutomationPersistenceContext]),
      id,
      updates,
      options
    )
  }

  createCoordinatedAutomationRun(input: CreateCoordinatedAutomationRunInput): AutomationRun {
    return createCoordinatedAutomationRunOperation(
      getCoordinatedAutomationRunOperations(this[coordinatedAutomationPersistenceContext]),
      input
    )
  }

  linkCoordinatedOrchestrationRun(input: {
    automationRunId: string
    orchestrationRunId: string
    probe: CoordinatedOrchestrationRecordProbe
  }): AutomationRun {
    return linkCoordinatedOrchestrationRunOperation(
      getCoordinatedAutomationRunOperations(this[coordinatedAutomationPersistenceContext]),
      input
    )
  }

  persistCoordinatedChildMappings(input: {
    automationRunId: string
    mappings: readonly CoordinatedRunChildMapping[]
    probe: CoordinatedOrchestrationRecordProbe
  }): AutomationRun {
    return persistCoordinatedChildMappingsOperation(
      getCoordinatedAutomationRunOperations(this[coordinatedAutomationPersistenceContext]),
      input
    )
  }

  markCoordinatedRunReadyForDispatch(input: {
    automationRunId: string
    probe: CoordinatedOrchestrationRecordProbe
  }): AutomationRun {
    return markCoordinatedRunReadyForDispatchOperation(
      getCoordinatedAutomationRunOperations(this[coordinatedAutomationPersistenceContext]),
      input
    )
  }

  recordCoordinatedMaterializationFailure(input: {
    automationRunId: string
    phase: 'orphaned_reconciling' | 'materialization_failed' | 'compensation_failed'
    error: string
  }): AutomationRun {
    return recordCoordinatedMaterializationFailureOperation(
      getCoordinatedAutomationRunOperations(this[coordinatedAutomationPersistenceContext]),
      input
    )
  }
}
