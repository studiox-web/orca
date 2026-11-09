import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt,
  SemanticReceiptEffect
} from './coordinated-automation-receipt-types'

type DeclaredEffect = {
  source: string
  kind: string | null
  namespace: string | null
  required: boolean
}

function effectKey(kind: string, namespace: string | null): string {
  return JSON.stringify([kind, namespace])
}

/**
 * Effect criterion kind is declared via `details.effectKind`; contract validation rejects
 * effect criteria without it, and a missing kind here can never match a receipt.
 */
export function getEffectCriterionKind(
  details: Record<string, unknown> | undefined
): string | null {
  const kind = details?.effectKind
  return typeof kind === 'string' && kind.trim().length > 0 ? kind : null
}

function collectDeclaredEffects(snapshot: ResolvedAutomationRunSnapshot): DeclaredEffect[] {
  const declared: DeclaredEffect[] = []
  for (const c of snapshot.outcomeContract.acceptanceCriteria) {
    if (c.kind === 'effect') {
      declared.push({
        source: `acceptance criterion "${c.id}"`,
        kind: getEffectCriterionKind(c.details),
        namespace: c.namespace ?? null,
        required: c.required
      })
    }
  }
  for (const child of snapshot.resolvedChildren) {
    if (!child.enabled) {
      continue
    }
    for (const e of child.stageAcceptance?.requiredEffects ?? []) {
      declared.push({
        source: `child "${child.childDefinitionId}" required effect "${e.kind}"`,
        kind: e.kind,
        namespace: e.namespace ?? null,
        // Stage effects are required unless explicitly marked optional (fail closed).
        required: e.required !== false
      })
    }
  }
  return declared
}

function validateProductionDecision(
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  if (!snapshot.publicationPolicy.requireHumanDecisionForProduction) {
    errors.push(
      'Final state "published_verified" requires publicationPolicy.requireHumanDecisionForProduction to be true.'
    )
    return
  }
  const decision = context.productionDecision
  if (!decision) {
    errors.push(
      'Final state "published_verified" requires a trusted human production decision, but none was provided.'
    )
    return
  }
  const approver = decision.approverIdentity.trim()
  if (!approver || !decision.role.trim()) {
    errors.push('Trusted production decision must name an approver identity and role.')
  } else if (approver === context.trustedAuthorIdentity) {
    errors.push(
      `Trusted production decision must come from an approver distinct from the author "${context.trustedAuthorIdentity}".`
    )
  }
}

/**
 * Every effect receipt is an external mutation: it must be permitted by publication policy,
 * match a declared effect by exact kind and namespace, and be verified (not merely applied).
 */
export function validateReceiptEffects(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const policy = snapshot.publicationPolicy
  const publishing = receipt.finalState === 'published_verified'
  if ((receipt.effectReceipts.length > 0 || publishing) && !policy.allowExternalMutation) {
    errors.push(
      receipt.effectReceipts.length > 0
        ? 'Receipt contains effectReceipts, but snapshot publicationPolicy.allowExternalMutation is false.'
        : 'Final state "published_verified" requires publicationPolicy.allowExternalMutation to be true.'
    )
  }

  const declared = collectDeclaredEffects(snapshot)
  const declaredKeys = new Set(
    declared.flatMap((d) => (d.kind === null ? [] : [effectKey(d.kind, d.namespace)]))
  )
  const receipts = new Map<string, SemanticReceiptEffect>()
  for (const effect of receipt.effectReceipts) {
    const key = effectKey(effect.kind, effect.namespace ?? null)
    const label = `Effect receipt "${effect.kind}"${effect.namespace ? ` (namespace "${effect.namespace}")` : ''}`
    if (receipts.has(key)) {
      errors.push(`${label} is duplicated.`)
    }
    receipts.set(key, effect)
    if (!declaredKeys.has(key)) {
      errors.push(`${label} does not match any declared effect kind and namespace.`)
    }
    if (effect.status !== 'verified') {
      errors.push(`${label} has status "${effect.status}"; external effects must be verified.`)
    }
  }

  for (const d of declared) {
    if (!d.required) {
      continue
    }
    if (d.kind === null) {
      errors.push(`Required effect for ${d.source} does not declare details.effectKind.`)
      continue
    }
    const effect = receipts.get(effectKey(d.kind, d.namespace))
    if (!effect || effect.status !== 'verified') {
      errors.push(
        `Required effect "${d.kind}" (namespace "${d.namespace ?? ''}") for ${d.source} has no verified effect receipt.`
      )
    }
  }

  if (publishing) {
    const hasVerifiedDeclared = declared.some(
      (d) => d.kind !== null && receipts.get(effectKey(d.kind, d.namespace))?.status === 'verified'
    )
    if (!hasVerifiedDeclared) {
      errors.push(
        'Final state "published_verified" requires at least one verified effect receipt matching a declared effect.'
      )
    }
    validateProductionDecision(snapshot, context, errors)
  }
}
