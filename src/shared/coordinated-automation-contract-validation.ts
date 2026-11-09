import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import type { CoordinatedAutomationValidationError } from './coordinated-automation-validation'

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

  if (definition.publicationPolicy) {
    if (definition.publicationPolicy.allowExternalMutation === false) {
      if (contract.allowedFinalStates.includes('published_verified')) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message:
            'Outcome contract specifies "published_verified" final state, but publicationPolicy.allowExternalMutation is false.',
          path: 'outcomeContract.allowedFinalStates'
        })
      }
      if (definition.publicationPolicy.allowedFinalStates.includes('published_verified')) {
        errors.push({
          code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
          message:
            'publicationPolicy allows "published_verified" final state, but publicationPolicy.allowExternalMutation is false.',
          path: 'publicationPolicy.allowedFinalStates'
        })
      }
    }

    const hasIntersectingFinalState = definition.publicationPolicy.allowedFinalStates.some((s) =>
      contract.allowedFinalStates.includes(s)
    )
    if (!hasIntersectingFinalState) {
      errors.push({
        code: 'INVALID_OUTCOME_CONTRACT',
        message:
          'publicationPolicy.allowedFinalStates has no overlapping states with outcomeContract.allowedFinalStates.',
        path: 'publicationPolicy.allowedFinalStates'
      })
    }
  }
}
