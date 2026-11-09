import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt,
  SemanticReceiptAcceptanceResult,
  SemanticReceiptApproval
} from './coordinated-automation-receipt-types'

function hasNonEmptyEvidence(evidence: readonly string[] | undefined): boolean {
  return !!evidence && evidence.length > 0 && evidence.every((e) => e.trim().length > 0)
}

function validateWaiver(
  result: SemanticReceiptAcceptanceResult,
  required: boolean,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const label = required ? 'Waived required acceptance criterion' : 'Waived acceptance criterion'
  const authorizedBy = result.waiver?.authorizedBy.trim()
  if (!authorizedBy) {
    errors.push(`${label} "${result.criterionId}" requires waiver authority (authorizedBy).`)
  } else {
    if (authorizedBy === context.trustedAuthorIdentity) {
      errors.push(
        `${label} "${result.criterionId}" cannot be waived by the trusted author "${authorizedBy}".`
      )
    }
    const policy = context.waiverPolicy
    const authority = policy?.authorities.find((a) => a.identity === authorizedBy)
    if (!policy || !authority) {
      errors.push(
        `${label} "${result.criterionId}" waiver authority "${authorizedBy}" is not granted by trusted context.`
      )
    } else if (!policy.allowedRoles.includes(authority.role)) {
      errors.push(
        `${label} "${result.criterionId}" waiver authority "${authorizedBy}" has role "${authority.role}", which is not an allowed waiver role.`
      )
    }
  }
  if (!hasNonEmptyEvidence(result.evidence)) {
    errors.push(`${label} "${result.criterionId}" must include non-empty evidence references.`)
  }
}

export function validateReceiptAcceptanceResults(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const criteria = new Map(snapshot.outcomeContract.acceptanceCriteria.map((c) => [c.id, c]))
  const resultsMap = new Map<string, SemanticReceiptAcceptanceResult>()
  for (const r of receipt.acceptanceResults) {
    if (resultsMap.has(r.criterionId)) {
      errors.push(`Duplicate acceptance result for criterion "${r.criterionId}".`)
    }
    resultsMap.set(r.criterionId, r)
    const criterion = criteria.get(r.criterionId)
    if (!criterion) {
      errors.push(`Receipt acceptance result references unknown criterion "${r.criterionId}".`)
      continue
    }
    if (r.status === 'waived') {
      validateWaiver(r, criterion.required, context, errors)
    }
  }

  for (const criterion of snapshot.outcomeContract.acceptanceCriteria) {
    if (!criterion.required) {
      continue
    }
    const result = resultsMap.get(criterion.id)
    if (!result) {
      errors.push(
        `Required acceptance criterion "${criterion.id}" has no acceptance result in receipt.`
      )
    } else if (result.status === 'failed') {
      errors.push(`Required acceptance criterion "${criterion.id}" failed acceptance evaluation.`)
    } else if (result.status === 'satisfied' && !hasNonEmptyEvidence(result.evidence)) {
      errors.push(
        `Satisfied acceptance criterion "${criterion.id}" must include non-empty evidence references.`
      )
    }
  }
}

export function validateReceiptApprovals(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const author = context.trustedAuthorIdentity
  const requirements = new Set(snapshot.outcomeContract.requiredApprovals.map((r) => r.id))
  const approvalsMap = new Map<string, SemanticReceiptApproval>()
  for (const a of receipt.approvals) {
    if (approvalsMap.has(a.approvalId)) {
      errors.push(`Duplicate approval for requirement "${a.approvalId}".`)
    }
    approvalsMap.set(a.approvalId, a)
    if (!requirements.has(a.approvalId)) {
      errors.push(`Receipt approval references unknown approval requirement "${a.approvalId}".`)
    }
    // The receipt may echo the author, but it is never trusted; a conflicting echo is an error.
    if (a.authorIdentity !== undefined && a.authorIdentity !== author) {
      errors.push(
        `Approval "${a.approvalId}" names author "${a.authorIdentity}", which conflicts with the trusted author.`
      )
    }
  }

  const usedApprovers = new Set<string>()
  for (const req of snapshot.outcomeContract.requiredApprovals) {
    const approval = approvalsMap.get(req.id)
    if (!approval) {
      errors.push(`Required approval "${req.id}" is missing from receipt approvals.`)
      continue
    }
    if (approval.role !== req.role) {
      errors.push(
        `Required approval "${req.id}" expects role "${req.role}", but was approved with role "${approval.role}".`
      )
    }
    if (!approval.approverIdentity.trim()) {
      errors.push(`Required approval "${req.id}" missing valid approver identity.`)
    }
    if (usedApprovers.has(approval.approverIdentity)) {
      errors.push(
        `Approver "${approval.approverIdentity}" cannot satisfy multiple required approvals (already approved another requirement).`
      )
    }
    usedApprovers.add(approval.approverIdentity)
    if (req.disallowAuthorApproval && approval.approverIdentity === author) {
      errors.push(
        `Required approval "${req.id}" disallows author approval, but was approved by author "${author}".`
      )
    }
  }
}
