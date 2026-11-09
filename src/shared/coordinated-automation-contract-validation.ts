import type {
  AutomationOutcomeContract,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import type { CoordinatedAutomationValidationError } from './coordinated-automation-validation'
import { getEffectCriterionKind } from './coordinated-automation-receipt-effect-validation'

/**
 * Criterion and approval IDs key receipt results; duplicates would let one result satisfy
 * several requirements, so they are rejected wherever a contract is accepted.
 */
export function validateOutcomeContractIds(
  contract: Pick<AutomationOutcomeContract, 'acceptanceCriteria' | 'requiredApprovals'>,
  errors: CoordinatedAutomationValidationError[]
): void {
  const seenCriteria = new Set<string>()
  for (const c of contract.acceptanceCriteria) {
    if (seenCriteria.has(c.id)) {
      errors.push({
        code: 'INVALID_OUTCOME_CONTRACT',
        message: `Duplicate acceptance criterion ID "${c.id}".`,
        path: `outcomeContract.acceptanceCriteria.${c.id}`
      })
    }
    seenCriteria.add(c.id)
    if (c.kind === 'effect' && getEffectCriterionKind(c.details) === null) {
      errors.push({
        code: 'INVALID_OUTCOME_CONTRACT',
        message: `Effect acceptance criterion "${c.id}" must declare a non-empty details.effectKind.`,
        path: `outcomeContract.acceptanceCriteria.${c.id}.details.effectKind`
      })
    }
  }
  const seenApprovals = new Set<string>()
  for (const a of contract.requiredApprovals) {
    if (seenApprovals.has(a.id)) {
      errors.push({
        code: 'INVALID_OUTCOME_CONTRACT',
        message: `Duplicate required approval ID "${a.id}".`,
        path: `outcomeContract.requiredApprovals.${a.id}`
      })
    }
    seenApprovals.add(a.id)
  }
}

export function validateOutcomeContract(
  definition: CoordinatedAutomationDefinition,
  childMap: Map<string, CoordinatedAutomationChildDefinition>,
  errors: CoordinatedAutomationValidationError[]
): void {
  const contract = definition.outcomeContract
  if (!contract.humanStatement?.trim()) {
    errors.push({
      code: 'INVALID_OUTCOME_CONTRACT',
      message: 'Outcome contract must contain a non-empty human statement.',
      path: 'outcomeContract.humanStatement'
    })
  }
  if (!contract.allowedFinalStates?.length) {
    errors.push({
      code: 'INVALID_OUTCOME_CONTRACT',
      message: 'Outcome contract must specify at least one allowed final state.',
      path: 'outcomeContract.allowedFinalStates'
    })
  }

  validateOutcomeContractIds(contract, errors)

  for (const c of contract.acceptanceCriteria) {
    if (c.targetChildId) {
      const target = childMap.get(c.targetChildId)
      if (!target) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message: `Acceptance criterion "${c.id}" targets unknown child ID "${c.targetChildId}".`,
          path: `outcomeContract.acceptanceCriteria.${c.id}`
        })
      } else if (!target.enabled) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message: `Acceptance criterion "${c.id}" targets disabled child "${c.targetChildId}".`,
          path: `outcomeContract.acceptanceCriteria.${c.id}`
        })
      } else if (target.mutationClass === 'read_only' && c.kind === 'effect') {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message: `Acceptance criterion "${c.id}" requires an effect from child "${c.targetChildId}", but the child has mutationClass "read_only".`,
          path: `outcomeContract.acceptanceCriteria.${c.id}`
        })
      }
    }
  }

  for (const a of contract.requiredApprovals) {
    if (a.targetChildId) {
      const target = childMap.get(a.targetChildId)
      if (!target) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message: `Required approval "${a.id}" targets unknown child ID "${a.targetChildId}".`,
          path: `outcomeContract.requiredApprovals.${a.id}`
        })
      } else if (!target.enabled) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message: `Required approval "${a.id}" targets disabled child "${a.targetChildId}".`,
          path: `outcomeContract.requiredApprovals.${a.id}`
        })
      }
    }
  }

  const pub = definition.publicationPolicy
  const effectiveAllowedFinalStates = pub?.allowedFinalStates ?? ['completed']
  const effectiveAllowExternalMutation = pub?.allowExternalMutation ?? false
  const effectiveRequireHumanDecision = pub?.requireHumanDecisionForProduction ?? true

  const mentionsPublishedVerified =
    contract.allowedFinalStates.includes('published_verified') ||
    effectiveAllowedFinalStates.includes('published_verified')

  if (mentionsPublishedVerified) {
    if (!effectiveAllowExternalMutation) {
      errors.push({
        code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
        message:
          'Outcome contract or publication policy specifies "published_verified" final state, but publicationPolicy.allowExternalMutation is false.',
        path: 'outcomeContract.allowedFinalStates'
      })
    }
    const hasWriterChild = Array.from(childMap.values()).some(
      (c) =>
        c.enabled && (c.mutationClass === 'exclusive_writer' || c.mutationClass === 'shared_writer')
    )
    const hasEffectCriterion = contract.acceptanceCriteria.some((c) => c.kind === 'effect')
    if (!hasWriterChild || !hasEffectCriterion || !effectiveRequireHumanDecision) {
      errors.push({
        code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
        message:
          'Final state "published_verified" requires at least one active writer child, at least one effect criterion, and a human production decision gate.',
        path: 'outcomeContract.allowedFinalStates'
      })
    }
  }

  const hasIntersectingFinalState = effectiveAllowedFinalStates.some((s) =>
    contract.allowedFinalStates.includes(s)
  )
  if (!hasIntersectingFinalState) {
    errors.push({
      code: 'INVALID_OUTCOME_CONTRACT',
      message: pub
        ? 'publicationPolicy.allowedFinalStates has no overlapping states with outcomeContract.allowedFinalStates.'
        : 'outcomeContract.allowedFinalStates has no overlapping states with default publication allowed states (["completed"]).',
      path: pub ? 'publicationPolicy.allowedFinalStates' : 'outcomeContract.allowedFinalStates'
    })
  }
}
