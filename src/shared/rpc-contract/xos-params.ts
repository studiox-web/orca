import { z } from 'zod'
import { OptionalBoolean, OptionalString, requiredString } from './rpc-param-primitives'

export const XosGoalRun = z.object({
  repoRoot: requiredString('Missing project root'),
  goal: requiredString('Missing goal'),
  mode: z.enum(['normal', 'reply', 'sidecar']).optional(),
  sidecar: OptionalString,
  message: OptionalString,
  agent: OptionalString,
  force: OptionalBoolean,
  inheritedLane: OptionalString
})

export const XosGoalStop = z.object({
  repoRoot: requiredString('Missing project root'),
  goal: requiredString('Missing goal')
})

export const XosGoalSchedule = z.object({
  repoRoot: requiredString('Missing project root'),
  goal: requiredString('Missing goal'),
  schedule: requiredString('Missing schedule'),
  agent: OptionalString,
  timezone: OptionalString
})

export const XosCronReplace = z.object({
  jobId: requiredString('Missing crontab job id'),
  timezone: OptionalString
})

export const XosNoParams = z.object({})
