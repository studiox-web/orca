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
 */
export type CoordinatedRunMaterializationPhase =
  | 'intent_persisted'
  | 'orchestration_run_created'
  | 'tasks_created'
  | 'mappings_persisted'
  | 'ready_for_dispatch'
  | 'dispatch_active'
  | 'accepted'
  | 'failed'
  | 'reconciliation_blocked'

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
