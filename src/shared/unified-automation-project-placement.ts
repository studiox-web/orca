import { normalizeRuntimePathForComparison } from './cross-platform-path'
import type { XosGoalBoard } from './xos-goals-types'

export function exactUnifiedBoardProject(
  board: XosGoalBoard,
  candidates: readonly (string | null | undefined)[]
): XosGoalBoard['projects'][number] | null {
  const keys = new Set(
    candidates
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(normalizeRuntimePathForComparison)
  )
  const matches = board.projects.filter(
    (project) =>
      keys.has(normalizeRuntimePathForComparison(project.key)) ||
      keys.has(normalizeRuntimePathForComparison(project.root))
  )
  return matches.length === 1 ? matches[0] : null
}
