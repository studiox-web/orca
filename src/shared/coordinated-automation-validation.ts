import { isTuiAgent } from './tui-agent-config'
import type {
  CoordinatedAutomationCeilings,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition,
  CoordinatedAutomationInheritedDefaults
} from './coordinated-automation-types'
import {
  buildTransitiveDependencyMap,
  detectCycles
} from './coordinated-automation-graph-validation'
import { validateMutationLanes } from './coordinated-automation-lane-validation'
import { validateOutcomeContract } from './coordinated-automation-contract-validation'

export * from './coordinated-automation-receipt-validation'
export * from './coordinated-automation-lane-validation'
export {
  buildTransitiveDependencyMap,
  detectCycles
} from './coordinated-automation-graph-validation'

export type CoordinatedAutomationValidationErrorCode =
  | 'DUPLICATE_CHILD_ID'
  | 'MISSING_DEPENDENCY'
  | 'DEPENDENCY_CYCLE'
  | 'DISABLED_DEPENDENCY'
  | 'FORBIDDEN_CHILD_SCHEDULE'
  | 'INCOMPATIBLE_LAUNCH_SETTINGS'
  | 'LIMIT_EXCEEDS_CEILING'
  | 'UNSAFE_WRITER_LANE'
  | 'UNATTAINABLE_ACCEPTANCE_CRITERIA'
  | 'INVALID_OUTCOME_CONTRACT'

export type CoordinatedAutomationValidationError = {
  code: CoordinatedAutomationValidationErrorCode
  message: string
  path?: string
  childId?: string
}

export type CoordinatedAutomationValidationResult = {
  valid: boolean
  errors: CoordinatedAutomationValidationError[]
}

/**
 * Graph-only checks over a child list: unique IDs, no child schedules, known dependencies,
 * no cycles, and no enabled child depending on a disabled one. Shared by full definition
 * validation and by partial update payloads that replace the children array.
 */
export function validateChildGraph(
  children: CoordinatedAutomationChildDefinition[],
  errors: CoordinatedAutomationValidationError[]
): { childMap: Map<string, CoordinatedAutomationChildDefinition>; cycles: string[][] } {
  const seenChildIds = new Set<string>()
  const childMap = new Map<string, CoordinatedAutomationChildDefinition>()

  for (const child of children) {
    const approvalIds = new Set<string>()
    for (const requirement of child.stageAcceptance?.requiredApprovals ?? []) {
      if (approvalIds.has(requirement.id)) {
        errors.push({
          code: 'INVALID_OUTCOME_CONTRACT',
          message: `Duplicate required approval ID "${requirement.id}" within child "${child.id}".`,
          childId: child.id,
          path: `children.${child.id}.stageAcceptance.requiredApprovals`
        })
      }
      approvalIds.add(requirement.id)
    }
    if (seenChildIds.has(child.id)) {
      errors.push({
        code: 'DUPLICATE_CHILD_ID',
        message: `Duplicate child definition ID "${child.id}". Child IDs must be unique within a parent Automation.`,
        childId: child.id,
        path: `children.${child.id}`
      })
    } else {
      seenChildIds.add(child.id)
      childMap.set(child.id, child)
    }

    const hasForbiddenSchedule =
      'schedule' in child || 'rrule' in child || 'cron' in child || 'dtstart' in child
    if (hasForbiddenSchedule) {
      errors.push({
        code: 'FORBIDDEN_CHILD_SCHEDULE',
        message: `Child "${child.id}" declares an independent schedule. Child automations cannot have independent schedules; schedules belong solely to the parent Automation.`,
        childId: child.id,
        path: `children.${child.id}.schedule`
      })
    }
  }

  for (const child of children) {
    for (const dep of child.dependencies) {
      if (!childMap.has(dep.childId)) {
        errors.push({
          code: 'MISSING_DEPENDENCY',
          message: `Child "${child.id}" depends on unknown child ID "${dep.childId}".`,
          childId: child.id,
          path: `children.${child.id}.dependencies`
        })
      }
    }
  }

  const cycles = detectCycles(children)
  for (const cycle of cycles) {
    errors.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Circular dependency detected: ${cycle.join(' -> ')}.`,
      childId: cycle[0],
      path: `children.${cycle[0]}.dependencies`
    })
  }

  for (const child of children) {
    if (child.enabled) {
      for (const dep of child.dependencies) {
        const depChild = childMap.get(dep.childId)
        if (depChild && !depChild.enabled) {
          errors.push({
            code: 'DISABLED_DEPENDENCY',
            message: `Enabled child "${child.id}" depends on disabled child "${dep.childId}". A runnable child cannot depend on a disabled child.`,
            childId: child.id,
            path: `children.${child.id}.dependencies`
          })
        }
      }
    }
  }

  return { childMap, cycles }
}

export function validateCoordinatedAutomationDefinition(
  definition: CoordinatedAutomationDefinition,
  parentDefaults?: CoordinatedAutomationInheritedDefaults,
  parentCeilings?: CoordinatedAutomationCeilings
): CoordinatedAutomationValidationResult {
  const errors: CoordinatedAutomationValidationError[] = []
  const { childMap, cycles } = validateChildGraph(definition.children, errors)

  const effectiveCeilings = { ...parentCeilings, ...definition.globalCeilings }

  if (effectiveCeilings.maxConcurrency !== undefined && effectiveCeilings.maxConcurrency < 1) {
    errors.push({
      code: 'LIMIT_EXCEEDS_CEILING',
      message: 'maxConcurrency ceiling must be at least 1.',
      path: 'globalCeilings.maxConcurrency'
    })
  }

  if (
    effectiveCeilings.maxDispatchStartFailures !== undefined &&
    effectiveCeilings.maxDispatchStartFailures < 1
  ) {
    errors.push({
      code: 'LIMIT_EXCEEDS_CEILING',
      message: 'maxDispatchStartFailures ceiling must be at least 1.',
      path: 'globalCeilings.maxDispatchStartFailures'
    })
  }

  for (const child of definition.children) {
    const cfg = child.launchConfig
    if (cfg.agentId && !isTuiAgent(cfg.agentId)) {
      errors.push({
        code: 'INCOMPATIBLE_LAUNCH_SETTINGS',
        message: `Child "${child.id}" specifies unknown or unsupported agent "${String(cfg.agentId)}".`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.agentId`
      })
    }

    if (cfg.workspaceMode === 'new_per_run' && cfg.reuseSession === true) {
      errors.push({
        code: 'INCOMPATIBLE_LAUNCH_SETTINGS',
        message: `Child "${child.id}" specifies workspaceMode "new_per_run" but reuseSession is true. New per-run workspaces cannot reuse sessions.`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.reuseSession`
      })
    }

    if (cfg.workspaceMode === 'existing' && cfg.baseBranch) {
      errors.push({
        code: 'INCOMPATIBLE_LAUNCH_SETTINGS',
        message: `Child "${child.id}" specifies workspaceMode "existing" but also sets baseBranch. baseBranch is only valid for new workspaces.`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.baseBranch`
      })
    }

    if (
      cfg.workspaceMode === 'existing' &&
      cfg.workspaceId === null &&
      !parentDefaults?.workspaceId
    ) {
      errors.push({
        code: 'INCOMPATIBLE_LAUNCH_SETTINGS',
        message: `Child "${child.id}" specifies workspaceMode "existing" without a valid workspaceId.`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.workspaceId`
      })
    }

    if (
      effectiveCeilings.maxWallClockSeconds &&
      cfg.timeoutSeconds &&
      cfg.timeoutSeconds > effectiveCeilings.maxWallClockSeconds
    ) {
      errors.push({
        code: 'LIMIT_EXCEEDS_CEILING',
        message: `Child "${child.id}" timeout (${cfg.timeoutSeconds}s) exceeds parent ceiling maxWallClockSeconds (${effectiveCeilings.maxWallClockSeconds}s).`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.timeoutSeconds`
      })
    }

    if (
      effectiveCeilings.maxReviewIterations !== undefined &&
      cfg.maxReviewIterations !== undefined &&
      cfg.maxReviewIterations > effectiveCeilings.maxReviewIterations
    ) {
      errors.push({
        code: 'LIMIT_EXCEEDS_CEILING',
        message: `Child "${child.id}" maxReviewIterations (${cfg.maxReviewIterations}) exceeds parent ceiling maxReviewIterations (${effectiveCeilings.maxReviewIterations}).`,
        childId: child.id,
        path: `children.${child.id}.launchConfig.maxReviewIterations`
      })
    }

    if (child.mutationClass === 'read_only' && child.stageAcceptance?.requiredEffects?.length) {
      errors.push({
        code: 'UNATTAINABLE_ACCEPTANCE_CRITERIA',
        message: `Child "${child.id}" is declared as read_only but defines requiredEffects in stageAcceptance.`,
        childId: child.id,
        path: `children.${child.id}.stageAcceptance.requiredEffects`
      })
    }
  }

  if (parentDefaults) {
    if (
      effectiveCeilings.maxWallClockSeconds &&
      parentDefaults.timeoutSeconds &&
      parentDefaults.timeoutSeconds > effectiveCeilings.maxWallClockSeconds
    ) {
      errors.push({
        code: 'LIMIT_EXCEEDS_CEILING',
        message: `Inherited default timeout (${parentDefaults.timeoutSeconds}s) exceeds parent ceiling maxWallClockSeconds (${effectiveCeilings.maxWallClockSeconds}s).`,
        path: 'inheritedDefaults.timeoutSeconds'
      })
    }
  }

  if (definition.inheritedDefaults) {
    if (
      effectiveCeilings.maxWallClockSeconds &&
      definition.inheritedDefaults.timeoutSeconds &&
      definition.inheritedDefaults.timeoutSeconds > effectiveCeilings.maxWallClockSeconds
    ) {
      errors.push({
        code: 'LIMIT_EXCEEDS_CEILING',
        message: `Inherited default timeout (${definition.inheritedDefaults.timeoutSeconds}s) exceeds parent ceiling maxWallClockSeconds (${effectiveCeilings.maxWallClockSeconds}s).`,
        path: 'inheritedDefaults.timeoutSeconds'
      })
    }
  }

  if (cycles.length === 0) {
    const transitiveDeps = buildTransitiveDependencyMap(definition.children)
    validateMutationLanes(definition, transitiveDeps, errors)
  }

  validateOutcomeContract(definition, childMap, errors)

  return { valid: errors.length === 0, errors }
}
