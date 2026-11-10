import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'
import { ExpectedOwner } from './automation-params'

const CoordinatedRunParent = z.strictObject({
  runtimeId: requiredString('Missing runtime authority'),
  automationId: requiredString('Missing automation id'),
  expectedOwner: ExpectedOwner.unwrap()
})

export const CoordinatedFakeRunStart = CoordinatedRunParent.extend({
  expectedDefinitionRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(128)
})

export const CoordinatedRunSelection = CoordinatedRunParent.extend({
  automationRunId: requiredString('Missing automation run id')
})

export type CoordinatedFakeRunStartInput = z.infer<typeof CoordinatedFakeRunStart>
export type CoordinatedRunSelectionInput = z.infer<typeof CoordinatedRunSelection>
