import { z } from 'zod'
import type { AutomationRun } from './automations-types'
import type {
  CoordinatedCompletionTrust,
  CoordinatedRunRetainedEvidence,
  ResolvedAutomationRunSnapshot
} from './coordinated-automation-types'
import type {
  CoordinatedRunChildMapping,
  CoordinatedRunMaterializationPhase
} from './coordinated-automation-saga-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt
} from './coordinated-automation-receipt-types'
import { CoordinatedRunFieldsSchema } from './coordinated-automation-snapshot-schemas'
import { computeSnapshotCanonicalDigest } from './coordinated-automation-snapshot'
import { validateReceiptAgainstSnapshot } from './coordinated-automation-receipt-validation'

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const Id = z.string().min(1).max(256)

const RetainedEvidenceSchema: z.ZodType<CoordinatedRunRetainedEvidence> = z.strictObject({
  definitionRevision: z.number().int().positive(),
  canonicalDigest: Digest,
  executionAuthority: z.string().min(1).max(600),
  children: z
    .array(z.strictObject({ childDefinitionId: z.string(), name: z.string(), role: z.string() }))
    .max(100),
  minimumEvidenceReferences: z.array(z.string()).max(100)
})

const CompletionTrustSchema: z.ZodType<CoordinatedCompletionTrust> = z.strictObject({
  authorIdentity: Id,
  activeAttempt: z.strictObject({ taskId: Id, dispatchId: Id }),
  waiverPolicy: z
    .strictObject({
      allowedRoles: z.array(Id).max(50),
      authorities: z.array(z.strictObject({ identity: Id, role: Id })).max(50)
    })
    .optional(),
  productionDecision: z
    .strictObject({ approverIdentity: Id, role: Id, decidedAt: z.number() })
    .optional()
})

type PhaseLinks = {
  orchestrationRun: 'forbidden' | 'required' | 'optional'
  /** `none-or-complete`: failure phases keep whatever atomic link set they reached. */
  mappings: 'none' | 'complete' | 'none-or-complete'
  /** Dispatch starts only after `ready_for_dispatch`; nothing earlier may carry a Dispatch. */
  dispatchIds: 'forbidden' | 'optional'
  /** A completion receipt can only follow dispatched work. */
  receipt: 'forbidden' | 'optional'
}

const FAILED: PhaseLinks = {
  orchestrationRun: 'optional',
  mappings: 'none-or-complete',
  dispatchIds: 'forbidden',
  receipt: 'forbidden'
}

/** The complete materialization phase / link invariant matrix. */
export const COORDINATED_PHASE_LINKS: Readonly<
  Record<CoordinatedRunMaterializationPhase, PhaseLinks>
> = {
  intent_persisted: {
    orchestrationRun: 'forbidden',
    mappings: 'none',
    dispatchIds: 'forbidden',
    receipt: 'forbidden'
  },
  orchestration_run_created: {
    orchestrationRun: 'required',
    mappings: 'none',
    dispatchIds: 'forbidden',
    receipt: 'forbidden'
  },
  tasks_created: {
    orchestrationRun: 'required',
    mappings: 'none',
    dispatchIds: 'forbidden',
    receipt: 'forbidden'
  },
  mappings_persisted: {
    orchestrationRun: 'required',
    mappings: 'complete',
    dispatchIds: 'forbidden',
    receipt: 'forbidden'
  },
  ready_for_dispatch: {
    orchestrationRun: 'required',
    mappings: 'complete',
    dispatchIds: 'optional',
    receipt: 'optional'
  },
  orphaned_reconciling: FAILED,
  materialization_failed: FAILED,
  compensation_failed: FAILED
}

export function mappingProblem(
  snapshot: ResolvedAutomationRunSnapshot,
  mappings: readonly CoordinatedRunChildMapping[],
  requireComplete = true
): string | null {
  const required = new Set(
    snapshot.resolvedChildren.filter((child) => child.enabled).map((c) => c.childDefinitionId)
  )
  return mappingSetProblem(required, mappings, requireComplete)
}

function mappingSetProblem(
  required: ReadonlySet<string>,
  mappings: readonly CoordinatedRunChildMapping[],
  requireComplete: boolean
): string | null {
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

function phaseLinkProblem(run: AutomationRun, links: PhaseLinks): string | null {
  const phase = run.materializationPhase
  const hasRun = Boolean(run.orchestrationRunId)
  const mappings = run.childMappings ?? []
  if (links.orchestrationRun === 'forbidden' && hasRun) {
    return `Phase ${phase} forbids an orchestration Run link.`
  }
  if (links.orchestrationRun === 'required' && !hasRun) {
    return `Phase ${phase} requires an orchestration Run link.`
  }
  if (links.mappings === 'none' && mappings.length > 0) {
    return `Phase ${phase} forbids Task mappings.`
  }
  if (mappings.length > 0 && !hasRun) {
    return `Phase ${phase} has Task mappings without an orchestration Run.`
  }
  const dispatchIds = mappings.flatMap((m) => (m.dispatchId ? [m.dispatchId] : []))
  if (links.dispatchIds === 'forbidden' && mappings.some((m) => m.dispatchId != null)) {
    return `Phase ${phase} forbids Dispatch IDs.`
  }
  if (new Set(dispatchIds).size !== dispatchIds.length) {
    return 'A Dispatch is mapped to more than one child.'
  }
  if (links.receipt === 'forbidden' && run.completionReceipt) {
    return `Phase ${phase} forbids a completion receipt.`
  }
  return null
}

function trustedReceiptContext(
  run: AutomationRun,
  trust: CoordinatedCompletionTrust,
  executionTarget: { type: string; id: string }
): ReceiptValidationContext {
  return {
    trustedAuthorIdentity: trust.authorIdentity,
    trustedHostId: executionTarget.id,
    trustedExecutionAuthority: `${executionTarget.type}:${executionTarget.id}`,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? '',
    activeAttempt: { ...trust.activeAttempt },
    trustedTaskMappings: (run.childMappings ?? []).map((m) => ({ ...m })),
    ...(trust.waiverPolicy ? { waiverPolicy: trust.waiverPolicy } : {}),
    ...(trust.productionDecision ? { productionDecision: trust.productionDecision } : {})
  }
}

/** A compacted row has no snapshot left, so its receipt is held to the retained identity. */
function compactedReceiptProblem(
  run: AutomationRun,
  receipt: SemanticCompletionReceipt,
  evidence: CoordinatedRunRetainedEvidence
): string | null {
  const chain = receipt.identityChain
  const mappingKey = (m: CoordinatedRunChildMapping): string =>
    `${m.childDefinitionId}\u0000${m.taskId}\u0000${m.dispatchId ?? ''}`
  const stored = new Set((run.childMappings ?? []).map(mappingKey))
  const sameMappings =
    chain.taskMappings.length === stored.size &&
    chain.taskMappings.every((m) => stored.has(mappingKey(m)))
  const mismatch =
    receipt.frozenConfigDigest !== evidence.canonicalDigest ||
    chain.automationId !== run.automationId ||
    chain.definitionRevision !== evidence.definitionRevision ||
    chain.automationRunId !== run.id ||
    chain.orchestrationRunId !== run.orchestrationRunId ||
    chain.targetExecutionAuthority !== evidence.executionAuthority ||
    !sameMappings
  return mismatch ? 'Compacted completion receipt does not belong to this run.' : null
}

function receiptProblem(run: AutomationRun): string | null {
  const receipt = run.completionReceipt
  if (!receipt) {
    return run.completionTrust ? 'Completion trust is recorded without a receipt.' : null
  }
  const trust = CompletionTrustSchema.safeParse(run.completionTrust)
  if (!trust.success) {
    return 'A completion receipt needs a valid host-recorded completion trust record.'
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot) {
    return run.retainedEvidence
      ? compactedReceiptProblem(run, receipt, run.retainedEvidence)
      : 'A completion receipt needs its snapshot or retained evidence.'
  }
  const result = validateReceiptAgainstSnapshot(
    receipt,
    snapshot,
    trustedReceiptContext(run, trust.data, snapshot.executionTarget)
  )
  return result.valid ? null : `Completion receipt is not this run's: ${result.errors[0]}`
}

/**
 * Full check of a stored coordinated run: contract schema, the phase/link matrix, snapshot
 * identity and recomputed digest, and any receipt through the shared trusted-context
 * validator. Returns the first problem, or null.
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
  if (run.coordinatedQuarantine !== undefined) {
    return 'Coordinated run is quarantined.'
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
  const links = COORDINATED_PHASE_LINKS[parsed.data.materializationPhase]
  const linkProblem = phaseLinkProblem(run, links)
  if (linkProblem) {
    return linkProblem
  }
  const snapshot = run.resolvedSnapshot
  const mappings = run.childMappings ?? []
  const requireComplete = links.mappings === 'complete' || mappings.length > 0
  if (snapshot) {
    if (
      snapshot.automationId !== run.automationId ||
      snapshot.definitionRevision !== run.automationDefinitionRevision
    ) {
      return 'Coordinated run snapshot belongs to a different automation or revision.'
    }
    if (computeSnapshotCanonicalDigest(snapshot) !== snapshot.canonicalDigest) {
      return 'Coordinated run snapshot content does not match its canonical digest.'
    }
    const problem = mappingProblem(snapshot, mappings, requireComplete)
    if (problem) {
      return problem
    }
  } else if (run.retainedEvidence) {
    const problem = mappingSetProblem(
      new Set(run.retainedEvidence.children.map((c) => c.childDefinitionId)),
      mappings,
      false
    )
    if (problem) {
      return problem
    }
  } else {
    return 'Coordinated run has neither a snapshot nor retained evidence.'
  }
  return receiptProblem(run)
}
