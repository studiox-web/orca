import type { CoordinatedAutomationChildDefinition } from './coordinated-automation-types'

export function buildTransitiveDependencyMap(
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

export function detectCycles(children: CoordinatedAutomationChildDefinition[]): string[][] {
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
