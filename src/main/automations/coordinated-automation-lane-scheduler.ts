import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'
import { DEFAULT_MUTATION_LANE_SENTINEL } from '../../shared/coordinated-automation-lane-validation'
import type { TaskRow } from '../runtime/orchestration/types'

type LaneState = { hasExclusiveWriter: boolean; sharedWriterCount: number }

export function selectEligibleTasksForDispatch(params: {
  readyTasks: TaskRow[]
  inFlightTasks: TaskRow[]
  taskToChild: Map<string, ResolvedChildSnapshot>
  maxConcurrency: number
}): TaskRow[] {
  const { readyTasks, inFlightTasks, taskToChild, maxConcurrency } = params
  const laneStates = new Map<string, LaneState>()

  for (const inFlight of inFlightTasks) {
    const child = taskToChild.get(inFlight.id)
    if (!child || child.mutationClass === 'read_only') {
      continue
    }
    const lane = child.mutationLane ?? DEFAULT_MUTATION_LANE_SENTINEL
    const state = laneStates.get(lane) ?? { hasExclusiveWriter: false, sharedWriterCount: 0 }
    if (child.mutationClass === 'exclusive_writer') {
      state.hasExclusiveWriter = true
    } else if (child.mutationClass === 'shared_writer') {
      state.sharedWriterCount += 1
    }
    laneStates.set(lane, state)
  }

  const candidateTasks: TaskRow[] = []
  for (const task of readyTasks) {
    if (inFlightTasks.length + candidateTasks.length >= maxConcurrency) {
      break
    }
    const child = taskToChild.get(task.id)
    if (!child) {
      continue
    }
    if (child.mutationClass === 'read_only') {
      candidateTasks.push(task)
      continue
    }
    const lane = child.mutationLane ?? DEFAULT_MUTATION_LANE_SENTINEL
    const state = laneStates.get(lane) ?? { hasExclusiveWriter: false, sharedWriterCount: 0 }
    if (child.mutationClass === 'exclusive_writer') {
      if (state.hasExclusiveWriter || state.sharedWriterCount > 0) {
        continue
      }
      state.hasExclusiveWriter = true
      laneStates.set(lane, state)
      candidateTasks.push(task)
    } else if (child.mutationClass === 'shared_writer') {
      if (state.hasExclusiveWriter) {
        continue
      }
      state.sharedWriterCount += 1
      laneStates.set(lane, state)
      candidateTasks.push(task)
    }
  }

  return candidateTasks
}
