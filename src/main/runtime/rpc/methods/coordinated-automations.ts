import { defineMethod, type RpcContext } from '../core'
import {
  CoordinatedAutomationCreateRequest,
  CoordinatedAutomationUpdate
} from '../../../../shared/rpc-contract/coordinated-automation-params'

function assertLocalDefinitionCaller(context: RpcContext): void {
  if (context.caller?.kind !== 'desktop' && context.caller?.kind !== 'local-cli') {
    throw new Error('Coordinated definition writes require an authenticated local caller.')
  }
}

export const COORDINATED_AUTOMATION_METHODS = [
  defineMethod({
    name: 'automation.createCoordinated',
    permission: 'workspace',
    params: CoordinatedAutomationCreateRequest,
    handler: async (params, context) => {
      assertLocalDefinitionCaller(context)
      return { automation: await context.runtime.createCoordinatedAutomation(params) }
    }
  }),
  defineMethod({
    name: 'automation.updateCoordinated',
    permission: 'workspace',
    params: CoordinatedAutomationUpdate,
    handler: async (params, context) => {
      assertLocalDefinitionCaller(context)
      return {
        automation: await context.runtime.updateCoordinatedAutomation(params.id, params.updates, {
          expectedOwner: params.expectedOwner,
          destination: params.destination,
          expectedWorkspaceMode: params.expectedWorkspaceMode
        })
      }
    }
  })
]
