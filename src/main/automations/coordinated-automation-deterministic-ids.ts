import { createHash } from 'node:crypto'
import { isGeneratedId } from '../runtime/orchestration/db/generated-id'

export const NATIVE_RUN_ID_PREFIX = 'run_'
export const NATIVE_TASK_ID_PREFIX = 'task_'
export const NATIVE_HEX_LENGTH = 12

/**
 * Derives a bounded 16-character collision-resistant native Run ID
 * matching `run_<12 hex chars>` and satisfying `isGeneratedId(id, 'run')`.
 */
export function deterministicCoordinatedRunId(automationRunId: string): string {
  const hex = createHash('sha256')
    .update(`orca:coord:run:${automationRunId}`)
    .digest('hex')
    .slice(0, NATIVE_HEX_LENGTH)
  const id = `${NATIVE_RUN_ID_PREFIX}${hex}`
  if (!isGeneratedId(id, 'run')) {
    throw new Error(`Derived run ID "${id}" does not conform to native generated run ID shape.`)
  }
  return id
}

/**
 * Derives a bounded 17-character collision-resistant native Task ID
 * matching `task_<12 hex chars>` and satisfying `isGeneratedId(id, 'task')`.
 * Satisfies Windows PowerShell quote-stripped `--deps` recovery and strict max-64 bounds.
 */
export function deterministicCoordinatedTaskId(
  orchestrationRunId: string,
  childDefinitionId: string
): string {
  const hex = createHash('sha256')
    .update(`orca:coord:task:${orchestrationRunId}:${childDefinitionId}`)
    .digest('hex')
    .slice(0, NATIVE_HEX_LENGTH)
  const id = `${NATIVE_TASK_ID_PREFIX}${hex}`
  if (!isGeneratedId(id, 'task')) {
    throw new Error(`Derived task ID "${id}" does not conform to native generated task ID shape.`)
  }
  return id
}
