import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import type { CoordinatedAutomationValidationError } from './coordinated-automation-validation'

export const DEFAULT_MUTATION_LANE_SENTINEL = '@@orca_internal_default_writer_lane@@'

export function validateMutationLanes(
  definition: CoordinatedAutomationDefinition,
  transitiveDeps: Map<string, Set<string>>,
  errors: CoordinatedAutomationValidationError[]
): void {
  const allWriters = definition.children.filter(
    (c) =>
      c.enabled && (c.mutationClass === 'exclusive_writer' || c.mutationClass === 'shared_writer')
  )
  const laneGroups = new Map<string, CoordinatedAutomationChildDefinition[]>()
  for (const w of allWriters) {
    if (w.mutationLane === DEFAULT_MUTATION_LANE_SENTINEL) {
      errors.push({
        code: 'UNSAFE_WRITER_LANE',
        message: `Child "${w.id}" uses reserved internal lane identifier "${DEFAULT_MUTATION_LANE_SENTINEL}".`,
        childId: w.id,
        path: `children.${w.id}.mutationLane`
      })
    }
    const lane = w.mutationLane ?? DEFAULT_MUTATION_LANE_SENTINEL
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
          if (a.mutationClass === 'exclusive_writer' && b.mutationClass === 'exclusive_writer') {
            const aHasB = transitiveDeps.get(a.id)?.has(b.id) ?? false
            const bHasA = transitiveDeps.get(b.id)?.has(a.id) ?? false
            if (!aHasB && !bHasA) {
              const display = lane === DEFAULT_MUTATION_LANE_SENTINEL ? 'default' : lane
              errors.push({
                code: 'UNSAFE_WRITER_LANE',
                message: `Children "${a.id}" and "${b.id}" both declare exclusive writes to mutation lane "${display}" without a dependency relationship, creating a concurrency conflict.`,
                childId: a.id,
                path: `children.${a.id}.mutationLane`
              })
            }
          } else if (
            a.mutationClass === 'exclusive_writer' ||
            b.mutationClass === 'exclusive_writer'
          ) {
            const aHasB = transitiveDeps.get(a.id)?.has(b.id) ?? false
            const bHasA = transitiveDeps.get(b.id)?.has(a.id) ?? false
            if (!aHasB && !bHasA) {
              const display = lane === DEFAULT_MUTATION_LANE_SENTINEL ? 'default' : lane
              errors.push({
                code: 'UNSAFE_WRITER_LANE',
                message: `Children "${a.id}" (${a.mutationClass}) and "${b.id}" (${b.mutationClass}) both write to mutation lane "${display}" without a dependency relationship, creating an unsafe concurrency conflict.`,
                childId: a.id,
                path: `children.${a.id}.mutationLane`
              })
            }
          }
        }
      }
    }
  }
}
