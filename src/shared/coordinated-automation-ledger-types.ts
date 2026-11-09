import type { AutomationExecutionTargetType, AutomationRunTrigger } from './automations-types'

/** Identity kept after a coordinated parent is archived; its run history stays in place. */
export type CoordinatedParentTombstone = {
  automationId: string
  name: string
  lastDefinitionRevision: number
  definitionFingerprint: string | null
  executionTarget: { type: AutomationExecutionTargetType; id: string; generation?: number }
  children: { childDefinitionId: string; name: string; role: string }[]
  archivedAt: number
}

/** Durable replay record for one delivered occurrence; outlives run-row pruning and compaction. */
export type CoordinatedOccurrenceRecord = {
  automationId: string
  occurrenceFingerprint: string
  idempotencyKey: string
  trigger: AutomationRunTrigger
  scheduledFor: number
  /** `<executionTargetType>:<executionTargetId>` that owned the parent when the run was created. */
  executionAuthority: string
  automationRunId: string
  definitionRevision: number
  canonicalDigest: string
  recordedAt: number
}

export type CoordinatedAutomationLedger = {
  parentTombstones: CoordinatedParentTombstone[]
  occurrences: CoordinatedOccurrenceRecord[]
  /** Per automation: highest `scheduledFor` whose replay record was evicted. */
  replayHorizons: Record<string, number>
  /** `${automationId}:${definitionRevision}` -> the only canonical digest that revision may have. */
  revisionDigests: Record<string, string>
  /** Set when the stored ledger failed validation; every coordinated write then refuses. */
  unreadable?: true
}

/** Loose marker check usable by runtime code that must not import persistence modules. */
export function isCoordinatedAutomationRun(run: { materializationPhase?: unknown }): boolean {
  return run.materializationPhase !== undefined
}
