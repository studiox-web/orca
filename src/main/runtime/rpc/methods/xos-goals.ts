import {
  XosCronReplace,
  XosGoalRun,
  XosGoalSchedule,
  XosGoalStop,
  XosNoParams
} from '../../../../shared/rpc-contract/xos-params'
import { requireXosRpcBackend } from '../../../xos/xos-rpc-backend'
import { defineMethod } from '../core'

/** The CLI's way into the running Orca: what must happen where the runs and locks live. */
export const XOS_GOAL_METHODS = [
  defineMethod({
    name: 'xos.goal.run',
    permission: 'workspace',
    params: XosGoalRun,
    handler: (params) => requireXosRpcBackend().runGoal(params)
  }),
  defineMethod({
    name: 'xos.goal.stop',
    permission: 'workspace',
    params: XosGoalStop,
    handler: (params) => requireXosRpcBackend().stopGoal(params)
  }),
  defineMethod({
    name: 'xos.goal.schedule',
    permission: 'workspace',
    params: XosGoalSchedule,
    handler: (params) => requireXosRpcBackend().scheduleGoal(params)
  }),
  defineMethod({
    name: 'xos.cron.replace',
    permission: 'workspace',
    params: XosCronReplace,
    handler: (params) => requireXosRpcBackend().replaceCronJob(params)
  }),
  defineMethod({
    name: 'xos.usage.limits',
    permission: 'workspace',
    params: XosNoParams,
    handler: () => requireXosRpcBackend().usageLimits()
  })
]
