import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
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
  snapshot: ResolvedAutomationRunSnapshot
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

  const resultsMap = new Map<string, SemanticReceiptAcceptanceResult>()
  for (const r of receipt.acceptanceResults) {
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
      }
    }
  }

  const approvalsMap = new Map<string, SemanticReceiptApproval>()
  for (const a of receipt.approvals) {
    approvalsMap.set(a.approvalId, a)
  }

  for (const req of snapshot.outcomeContract.requiredApprovals) {
    const approval = approvalsMap.get(req.id)
    if (!approval) {
      errors.push(`Required approval "${req.id}" is missing from receipt approvals.`)
    } else {
      if (req.disallowAuthorApproval) {
        if (approval.authorIdentity && approval.approverIdentity === approval.authorIdentity) {
          errors.push(
            `Required approval "${req.id}" disallows author approval, but was approved by author "${approval.authorIdentity}".`
          )
        }
      }
      if (!approval.approverIdentity || !approval.approverIdentity.trim()) {
        errors.push(`Required approval "${req.id}" missing valid approver identity.`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
