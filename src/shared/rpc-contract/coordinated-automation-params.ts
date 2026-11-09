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

export const CoordinatedAutomationCreate = z.object({
  creationKey: OptionalString,
  name: requiredString('Missing automation name'),
  prompt: requiredString('Missing automation prompt'),
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
  rrule: AutomationSchedule,
  dtstart: requiredNumber('Missing trigger start time'),
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
    .min(1, 'At least one child automation definition is required'),
  inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
  globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
  publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
  retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
})

export const CoordinatedAutomationUpdateFields = z.object({
  name: OptionalString,
  prompt: OptionalString,
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
  children: z.array(CoordinatedAutomationChildDefinitionSchema).optional(),
  inheritedDefaults: CoordinatedAutomationInheritedDefaultsSchema.optional(),
  globalCeilings: CoordinatedAutomationCeilingsSchema.optional(),
  publicationPolicy: CoordinatedAutomationPublicationPolicySchema.optional(),
  retentionPolicy: CoordinatedAutomationRetentionPolicySchema.optional()
})
