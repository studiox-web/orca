import { z } from 'zod'
import type { AutomationRun } from './automations-types'
import type {
  CoordinatedRunRetainedEvidence,
  ResolvedAutomationRunSnapshot
} from './coordinated-automation-types'
import type { CoordinatedRunChildMapping } from './coordinated-automation-saga-types'
import { CoordinatedRunFieldsSchema } from './coordinated-automation-snapshot-schemas'
import { computeSnapshotCanonicalDigest } from './coordinated-automation-snapshot'

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)

const RetainedEvidenceSchema: z.ZodType<CoordinatedRunRetainedEvidence> = z.object({
  definitionRevision: z.number().int().positive(),
  canonicalDigest: Digest,
  children: z
    .array(z.object({ childDefinitionId: z.string(), name: z.string(), role: z.string() }))
    .max(100),
  minimumEvidenceReferences: z.array(z.string()).max(100)
})

const LINKED_PHASES = new Set(['mappings_persisted', 'ready_for_dispatch'])

export function mappingProblem(
  snapshot: ResolvedAutomationRunSnapshot,
  mappings: readonly CoordinatedRunChildMapping[],
  requireComplete = true
): string | null {
  const required = new Set(
    snapshot.resolvedChildren.filter((child) => child.enabled).map((c) => c.childDefinitionId)
  )
  const seenChildren = new Set<string>()
  const seenTasks = new Set<string>()
  for (const mapping of mappings) {
    if (!required.has(mapping.childDefinitionId)) {
      return `Child "${mapping.childDefinitionId}" is not an enabled child of this run's snapshot.`
    }
    if (seenChildren.has(mapping.childDefinitionId)) {
      return `Child "${mapping.childDefinitionId}" is mapped more than once.`
    }
    if (!mapping.taskId || seenTasks.has(mapping.taskId)) {
      return `Task "${mapping.taskId}" is missing or mapped to more than one child.`
    }
    seenChildren.add(mapping.childDefinitionId)
    seenTasks.add(mapping.taskId)
  }
  return !requireComplete || seenChildren.size === required.size
    ? null
    : 'Every enabled child needs exactly one Task mapping.'
}

/**
 * Full check of a stored coordinated run: contract schema, identity consistency, a recomputed
 * snapshot digest, and link shape for its phase. Returns the first problem, or null.
 */
export function coordinatedRunProblem(run: AutomationRun): string | null {
  const parsed = CoordinatedRunFieldsSchema.safeParse({
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
  if (!parsed.success) {
    return `Coordinated run fields fail the contract schema: ${parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')}`
  }
  if (
    run.idempotencyKey !== undefined &&
    (typeof run.idempotencyKey !== 'string' ||
      run.idempotencyKey.length === 0 ||
      run.idempotencyKey.length > 128)
  ) {
    return 'Coordinated run idempotency key is malformed.'
  }
  if (
    run.retainedEvidence !== undefined &&
    !RetainedEvidenceSchema.safeParse(run.retainedEvidence).success
  ) {
    return 'Coordinated run retained evidence is malformed.'
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot) {
    return run.retainedEvidence
      ? null
      : 'Coordinated run has neither a snapshot nor retained evidence.'
  }
  if (
    snapshot.automationId !== run.automationId ||
    snapshot.definitionRevision !== run.automationDefinitionRevision
  ) {
    return 'Coordinated run snapshot belongs to a different automation or revision.'
  }
  if (computeSnapshotCanonicalDigest(snapshot) !== snapshot.canonicalDigest) {
    return 'Coordinated run snapshot content does not match its canonical digest.'
  }
  const mappings = run.childMappings ?? []
  if (
    run.materializationPhase === 'intent_persisted' &&
    (run.orchestrationRunId || mappings.length > 0)
  ) {
    return 'Coordinated run records links before its orchestration Run was created.'
  }
  if (mappings.length > 0 && !run.orchestrationRunId) {
    return 'Coordinated run has Task mappings without an orchestration Run.'
  }
  // Failure phases may keep the partial links they reached; linked phases need all of them.
  return mappingProblem(
    snapshot,
    mappings,
    run.materializationPhase !== undefined && LINKED_PHASES.has(run.materializationPhase)
  )
}
