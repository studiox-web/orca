import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt,
  SemanticReceiptAcceptanceResult,
  SemanticReceiptApproval
} from './coordinated-automation-receipt-types'

export type ReceiptSnapshotValidationResult = {
  valid: boolean
  errors: string[]
}

/**
 * Validates a semantic completion receipt against a frozen resolved automation run snapshot.
 */
export function validateReceiptAgainstSnapshot(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context?: ReceiptValidationContext
): ReceiptSnapshotValidationResult {
  const errors: string[] = []

  if (receipt.frozenConfigDigest !== snapshot.canonicalDigest) {
    errors.push(
      `Receipt frozenConfigDigest "${receipt.frozenConfigDigest}" does not match snapshot canonicalDigest "${snapshot.canonicalDigest}".`
    )
  }

  if (receipt.identityChain.automationId !== snapshot.automationId) {
    errors.push(
      `Receipt identityChain.automationId "${receipt.identityChain.automationId}" does not match snapshot automationId "${snapshot.automationId}".`
    )
  }

  if (receipt.identityChain.definitionRevision !== snapshot.definitionRevision) {
    errors.push(
      `Receipt identityChain.definitionRevision (${receipt.identityChain.definitionRevision}) does not match snapshot definitionRevision (${snapshot.definitionRevision}).`
    )
  }

  if (receipt.identityChain.hostId !== snapshot.executionTarget.id) {
    errors.push(
      `Receipt identityChain.hostId "${receipt.identityChain.hostId}" does not match snapshot executionTarget id "${snapshot.executionTarget.id}".`
    )
  }
  if (context?.trustedHostId && receipt.identityChain.hostId !== context.trustedHostId) {
    errors.push(
      `Receipt identityChain.hostId "${receipt.identityChain.hostId}" does not match trusted context hostId "${context.trustedHostId}".`
    )
  }

  if (receipt.identityChain.targetExecutionAuthority) {
    const auth = receipt.identityChain.targetExecutionAuthority
    if (snapshot.executionTarget.type === 'local') {
      if (
        auth !== 'local' &&
        auth !== `local:${snapshot.executionTarget.id}` &&
        auth !== snapshot.executionTarget.id
      ) {
        errors.push(
          `Receipt targetExecutionAuthority "${auth}" does not match local snapshot executionTarget.`
        )
      }
    } else if (snapshot.executionTarget.type === 'ssh') {
      if (!auth.startsWith('ssh:') || !auth.includes(snapshot.executionTarget.id)) {
        errors.push(
          `Receipt targetExecutionAuthority "${auth}" does not match ssh snapshot executionTarget "${snapshot.executionTarget.id}".`
        )
      }
    }
  }

  if (!snapshot.outcomeContract.allowedFinalStates.includes(receipt.finalState)) {
    errors.push(
      `Receipt finalState "${receipt.finalState}" is not permitted by snapshot outcomeContract allowedFinalStates (${snapshot.outcomeContract.allowedFinalStates.join(', ')}).`
    )
  }

  if (!snapshot.publicationPolicy.allowedFinalStates.includes(receipt.finalState)) {
    errors.push(
      `Receipt finalState "${receipt.finalState}" is not permitted by snapshot publicationPolicy allowedFinalStates (${snapshot.publicationPolicy.allowedFinalStates.join(', ')}).`
    )
  }

  if (receipt.identityChain.taskMappings) {
    const resolvedChildIds = new Set(snapshot.resolvedChildren.map((c) => c.childDefinitionId))
    const seenMapped = new Set<string>()
    for (const m of receipt.identityChain.taskMappings) {
      if (!resolvedChildIds.has(m.childDefinitionId)) {
        errors.push(
          `Receipt taskMapping references unknown childDefinitionId "${m.childDefinitionId}".`
        )
      }
      if (seenMapped.has(m.childDefinitionId)) {
        errors.push(
          `Receipt taskMapping contains duplicate mapping for childDefinitionId "${m.childDefinitionId}".`
        )
      }
      seenMapped.add(m.childDefinitionId)
    }
    for (const child of snapshot.resolvedChildren) {
      if (child.enabled && !seenMapped.has(child.childDefinitionId)) {
        errors.push(`Missing taskMapping for enabled child "${child.childDefinitionId}".`)
      }
    }
  }

  const resultsMap = new Map<string, SemanticReceiptAcceptanceResult>()
  const seenCriteria = new Set<string>()
  for (const r of receipt.acceptanceResults) {
    if (seenCriteria.has(r.criterionId)) {
      errors.push(`Duplicate acceptance result for criterion "${r.criterionId}".`)
    }
    seenCriteria.add(r.criterionId)
    resultsMap.set(r.criterionId, r)
  }

  for (const criterion of snapshot.outcomeContract.acceptanceCriteria) {
    if (criterion.required) {
      const result = resultsMap.get(criterion.id)
      if (!result) {
        errors.push(
          `Required acceptance criterion "${criterion.id}" has no acceptance result in receipt.`
        )
      } else if (result.status === 'failed') {
        errors.push(`Required acceptance criterion "${criterion.id}" failed acceptance evaluation.`)
      } else if (result.status === 'satisfied') {
        if (
          !result.evidence ||
          result.evidence.length === 0 ||
          result.evidence.some((e) => !e.trim())
        ) {
          errors.push(
            `Satisfied acceptance criterion "${criterion.id}" must include non-empty evidence references.`
          )
        }
      } else if (result.status === 'waived') {
        if (!result.waiver?.authorizedBy?.trim()) {
          errors.push(
            `Waived required acceptance criterion "${criterion.id}" requires waiver authority (authorizedBy).`
          )
        }
        if (
          !result.evidence ||
          result.evidence.length === 0 ||
          result.evidence.some((e) => !e.trim())
        ) {
          errors.push(
            `Waived required acceptance criterion "${criterion.id}" must include non-empty evidence references.`
          )
        }
      }
    }
  }

  const approvalsMap = new Map<string, SemanticReceiptApproval>()
  const seenApprovals = new Set<string>()
  for (const a of receipt.approvals) {
    if (seenApprovals.has(a.approvalId)) {
      errors.push(`Duplicate approval for requirement "${a.approvalId}".`)
    }
    seenApprovals.add(a.approvalId)
    approvalsMap.set(a.approvalId, a)
  }

  const usedApprovers = new Set<string>()
  for (const req of snapshot.outcomeContract.requiredApprovals) {
    const approval = approvalsMap.get(req.id)
    if (!approval) {
      errors.push(`Required approval "${req.id}" is missing from receipt approvals.`)
    } else {
      if (approval.role !== req.role) {
        errors.push(
          `Required approval "${req.id}" expects role "${req.role}", but was approved with role "${approval.role}".`
        )
      }
      if (usedApprovers.has(approval.approverIdentity)) {
        errors.push(
          `Approver "${approval.approverIdentity}" cannot satisfy multiple required approvals (already approved another requirement).`
        )
      }
      usedApprovers.add(approval.approverIdentity)

      if (req.disallowAuthorApproval) {
        const author = context?.trustedAuthorIdentity ?? approval.authorIdentity
        if (!author || !author.trim()) {
          errors.push(
            `Required approval "${req.id}" disallows author approval, but author identity was not provided in trusted context or receipt.`
          )
        } else if (approval.approverIdentity === author) {
          errors.push(
            `Required approval "${req.id}" disallows author approval, but was approved by author "${author}".`
          )
        }
      }
      if (!approval.approverIdentity || !approval.approverIdentity.trim()) {
        errors.push(`Required approval "${req.id}" missing valid approver identity.`)
      }
    }
  }

  if (receipt.effectReceipts.length > 0) {
    if (!snapshot.publicationPolicy.allowExternalMutation) {
      errors.push(
        'Receipt contains effectReceipts, but snapshot publicationPolicy.allowExternalMutation is false.'
      )
    }
    for (const effect of receipt.effectReceipts) {
      if (effect.status === 'denied' || effect.status === 'uncertain') {
        errors.push(
          `Effect receipt for "${effect.kind}" has invalid or unverified status "${effect.status}".`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
