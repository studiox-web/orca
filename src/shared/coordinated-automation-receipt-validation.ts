import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt
} from './coordinated-automation-receipt-types'
import {
  validateReceiptRunIdentity,
  validateReceiptTaskMappings,
  validateTrustedContextShape
} from './coordinated-automation-receipt-identity-validation'
import {
  validateReceiptAcceptanceResults,
  validateReceiptApprovals
} from './coordinated-automation-receipt-acceptance-validation'
import { validateReceiptEffects } from './coordinated-automation-receipt-effect-validation'

export { parseExecutionAuthority } from './coordinated-automation-receipt-identity-validation'
export { getEffectCriterionKind } from './coordinated-automation-receipt-effect-validation'

export type ReceiptSnapshotValidationResult = {
  valid: boolean
  errors: string[]
}

/**
 * Validates a semantic completion receipt against a frozen resolved automation run snapshot.
 *
 * Fails closed: identity, authority, attempt, mappings, author, waiver authority and the
 * production decision come only from the host-owned trusted context, never from the receipt.
 */
export function validateReceiptAgainstSnapshot(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext
): ReceiptSnapshotValidationResult {
  const errors: string[] = []

  validateTrustedContextShape(context, errors)

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

  validateReceiptRunIdentity(receipt, snapshot, context, errors)

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

  validateReceiptTaskMappings(receipt, snapshot, context, errors)
  validateReceiptAcceptanceResults(receipt, snapshot, context, errors)
  validateReceiptApprovals(receipt, snapshot, context, errors)
  validateReceiptEffects(receipt, snapshot, context, errors)

  return { valid: errors.length === 0, errors }
}
