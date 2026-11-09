import type { Repo } from '../../../shared/repo-types'
import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput,
  CoordinatedAutomationCreateInput,
  CoordinatedAutomationUpdateInput
} from '../../../shared/automations-types'
import {
  isCoordinatedAutomation,
  type CoordinatedAutomationDefinition,
  type CoordinatedAutomationDefinitionFields
} from '../../../shared/coordinated-automation-types'
import { CoordinatedAutomationDefinitionSchema } from '../../../shared/coordinated-automation-schemas'
import { validateCoordinatedAutomationDefinition } from '../../../shared/coordinated-automation-validation'
import type {
  AutomationDestination,
  AutomationUpdatePreconditions
} from '../../../shared/automation-owner-precondition'
import {
  createAutomation,
  updateAutomation,
  type AutomationDefinitionOperations
} from './automation-definition-operations'
import {
  advanceCoordinatedRevisionIfResolutionChanged,
  CoordinatedAutomationExecutionRefusedError,
  coordinatedDefinitionFingerprint
} from './coordinated-automation-revisions'
import { CoordinatedRunConflictError } from './coordinated-automation-run-records'

type DefinitionPatch = Partial<
  Pick<
    CoordinatedAutomationDefinition,
    | 'outcomeContract'
    | 'children'
    | 'inheritedDefaults'
    | 'globalCeilings'
    | 'publicationPolicy'
    | 'retentionPolicy'
  >
>

function splitDefinition<T extends object>(
  input: T
): { base: Omit<T, keyof CoordinatedAutomationDefinitionFields>; patch: DefinitionPatch } {
  const {
    kind: _kind,
    definitionRevision: _revision,
    childTombstones: _tombstones,
    definitionFingerprint: _fingerprint,
    outcomeContract,
    children,
    inheritedDefaults,
    globalCeilings,
    publicationPolicy,
    retentionPolicy,
    ...base
  } = input as T & CoordinatedAutomationDefinitionFields
  const patch: DefinitionPatch = Object.fromEntries(
    Object.entries({
      outcomeContract,
      children,
      inheritedDefaults,
      globalCeilings,
      publicationPolicy,
      retentionPolicy
    }).filter(([, value]) => value !== undefined)
  )
  return { base, patch }
}

/** Store only schema-parsed, graph-validated definition content. */
function parseDefinition(automation: Automation): CoordinatedAutomationDefinition {
  const parsed = CoordinatedAutomationDefinitionSchema.safeParse({
    kind: 'coordinated',
    definitionRevision: automation.definitionRevision ?? 1,
    outcomeContract: automation.outcomeContract,
    children: automation.children,
    inheritedDefaults: automation.inheritedDefaults,
    globalCeilings: automation.globalCeilings,
    publicationPolicy: automation.publicationPolicy,
    retentionPolicy: automation.retentionPolicy
  })
  if (!parsed.success) {
    throw new Error(`Coordinated automation definition is invalid: ${parsed.error.message}`)
  }
  const result = validateCoordinatedAutomationDefinition(
    parsed.data,
    undefined,
    parsed.data.globalCeilings
  )
  if (!result.valid) {
    throw new Error(
      `Coordinated automation definition is invalid: ${result.errors.map((e) => e.message).join('; ')}`
    )
  }
  return parsed.data
}

function withDefinition(
  automation: Automation,
  definition: CoordinatedAutomationDefinition
): Automation {
  const next: Automation = {
    ...automation,
    kind: 'coordinated',
    definitionRevision: definition.definitionRevision,
    outcomeContract: definition.outcomeContract,
    children: definition.children
  }
  for (const key of [
    'inheritedDefaults',
    'globalCeilings',
    'publicationPolicy',
    'retentionPolicy'
  ] as const) {
    if (definition[key] === undefined) {
      delete next[key]
    } else {
      // @ts-expect-error each key carries the matching definition field type
      next[key] = definition[key]
    }
  }
  return next
}

function assertNoReusedTombstonedChild(automation: Automation): void {
  const removed = new Set((automation.childTombstones ?? []).map((t) => t.childDefinitionId))
  const reused = (automation.children ?? []).find((child) => removed.has(child.id))
  if (reused) {
    throw new Error(
      `Child ID "${reused.id}" belonged to a removed child; historical runs keep that identity, so choose a new ID.`
    )
  }
}

export function createCoordinatedAutomation(
  operations: AutomationDefinitionOperations,
  input: CoordinatedAutomationCreateInput,
  options?: { destination?: AutomationDestination; resolvedRepo?: Repo }
): Automation {
  if (input.kind !== 'coordinated') {
    throw new Error('Coordinated automation create requires kind "coordinated".')
  }
  if (input.definitionRevision !== undefined) {
    throw new Error('The host assigns the initial definition revision.')
  }
  if (input.enabled === true) {
    throw new CoordinatedAutomationExecutionRefusedError(
      'Coordinated automations stay disabled until coordinated execution is available.'
    )
  }
  const { base, patch } = splitDefinition(input)
  return createAutomation(
    operations,
    { ...(base as AutomationCreateInput), enabled: false },
    options,
    (automation) => {
      const candidate: Automation = { ...automation, ...patch, definitionRevision: 1 }
      const coordinated = withDefinition(candidate, parseDefinition(candidate))
      return {
        ...coordinated,
        definitionFingerprint: coordinatedDefinitionFingerprint(coordinated)
      }
    }
  )
}

export function updateCoordinatedAutomation(
  operations: AutomationDefinitionOperations,
  id: string,
  updates: CoordinatedAutomationUpdateInput & { expectedDefinitionRevision?: number },
  options?: AutomationUpdatePreconditions & { resolvedRepo?: Repo }
): Automation {
  if (updates.kind !== undefined && updates.kind !== 'coordinated') {
    throw new Error('A coordinated automation cannot change kind.')
  }
  const { expectedDefinitionRevision, ...rest } = updates
  const { base, patch } = splitDefinition(rest)
  return updateAutomation(
    operations,
    id,
    base as AutomationUpdateInput,
    options,
    (current, merged) => {
      if (!isCoordinatedAutomation(current)) {
        throw new Error('Automation is not coordinated.')
      }
      if (
        expectedDefinitionRevision !== undefined &&
        expectedDefinitionRevision !== (current.definitionRevision ?? 1)
      ) {
        throw new CoordinatedRunConflictError(
          `Definition revision changed: expected ${expectedDefinitionRevision}, stored ${current.definitionRevision ?? 1}.`
        )
      }
      const candidate: Automation = { ...merged, ...patch }
      const coordinated = withDefinition(candidate, parseDefinition(candidate))
      const next = advanceCoordinatedRevisionIfResolutionChanged(current, coordinated, Date.now())
      assertNoReusedTombstonedChild(next)
      return next
    }
  )
}
