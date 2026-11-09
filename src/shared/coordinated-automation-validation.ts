import { isTuiAgent } from './tui-agent-config'
import type {
  CoordinatedAutomationCeilings,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition,
  CoordinatedAutomationInheritedDefaults
} from './coordinated-automation-types'

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

function buildTransitiveDependencyMap(
  children: CoordinatedAutomationChildDefinition[]
): Map<string, Set<string>> {
  const directDeps = new Map<string, Set<string>>()
  for (const child of children) {
    directDeps.set(child.id, new Set(child.dependencies.map((d) => d.childId)))
  }
  const transitiveDeps = new Map<string, Set<string>>()

  function getTransitive(childId: string, visited: Set<string>): Set<string> {
    if (transitiveDeps.has(childId)) {
      return transitiveDeps.get(childId)!
    }
    const result = new Set<string>()
    visited.add(childId)
    const direct = directDeps.get(childId)
    if (direct) {
      for (const depId of direct) {
        result.add(depId)
        if (!visited.has(depId)) {
          for (const indirect of getTransitive(depId, visited)) {
            result.add(indirect)
          }
        }
      }
    }
    visited.delete(childId)
    transitiveDeps.set(childId, result)
    return result
  }

  for (const child of children) {
    getTransitive(child.id, new Set())
  }
  return transitiveDeps
}

function detectCycles(children: CoordinatedAutomationChildDefinition[]): string[][] {
  const childMap = new Map(children.map((c) => [c.id, c]))
  const cycles: string[][] = []
  const state = new Map<string, number>()
  for (const child of children) {
    state.set(child.id, 0)
  }

  function dfs(currentId: string, path: string[]) {
    state.set(currentId, 1) // GRAY
    path.push(currentId)
    const child = childMap.get(currentId)
    if (child) {
      for (const dep of child.dependencies) {
        const depId = dep.childId
        if (!childMap.has(depId)) {
          continue
        }
        const depState = state.get(depId) ?? 0
        if (depState === 1) {
          const idx = path.indexOf(depId)
          if (idx !== -1) {
            const cyclePath = path.slice(idx)
            cyclePath.push(depId)
            cycles.push(cyclePath)
          }
        } else if (depState === 0) {
          dfs(depId, path)
        }
      }
    }
    path.pop()
    state.set(currentId, 2) // BLACK
  }

  for (const child of children) {
    if (state.get(child.id) === 0) {
      dfs(child.id, [])
    }
  }
  return cycles
}

export function validateCoordinatedAutomationDefinition(
  definition: CoordinatedAutomationDefinition,
  _parentDefaults?: CoordinatedAutomationInheritedDefaults,
  parentCeilings?: CoordinatedAutomationCeilings
): CoordinatedAutomationValidationResult {
  const errors: CoordinatedAutomationValidationError[] = []
  const seenChildIds = new Set<string>()
  const childMap = new Map<string, CoordinatedAutomationChildDefinition>()

  for (const child of definition.children) {
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

  for (const child of definition.children) {
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

  const cycles = detectCycles(definition.children)
  for (const cycle of cycles) {
    errors.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Circular dependency detected: ${cycle.join(' -> ')}.`,
      childId: cycle[0],
      path: `children.${cycle[0]}.dependencies`
    })
  }

  for (const child of definition.children) {
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

  const effectiveCeilings = { ...parentCeilings, ...definition.globalCeilings }
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
  }

  if (cycles.length === 0) {
    const transitiveDeps = buildTransitiveDependencyMap(definition.children)
    const writers = definition.children.filter(
      (c) => c.enabled && c.mutationClass === 'exclusive_writer'
    )
    const laneGroups = new Map<string, CoordinatedAutomationChildDefinition[]>()
    for (const w of writers) {
      const lane = w.mutationLane ?? '__default__'
      const group = laneGroups.get(lane) ?? []
      group.push(w)
      laneGroups.set(lane, group)
    }
    for (const [lane, group] of laneGroups.entries()) {
      if (group.length > 1) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i]
            const b = group[j]
            const aHasB = transitiveDeps.get(a.id)?.has(b.id) ?? false
            const bHasA = transitiveDeps.get(b.id)?.has(a.id) ?? false
            if (!aHasB && !bHasA) {
              const display = lane === '__default__' ? 'default' : lane
              errors.push({
                code: 'UNSAFE_WRITER_LANE',
                message: `Children "${a.id}" and "${b.id}" both declare exclusive writes to mutation lane "${display}" without a dependency relationship, creating a concurrency conflict.`,
                childId: a.id,
                path: `children.${a.id}.mutationLane`
              })
            }
          }
        }
      }
    }
  }

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

  return { valid: errors.length === 0, errors }
}
