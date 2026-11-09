/**
 * Fail-closed host negotiation and capability identifiers.
 */
export const COORDINATED_AUTOMATION_CONTRACT_VERSION = 1
export type CoordinatedAutomationContractVersion = 1

export type CoordinatedAutomationCapability =
  | 'coordinated_v1'
  | 'structured_worker_result_v1'
  | 'semantic_completion_receipt_v1'
  | 'stage_acceptance_v1'

export type CoordinatedHostCapabilities = {
  contractVersion: CoordinatedAutomationContractVersion
  supportedCapabilities: CoordinatedAutomationCapability[]
}

/**
 * Durable cross-store materialization phase across Automation and Orchestration stores.
 * Strictly technical saga phases decoupled from semantic execution and acceptance.
 */
export type CoordinatedRunMaterializationPhase =
  | 'intent_persisted'
  | 'orchestration_run_created'
  | 'tasks_created'
  | 'mappings_persisted'
  | 'ready_for_dispatch'
  | 'orphaned_reconciling'
  | 'compensation_failed'
  | 'materialization_failed'

/**
 * Guard proving worker task dispatch is strictly forbidden prior to durable mappings persistence.
 * Tasks may only be dispatched once the saga reaches 'ready_for_dispatch'.
 */
export function canDispatchCoordinatedTask(phase: CoordinatedRunMaterializationPhase): boolean {
  return phase === 'ready_for_dispatch'
}

/**
 * Indicates whether the saga materialization ended in a terminal failure state.
 */
export function isTerminalMaterializationPhase(phase: CoordinatedRunMaterializationPhase): boolean {
  return phase === 'compensation_failed' || phase === 'materialization_failed'
}

export type CoordinatedRunChildMapping = {
  childDefinitionId: string
  taskId: string
  dispatchId?: string | null
}

export type CoordinatedRunMaterializationRecord = {
  automationId: string
  automationRunId: string
  definitionRevision: number
  idempotencyKey: string
  orchestrationRunId?: string | null
  phase: CoordinatedRunMaterializationPhase
  childMappings: CoordinatedRunChildMapping[]
  boundaryError?: string | null
  updatedAt: number
}
