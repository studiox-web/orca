import type { CoordinatedAutomationChildDefinition } from '../../../../shared/coordinated-automation-types'

export type WorkerGraphNode = {
  child: CoordinatedAutomationChildDefinition
  layer: number
  upstreamIds: string[]
  downstreamIds: string[]
}

export type WorkerGraphLayer = {
  layerIndex: number
  nodes: WorkerGraphNode[]
}

export type WorkerGraphLayout = {
  layers: WorkerGraphLayer[]
  nodesById: Map<string, WorkerGraphNode>
  hasCycle: boolean
}

export function computeWorkerGraphLayout(
  children: readonly CoordinatedAutomationChildDefinition[]
): WorkerGraphLayout {
  const nodesById = new Map<string, WorkerGraphNode>()
  const childMap = new Map<string, CoordinatedAutomationChildDefinition>()

  for (const child of children) {
    childMap.set(child.id, child)
    nodesById.set(child.id, {
      child,
      layer: 0,
      upstreamIds: child.dependencies.map((d) => d.childId),
      downstreamIds: []
    })
  }

  // Populate downstream IDs
  for (const node of nodesById.values()) {
    for (const upstreamId of node.upstreamIds) {
      const upstreamNode = nodesById.get(upstreamId)
      if (upstreamNode) {
        upstreamNode.downstreamIds.push(node.child.id)
      }
    }
  }

  // Compute layers using Kahn's algorithm / longest path from sources
  const inDegree = new Map<string, number>()
  for (const child of children) {
    const validDeps = child.dependencies.filter((d) => childMap.has(d.childId))
    inDegree.set(child.id, validDeps.length)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id)
    }
  }

  const layerMap = new Map<string, number>()
  for (const id of queue) {
    layerMap.set(id, 0)
  }

  let visited = 0
  while (queue.length > 0) {
    const currentId = queue.shift()!
    visited++
    const currentLayer = layerMap.get(currentId) ?? 0
    const node = nodesById.get(currentId)
    if (!node) {
      continue
    }

    for (const downstreamId of node.downstreamIds) {
      const nextLayer = Math.max(layerMap.get(downstreamId) ?? 0, currentLayer + 1)
      layerMap.set(downstreamId, nextLayer)

      const deg = (inDegree.get(downstreamId) ?? 1) - 1
      inDegree.set(downstreamId, deg)
      if (deg === 0) {
        queue.push(downstreamId)
      }
    }
  }

  const hasCycle = visited < children.length

  // Fallback for nodes trapped in cycles
  for (const child of children) {
    if (!layerMap.has(child.id)) {
      layerMap.set(child.id, visited > 0 ? visited : 1)
    }
    const node = nodesById.get(child.id)
    if (node) {
      node.layer = layerMap.get(child.id) ?? 0
    }
  }

  // Group by layer
  const layerGroups = new Map<number, WorkerGraphNode[]>()
  for (const node of nodesById.values()) {
    const group = layerGroups.get(node.layer) ?? []
    group.push(node)
    layerGroups.set(node.layer, group)
  }

  const sortedLayerIndices = [...layerGroups.keys()].sort((a, b) => a - b)
  const layers: WorkerGraphLayer[] = sortedLayerIndices.map((layerIndex) => ({
    layerIndex,
    nodes: layerGroups.get(layerIndex) ?? []
  }))

  return { layers, nodesById, hasCycle }
}
