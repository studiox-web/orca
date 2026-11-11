import type { SemanticReceiptApproval } from '../../shared/coordinated-automation-receipt-types'
import type { CoordinatedRunApproval } from '../../shared/coordinated-automation-progress-types'
import type {
  OutcomeRequiredApproval,
  StageApprovalRequirement
} from '../../shared/coordinated-automation-types'

export type CoordinatedStageHostApproval = SemanticReceiptApproval & {
  scope: 'stage'
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
  targetChildId?: never
}

export type CoordinatedParentHostApproval = SemanticReceiptApproval & {
  scope: 'parent'
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  targetChildId?: string
  childDefinitionId?: never
  taskId?: never
  dispatchId?: never
}

export type CoordinatedHostApproval = CoordinatedStageHostApproval | CoordinatedParentHostApproval

/**
 * Only a fully scoped record can satisfy acceptance validation: stage approvals must name the
 * exact Task and Dispatch, parent approvals must name no stage scope. Incomplete operator
 * records stay inert instead of masquerading as host approvals.
 */
export function isCompleteCoordinatedHostApproval(
  approval: CoordinatedRunApproval
): approval is CoordinatedHostApproval {
  if (approval.scope === 'stage') {
    return (
      typeof approval.childDefinitionId === 'string' &&
      typeof approval.taskId === 'string' &&
      typeof approval.dispatchId === 'string' &&
      approval.targetChildId === undefined
    )
  }
  return (
    approval.childDefinitionId === undefined &&
    approval.taskId === undefined &&
    approval.dispatchId === undefined
  )
}

export type StageApprovalValidationContext = Readonly<{
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
  trustedAuthorIdentity?: string
  authorIdentities?: readonly string[]
}>

export type StageApprovalValidationResult = { valid: true } | { valid: false; error: string }

/**
 * One id may name a stage requirement and a parent requirement; a well-formed approval of the
 * other scope belongs to that other requirement. Anything unscoped still reaches the refusals.
 */
function approvalsForScope(
  approvals: readonly CoordinatedHostApproval[],
  approvalId: string,
  scope: 'stage' | 'parent'
): CoordinatedHostApproval[] {
  // Stage identity on a parent-scoped record (or none on a stage-scoped one) is a mis-scoped
  // approval, not the other requirement's; it stays in the match so its scope is refused.
  const belongsToOtherRequirement = (a: CoordinatedHostApproval): boolean =>
    scope === 'stage'
      ? a.scope === 'parent' && a.childDefinitionId === undefined && a.dispatchId === undefined
      : a.scope === 'stage' && typeof a.childDefinitionId === 'string'
  return approvals.filter((a) => a.approvalId === approvalId && !belongsToOtherRequirement(a))
}

function validateCommonApprovalIdentity(
  match: CoordinatedHostApproval,
  req: { id: string; role: string; disallowAuthorApproval?: boolean },
  context: {
    automationId: string
    definitionRevision: number
    automationRunId: string
    orchestrationRunId: string
    trustedAuthorIdentity?: string
    authorIdentities?: readonly string[]
  },
  label: 'Stage' | 'Parent',
  expectedScope: 'stage' | 'parent',
  usedApprovers: Set<string>
): string | null {
  if (!match.scope || typeof match.scope !== 'string') {
    return `${label} approval "${req.id}" is missing required scope.`
  }
  if (match.scope !== expectedScope) {
    return `${label} approval "${req.id}" has wrong scope "${String(match.scope)}" (expected "${expectedScope}").`
  }
  if (!match.automationId || match.automationId !== context.automationId) {
    return `${label} approval "${req.id}" belongs to foreign or missing automationId "${match.automationId ?? ''}" (expected "${context.automationId}").`
  }
  if (
    typeof match.definitionRevision !== 'number' ||
    match.definitionRevision !== context.definitionRevision
  ) {
    return `${label} approval "${req.id}" belongs to foreign or missing definitionRevision "${String(match.definitionRevision ?? '')}" (expected "${context.definitionRevision}").`
  }
  if (!match.automationRunId || match.automationRunId !== context.automationRunId) {
    return `${label} approval "${req.id}" belongs to foreign or missing automationRunId "${match.automationRunId ?? ''}" (expected "${context.automationRunId}").`
  }
  if (!match.orchestrationRunId || match.orchestrationRunId !== context.orchestrationRunId) {
    return `${label} approval "${req.id}" belongs to foreign or missing orchestrationRunId "${match.orchestrationRunId ?? ''}" (expected "${context.orchestrationRunId}").`
  }
  if (match.role !== req.role) {
    return `Required ${label.toLowerCase()} approval "${req.id}" expects role "${req.role}", received "${match.role}".`
  }
  const approver = match.approverIdentity?.trim()
  if (!approver || typeof match.approvedAt !== 'number' || !Number.isFinite(match.approvedAt)) {
    return `Required ${label.toLowerCase()} approval "${req.id}" missing valid approverIdentity or approvedAt.`
  }
  if (
    match.authorIdentity !== undefined &&
    context.trustedAuthorIdentity !== undefined &&
    match.authorIdentity !== context.trustedAuthorIdentity
  ) {
    return `${label} approval "${req.id}" authorIdentity "${match.authorIdentity}" conflicts with trusted author "${context.trustedAuthorIdentity}".`
  }
  const effectiveAuthor = context.trustedAuthorIdentity ?? match.authorIdentity
  if (req.disallowAuthorApproval && effectiveAuthor && approver === effectiveAuthor) {
    return `Required ${label.toLowerCase()} approval "${req.id}" disallows author approval by "${approver}".`
  }
  if (context.authorIdentities?.includes(approver) || match.authorIdentity?.trim() === approver) {
    return `${label} approval "${req.id}" is a self-approval: approver "${approver}" authored the approved work.`
  }
  if (usedApprovers.has(approver)) {
    return `Approver "${approver}" cannot satisfy multiple required ${label.toLowerCase()} approvals.`
  }
  usedApprovers.add(approver)
  return null
}

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
    const byId = approvalsForScope(approvals, req.id, 'stage')
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
    const commonError = validateCommonApprovalIdentity(
      match,
      req,
      context,
      'Stage',
      'stage',
      usedApprovers
    )
    if (commonError) {
      return { valid: false, error: commonError }
    }
    if (
      !match.childDefinitionId ||
      match.childDefinitionId !== context.childDefinitionId ||
      !match.taskId ||
      match.taskId !== context.taskId ||
      !context.dispatchId ||
      !match.dispatchId ||
      match.dispatchId !== context.dispatchId ||
      match.targetChildId !== undefined
    ) {
      return {
        valid: false,
        error: `Stage approval "${req.id}" has wrong or incomplete stage worker scope (expected child "${context.childDefinitionId}" task "${context.taskId}" dispatch "${context.dispatchId}").`
      }
    }
  }

  return { valid: true }
}

export type ParentApprovalResolutionContext = Readonly<{
  automationId: string
  definitionRevision: number
  automationRunId: string
  orchestrationRunId: string
  trustedAuthorIdentity: string
  authorIdentities?: readonly string[]
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
    const byId = approvalsForScope(approvals, req.id, 'parent')
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
    const commonError = validateCommonApprovalIdentity(
      match,
      req,
      context,
      'Parent',
      'parent',
      usedApprovers
    )
    if (commonError) {
      errors.push(commonError)
      continue
    }
    if (
      match.childDefinitionId !== undefined ||
      match.taskId !== undefined ||
      match.dispatchId !== undefined
    ) {
      errors.push(`Parent approval "${req.id}" has unexpected stage worker scope fields.`)
      continue
    }

    if (req.targetChildId !== undefined) {
      if (!match.targetChildId || match.targetChildId !== req.targetChildId) {
        errors.push(
          `Parent approval "${req.id}" has wrong or missing targetChildId scope "${match.targetChildId ?? 'none'}" (expected "${req.targetChildId}").`
        )
        continue
      }
    } else if (match.targetChildId !== undefined) {
      errors.push(
        `Parent approval "${req.id}" has unexpected child scope "${match.targetChildId}".`
      )
      continue
    }

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
