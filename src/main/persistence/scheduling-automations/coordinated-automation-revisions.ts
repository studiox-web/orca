import type { Automation } from '../../../shared/automations-types'
import { isCoordinatedAutomation } from '../../../shared/coordinated-automation-types'
import { sha256Hex, toCanonicalJson } from '../../../shared/coordinated-automation-canonical-digest'

const COORDINATED_DEFINITION_FIELDS = [
  'definitionRevision',
  'outcomeContract',
  'children',
  'inheritedDefaults',
  'globalCeilings',
  'publicationPolicy',
  'retentionPolicy',
  'childTombstones',
  'definitionFingerprint'
] as const

export class CoordinatedAutomationExecutionRefusedError extends Error {
  constructor(
    message = 'Coordinated automations cannot run yet; coordinated execution is not enabled.'
  ) {
    super(message)
    this.name = 'CoordinatedAutomationExecutionRefusedError'
  }
}

/** Generic create/update paths must never write or flip coordinated definition state. */
export type AutomationKindWrite = Readonly<Record<string, unknown>>

export function assertSingleAutomationWrite(input: AutomationKindWrite): void {
  const record: Record<string, unknown> = { ...input }
  if (record.kind !== undefined && record.kind !== 'single') {
    throw new Error(
      'Coordinated automations must be written through the coordinated definition path.'
    )
  }
  for (const field of COORDINATED_DEFINITION_FIELDS) {
    if (record[field] !== undefined) {
      throw new Error(`Generic automation writes cannot set coordinated field "${field}".`)
    }
  }
}

export function assertKindWrite(input: AutomationKindWrite, coordinatedHook: unknown): void {
  if (!coordinatedHook) {
    assertSingleAutomationWrite(input)
  }
}

export function assertCreationKeyKind(existing: Automation, coordinatedHook: unknown): void {
  if (isCoordinatedAutomation(existing) !== Boolean(coordinatedHook)) {
    throw new Error('An automation of a different kind already uses this creation key.')
  }
}

export function guardSingleUpdates<T extends AutomationKindWrite>(
  updates: T,
  coordinatedHook: unknown
): T {
  assertKindWrite(updates, coordinatedHook)
  return coordinatedHook ? updates : stripUnchangedSingleKind(updates)
}

export function advanceRevisionIfChanged(current: Automation, next: Automation): Automation {
  return advanceCoordinatedRevisionIfResolutionChanged(current, next, Date.now())
}

/** Keep single records byte-identical: an explicit `kind: 'single'` is never persisted. */
export function stripUnchangedSingleKind<T extends AutomationKindWrite>(updates: T): T {
  if (!Object.hasOwn(updates, 'kind')) {
    return updates
  }
  const { kind: _kind, ...rest } = updates
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the optional `kind` key was removed.
  return rest as T
}

/** Everything snapshot resolution reads, minus the revision counter itself. */
export function coordinatedDefinitionFingerprint(automation: Automation): string {
  return `sha256:${sha256Hex(
    toCanonicalJson({
      outcomeContract: automation.outcomeContract,
      children: automation.children,
      inheritedDefaults: automation.inheritedDefaults,
      globalCeilings: automation.globalCeilings,
      publicationPolicy: automation.publicationPolicy,
      retentionPolicy: automation.retentionPolicy,
      agentId: automation.agentId,
      surface: automation.surface,
      extraAgentArgs: automation.extraAgentArgs,
      reuseSession: automation.reuseSession,
      workspaceMode: automation.workspaceMode,
      workspaceId: automation.workspaceId,
      baseBranch: automation.baseBranch,
      setupDecision: automation.setupDecision,
      executionTargetType: automation.executionTargetType,
      executionTargetId: automation.executionTargetId,
      executionTargetGeneration: automation.executionTargetGeneration
    })
  )}`
}

const PINNED_DIGEST = /^sha256:[0-9a-f]{64}$/

/** Phase 2 fingerprints must be deterministic, so file-backed prompts need a pinned content digest. */
export function assertPinnedSourceDigests(automation: Automation): void {
  for (const child of automation.children ?? []) {
    const source = child.promptSource
    if (source.kind === 'source_reference' && !PINNED_DIGEST.test(source.digest ?? '')) {
      throw new Error(
        `Child "${child.id}" references "${source.path}" without a pinned sha256 content digest.`
      )
    }
  }
}

export function assertCoordinatedAutomationNotEnabled(automation: Automation): void {
  if (isCoordinatedAutomation(automation) && automation.enabled) {
    throw new CoordinatedAutomationExecutionRefusedError(
      'Coordinated automations stay disabled until coordinated execution is available.'
    )
  }
}

/**
 * Same revision must always resolve to the same snapshot, so any change to a resolution
 * input (including generic edits of inherited parent fields) opens the next revision.
 */
export function advanceCoordinatedRevisionIfResolutionChanged(
  current: Automation,
  next: Automation,
  now: number
): Automation {
  if (!isCoordinatedAutomation(next)) {
    return next
  }
  assertCoordinatedAutomationNotEnabled(next)
  const fingerprint = coordinatedDefinitionFingerprint(next)
  const currentRevision = current.definitionRevision ?? 1
  if (
    fingerprint === (current.definitionFingerprint ?? coordinatedDefinitionFingerprint(current))
  ) {
    return { ...next, definitionRevision: currentRevision, definitionFingerprint: fingerprint }
  }
  return {
    ...next,
    definitionRevision: currentRevision + 1,
    definitionFingerprint: fingerprint,
    childTombstones: tombstonesForRevision(current, next, currentRevision + 1, now)
  }
}

function tombstonesForRevision(
  current: Automation,
  next: Automation,
  nextRevision: number,
  now: number
): Automation['childTombstones'] {
  const existing = current.childTombstones ?? []
  const nextIds = new Set((next.children ?? []).map((child) => child.id))
  const removed = (current.children ?? [])
    .filter((child) => !nextIds.has(child.id))
    .map((child) => ({
      childDefinitionId: child.id,
      name: child.name,
      role: child.role,
      lastDefinitionRevision: current.definitionRevision ?? 1,
      removedInRevision: nextRevision,
      removedAt: now
    }))
  const tombstones = [...existing, ...removed]
  return tombstones.length > 0 ? tombstones : undefined
}
