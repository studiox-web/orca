import { defineMethod } from '../core'
import {
  CoordinatedFakeRunStart,
  CoordinatedRunSelection
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import { assertLocalCoordinatedCaller } from './coordinated-automations'

export const COORDINATED_AUTOMATION_RUN_METHODS = [
  defineMethod({
    name: 'automation.startCoordinatedFakeRun',
    permission: 'workspace',
    params: CoordinatedFakeRunStart,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.startCoordinatedFakeRun(params)
    }
  }),
  defineMethod({
    name: 'automation.inspectCoordinatedRun',
    permission: 'workspace',
    params: CoordinatedRunSelection,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.inspectCoordinatedRun(params)
    }
  }),
  defineMethod({
    name: 'automation.reconcileCoordinatedFakeRun',
    permission: 'workspace',
    params: CoordinatedRunSelection,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.reconcileCoordinatedFakeRun(params)
    }
  })
]
