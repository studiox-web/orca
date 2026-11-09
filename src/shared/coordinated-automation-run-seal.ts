import type { AutomationRun } from './automations-types'
import { deepFreeze } from './coordinated-automation-canonical-digest'
import { isCoordinatedAutomationRun } from './coordinated-automation-ledger-types'
import { CoordinatedRunFieldsSchema } from './coordinated-automation-snapshot-schemas'

const SEALED_FIELDS = [
  'resolvedSnapshot',
  'completionReceipt',
  'childMappings',
  'retainedEvidence'
] as const

/**
 * Store-owned copy: nested coordinated records are cloned and frozen so no caller reference
 * can rewrite history. `validate` re-checks them against the contract schema on write.
 */
export function sealCoordinatedRun(run: AutomationRun, validate: boolean): AutomationRun {
  if (!isCoordinatedAutomationRun(run)) {
    return run
  }
  if (validate) {
    CoordinatedRunFieldsSchema.parse({
      automationDefinitionRevision: run.automationDefinitionRevision,
      orchestrationRunId: run.orchestrationRunId ?? null,
      resolvedSnapshot: run.resolvedSnapshot ?? null,
      completionReceipt: run.completionReceipt ?? null,
      replanOfAutomationRunId: run.replanOfAutomationRunId ?? null,
      replanOfDefinitionRevision: run.replanOfDefinitionRevision ?? null,
      replanReason: run.replanReason ?? null,
      materializationPhase: run.materializationPhase,
      childMappings: run.childMappings ?? []
    })
  }
  const sealed: AutomationRun = { ...run }
  for (const field of SEALED_FIELDS) {
    const value = run[field]
    if (value !== undefined && value !== null) {
      // Why JSON: the stored copy must equal what a reload yields (undefined keys dropped).
      // @ts-expect-error each field keeps its own record type through clone and freeze
      sealed[field] = deepFreeze(JSON.parse(JSON.stringify(value)))
    }
  }
  return sealed
}

/** Callers get a mutable copy; the store keeps its frozen original. */
export function detachCoordinatedRun(run: AutomationRun): AutomationRun {
  return isCoordinatedAutomationRun(run) ? structuredClone(run) : run
}
