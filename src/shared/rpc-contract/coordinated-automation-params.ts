import { z } from 'zod'
import {
  OptionalBoolean,
  OptionalPlainString,
  OptionalPositiveInt,
  OptionalString,
  requiredNumber,
  requiredString
} from './rpc-param-primitives'
import {
  AutomationLaunchSetupPatch,
  AutomationPrecheck,
  AutomationSchedule,
  AutomationWorkspaceMode,
  Destination,
  ExpectedOwner,
  ExtraAgentArgs,
  OptionalNullablePlainString,
  SetupDecision,
  TaskSourceContext,
  TuiAgent,
  WorkspaceRunContext
} from './automation-params'
import {
  AutomationOutcomeContractSchema,
  CoordinatedAutomationCeilingsSchema,
  CoordinatedAutomationChildDefinitionSchema,
  CoordinatedAutomationInheritedDefaultsSchema,
  CoordinatedAutomationPublicationPolicySchema,
  CoordinatedAutomationRetentionPolicySchema
} from '../coordinated-automation-schemas'
import {
  validateChildGraph,
  validateCoordinatedAutomationDefinition,
  type CoordinatedAutomationValidationError
} from '../coordinated-automation-validation'
import { validateOutcomeContractIds } from '../coordinated-automation-contract-validation'
import {
  COORDINATED_AUTOMATION_CONTRACT_VERSION,
  type CoordinatedHostCapabilities
} from '../coordinated-automation-saga-types'

export function assertHostSupportsCoordinatedAutomations(
  capabilities?: CoordinatedHostCapabilities | null
): void {
  if (
    !capabilities ||
    capabilities.contractVersion !== COORDINATED_AUTOMATION_CONTRACT_VERSION ||
    !capabilities.supportedCapabilities.includes('coordinated_v1')
  ) {
    throw new Error(
      'Host does not support coordinated automations (missing or unconfirmed capability "coordinated_v1"). Cannot dispatch coordinated writes to this host.'
    )
  }
}

export const CoordinatedAutomationCreate = z
  .strictObject({
    creationKey: OptionalString,
    name: requiredString('Missing automation name'),
    prompt: requiredString('Missing automation prompt').pipe(
      z.string().max(200_000, 'Prompt too long')
    ),
    precheck: AutomationPrecheck,
    agentId: TuiAgent,
    extraAgentArgs: ExtraAgentArgs,
    launchSetupPatch: AutomationLaunchSetupPatch.optional(),
    runContext: WorkspaceRunContext,
    sourceContext: TaskSourceContext,
    repo: OptionalString,
    workspace: OptionalString,
    workspaceMode: AutomationWorkspaceMode,
    baseBranch: OptionalPlainString,
    setupDecision: SetupDecision,
    reuseSession: OptionalBoolean,
    timezone: OptionalString,
    triggerPolicy: z.literal('manual_only').optional(),
    rrule: AutomationSchedule.optional(),
    dtstart: requiredNumber('Missing trigger start time').optional(),
    enabled: OptionalBoolean,
    missedRunGraceMinutes: OptionalPositiveInt,
    destination: Destination,
    kind: z.literal('coordinated'),
    definitionRevision: z
      .never({
        message:
          'Client cannot set definitionRevision on automation creation; initial revision is managed monotonically by the host.'
      })
      .optional(),
    outcomeContract: AutomationOutcomeContractSchema,
    children: z
      .array(CoordinatedAutomationChildDefinitionSchema)
      .min(1, 'At least one child automation definition is required')
      .max(100, 'Maximum of 100 child automations supported'),
    inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
    globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
    publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
    retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
  })
  .superRefine((val, ctx) => {
    if (
      val.triggerPolicy === 'manual_only'
        ? val.rrule !== undefined || val.dtstart !== undefined || val.enabled === true
        : val.rrule === undefined || val.dtstart === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Manual-only definitions must be disabled with no schedule; scheduled definitions require rrule and dtstart.'
      })
    }
    const res = validateCoordinatedAutomationDefinition({
      kind: 'coordinated',
      definitionRevision: 1,
      outcomeContract: val.outcomeContract,
      children: val.children,
      inheritedDefaults: val.inheritedDefaults,
      globalCeilings: val.globalCeilings,
      publicationPolicy: val.publicationPolicy,
      retentionPolicy: val.retentionPolicy
    })
    if (!res.valid) {
      for (const err of res.errors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err.message,
          path: err.path ? [err.path] : []
        })
      }
    }
  })

export const CoordinatedAutomationUpdateFields = z
  .strictObject({
    name: OptionalString,
    prompt: OptionalString.pipe(z.string().max(200_000, 'Prompt too long').optional()),
    precheck: AutomationPrecheck,
    agentId: TuiAgent.optional(),
    extraAgentArgs: ExtraAgentArgs,
    launchSetupPatch: AutomationLaunchSetupPatch.optional(),
    runContext: WorkspaceRunContext,
    sourceContext: TaskSourceContext,
    repo: OptionalString,
    workspace: OptionalString,
    workspaceMode: AutomationWorkspaceMode,
    baseBranch: OptionalNullablePlainString,
    setupDecision: SetupDecision,
    reuseSession: OptionalBoolean,
    timezone: OptionalString,
    rrule: AutomationSchedule.optional(),
    dtstart: requiredNumber('Missing trigger start time').optional(),
    enabled: OptionalBoolean,
    missedRunGraceMinutes: OptionalPositiveInt,
    kind: z.literal('coordinated').optional(),
    expectedDefinitionRevision: OptionalPositiveInt,
    outcomeContract: AutomationOutcomeContractSchema.optional(),
    children: z.array(CoordinatedAutomationChildDefinitionSchema).max(100).optional(),
    inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
    globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
    publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
    retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
  })
  .superRefine((val, ctx) => {
    // Why: a partial update may rely on stored policies, so only checks that are decidable
    // from the payload alone run here; the host re-validates the merged definition.
    const errors: CoordinatedAutomationValidationError[] = []
    if (val.children) {
      validateChildGraph(val.children, errors)
    }
    if (val.outcomeContract) {
      validateOutcomeContractIds(val.outcomeContract, errors)
    }
    for (const err of errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err.message,
        path: err.path ? [err.path] : []
      })
    }
  })

export const CoordinatedAutomationCreateRequest = CoordinatedAutomationCreate.safeExtend({
  enabled: z.literal(false).optional(),
  destination: Destination.unwrap()
})

export const CoordinatedAutomationUpdate = z.strictObject({
  id: requiredString('Missing automation id'),
  updates: CoordinatedAutomationUpdateFields.safeExtend({
    enabled: z.literal(false).optional(),
    expectedDefinitionRevision: z.number().int().positive()
  }),
  expectedOwner: ExpectedOwner.unwrap(),
  destination: Destination,
  expectedWorkspaceMode: z.literal('new_per_run').optional()
})

export type RuntimeCoordinatedAutomationCreateInput = z.infer<
  typeof CoordinatedAutomationCreateRequest
>
export type RuntimeCoordinatedAutomationUpdateInput = z.infer<
  typeof CoordinatedAutomationUpdate
>['updates']
