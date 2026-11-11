import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'
import type { OrchestrationDb } from '../runtime/orchestration/db'

const lanes = new WeakMap<OrchestrationDb, Map<string, Promise<void>>>()

export function inNativeDispatchLane<T>(
  db: OrchestrationDb,
  taskId: string,
  operation: () => Promise<T>
): Promise<T> {
  let queue = lanes.get(db)
  if (!queue) {
    queue = new Map()
    lanes.set(db, queue)
  }
  return runKeyedSerializedOperation(queue, taskId, operation)
}
