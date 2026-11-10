import type { SemanticReceiptApproval } from '../../shared/coordinated-automation-receipt-types'
import type {
  OutcomeRequiredApproval,
  StageApprovalRequirement
} from '../../shared/coordinated-automation-types'

export type CoordinatedHostApproval = SemanticReceiptApproval & {
  automationRunId?: string
  orchestrationRunId?: string
  scope?: 'stage' | 'parent'
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
  targetChildId?: string
}

export type StageApprovalValidationContext = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
  trustedAuthorIdentity?: string
}>

export type StageApprovalValidationResult = { valid: true } | { valid: false; error: string }

export function validateStageApprovals(
  requirements: readonly StageApprovalRequirement[] | undefined,
  hostApprovals: readonly CoordinatedHostApproval[] | undefined,
  context: StageApprovalValidationContext
): StageApprovalValidationResult {
  const required = (requirements ?? []).filter((r) => r.required !== false)
  if (required.length === 0) {
    return { valid: true }
  }

  const approvals = hostApprovals ?? []
  const usedApprovers = new Set<string>()

  for (const req of required) {
    const byId = approvals.filter((a) => a.approvalId === req.id)
    if (byId.length === 0) {
      return {
        valid: false,
        error: `Required stage approval "${req.id}" (role "${req.role}") missing from host approvals.`
      }
    }
    if (byId.length > 1) {
      return {
        valid: false,
        error: `Duplicate host approval for stage requirement "${req.id}".`
      }
    }

    const match = byId[0]
    if (!match.automationRunId || match.automationRunId !== context.automationRunId) {
      return {
        valid: false,
        error: `Stage approval "${req.id}" belongs to foreign or missing automationRunId "${match.automationRunId ?? ''}" (expected "${context.automationRunId}").`
      }
    }
    if (
      match.orchestrationRunId !== undefined &&
      match.orchestrationRunId !== context.orchestrationRunId
    ) {
      return {
        valid: false,
        error: `Stage approval "${req.id}" belongs to foreign orchestrationRunId "${match.orchestrationRunId}" (expected "${context.orchestrationRunId}").`
      }
    }

    if (
      (match.scope !== undefined && match.scope !== 'stage') ||
      !match.childDefinitionId ||
      match.childDefinitionId !== context.childDefinitionId ||
      (match.taskId !== undefined && match.taskId !== context.taskId) ||
      (match.dispatchId !== undefined && match.dispatchId !== context.dispatchId)
    ) {
      return {
        valid: false,
        error: `Stage approval "${req.id}" has wrong scope (expected stage child "${context.childDefinitionId}").`
      }
    }

    if (match.role !== req.role) {
      return {
        valid: false,
        error: `Required stage approval "${req.id}" expects role "${req.role}", received "${match.role}".`
      }
    }

    const approver = match.approverIdentity?.trim()
    if (!approver) {
      return {
        valid: false,
        error: `Required stage approval "${req.id}" missing valid approverIdentity.`
      }
    }
    if (
      match.authorIdentity !== undefined &&
      context.trustedAuthorIdentity !== undefined &&
      match.authorIdentity !== context.trustedAuthorIdentity
    ) {
      return {
        valid: false,
        error: `Stage approval "${req.id}" authorIdentity "${match.authorIdentity}" conflicts with trusted author "${context.trustedAuthorIdentity}".`
      }
    }
    const effectiveAuthor = context.trustedAuthorIdentity ?? match.authorIdentity
    if (req.disallowAuthorApproval && effectiveAuthor && approver === effectiveAuthor) {
      return {
        valid: false,
        error: `Required stage approval "${req.id}" disallows author approval by "${approver}".`
      }
    }
    if (usedApprovers.has(approver)) {
      return {
        valid: false,
        error: `Approver "${approver}" cannot satisfy multiple required stage approvals.`
      }
    }
    usedApprovers.add(approver)
  }

  return { valid: true }
}

export type ParentApprovalResolutionContext = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  trustedAuthorIdentity: string
}>

export type ParentApprovalResolutionResult =
  | { valid: true; approvals: SemanticReceiptApproval[] }
  | { valid: false; errors: string[] }

export function resolveParentReceiptApprovals(
  requirements: readonly OutcomeRequiredApproval[],
  hostApprovals: readonly CoordinatedHostApproval[] | undefined,
  context: ParentApprovalResolutionContext
): ParentApprovalResolutionResult {
  const approvals = hostApprovals ?? []
  const resolved: SemanticReceiptApproval[] = []
  const usedApprovers = new Set<string>()
  const errors: string[] = []

  for (const req of requirements) {
    const byId = approvals.filter((a) => a.approvalId === req.id)
    if (byId.length === 0) {
      errors.push(
        `Required approval "${req.id}" (role "${req.role}") is missing from host approvals.`
      )
      continue
    }
    if (byId.length > 1) {
      errors.push(`Duplicate host approval for requirement "${req.id}".`)
      continue
    }

    const match = byId[0]
    if (!match.automationRunId || match.automationRunId !== context.automationRunId) {
      errors.push(
        `Parent approval "${req.id}" belongs to foreign or missing automationRunId "${match.automationRunId ?? ''}" (expected "${context.automationRunId}").`
      )
      continue
    }
    if (
      match.orchestrationRunId !== undefined &&
      match.orchestrationRunId !== context.orchestrationRunId
    ) {
      errors.push(
        `Parent approval "${req.id}" belongs to foreign orchestrationRunId "${match.orchestrationRunId}" (expected "${context.orchestrationRunId}").`
      )
      continue
    }

    if (
      (match.scope !== undefined && match.scope !== 'parent') ||
      match.taskId !== undefined ||
      match.dispatchId !== undefined
    ) {
      errors.push(
        `Parent approval "${req.id}" has wrong scope "${match.scope ?? 'stage'}"; expected parent scope.`
      )
      continue
    }

    const targetChild = match.targetChildId ?? match.childDefinitionId
    if (req.targetChildId !== undefined) {
      if (targetChild !== req.targetChildId) {
        errors.push(
          `Parent approval "${req.id}" has wrong targetChildId scope "${targetChild ?? 'none'}" (expected "${req.targetChildId}").`
        )
        continue
      }
    } else if (targetChild !== undefined) {
      errors.push(`Parent approval "${req.id}" has unexpected child scope "${targetChild}".`)
      continue
    }

    if (match.role !== req.role) {
      errors.push(
        `Required approval "${req.id}" expects role "${req.role}", but was approved with role "${match.role}".`
      )
      continue
    }

    const approver = match.approverIdentity?.trim()
    if (!approver) {
      errors.push(`Required approval "${req.id}" missing valid approver identity.`)
      continue
    }
    if (
      match.authorIdentity !== undefined &&
      match.authorIdentity !== context.trustedAuthorIdentity
    ) {
      errors.push(
        `Approval "${req.id}" names author "${match.authorIdentity}", which conflicts with the trusted author.`
      )
      continue
    }
    if (req.disallowAuthorApproval && approver === context.trustedAuthorIdentity) {
      errors.push(
        `Required approval "${req.id}" disallows author approval, but was approved by author "${context.trustedAuthorIdentity}".`
      )
      continue
    }
    if (usedApprovers.has(approver)) {
      errors.push(
        `Approver "${approver}" cannot satisfy multiple required approvals (already approved another requirement).`
      )
      continue
    }
    usedApprovers.add(approver)

    resolved.push({
      approvalId: match.approvalId,
      role: match.role,
      approverIdentity: match.approverIdentity,
      ...(match.authorIdentity !== undefined ? { authorIdentity: match.authorIdentity } : {}),
      approvedAt: match.approvedAt,
      ...(match.evidence !== undefined ? { evidence: match.evidence } : {})
    })
  }

  return errors.length === 0 ? { valid: true, approvals: resolved } : { valid: false, errors }
}
