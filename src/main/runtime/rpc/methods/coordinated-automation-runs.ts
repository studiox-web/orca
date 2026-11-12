import { defineMethod } from '../core'
import {
  CoordinatedFakeRunStart,
  CoordinatedRunSelection,
  ResolveCoordinatedGate,
  RetryCoordinatedStage,
  StopCoordinatedRun
} from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import { assertLocalCoordinatedCaller } from './coordinated-automations'

export const COORDINATED_AUTOMATION_RUN_METHODS = [
  defineMethod({
    name: 'automation.startCoordinatedNativeRun',
    permission: 'workspace',
    params: CoordinatedFakeRunStart,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.startCoordinatedNativeRun(params)
    }
  }),
  defineMethod({
    name: 'automation.reconcileCoordinatedNativeRun',
    permission: 'workspace',
    params: CoordinatedRunSelection,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.reconcileCoordinatedNativeRun(params)
    }
  }),
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
  }),
  defineMethod({
    name: 'automation.stopCoordinatedRun',
    permission: 'workspace',
    params: StopCoordinatedRun,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.stopCoordinatedRun(params)
    }
  }),
  defineMethod({
    name: 'automation.retryCoordinatedStage',
    permission: 'workspace',
    params: RetryCoordinatedStage,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.retryCoordinatedStage(params)
    }
  }),
  defineMethod({
    name: 'automation.resolveCoordinatedGate',
    permission: 'workspace',
    params: ResolveCoordinatedGate,
    handler: (params, context) => {
      assertLocalCoordinatedCaller(context)
      return context.runtime.resolveCoordinatedGate(params)
    }
  })
]
