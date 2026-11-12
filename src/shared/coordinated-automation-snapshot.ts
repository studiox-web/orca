import type { Automation } from './automations-types'
import {
  isCoordinatedAutomation,
  type AutomationOutcomeContract,
  type CoordinatedAutomationCeilings,
  type CoordinatedAutomationChildDefinition,
  type CoordinatedAutomationPublicationPolicy,
  type CoordinatedAutomationRetentionPolicy,
  type ResolvedAutomationRunSnapshot,
  type ResolvedChildSnapshot,
  type ResolvedPrompt
} from './coordinated-automation-types'
import { CoordinatedAutomationDefinitionSchema } from './coordinated-automation-schemas'
import { validateCoordinatedAutomationDefinition } from './coordinated-automation-validation'
import { deepFreeze, sha256Hex, toCanonicalJson } from './coordinated-automation-canonical-digest'
import {
  resolveChildLaunchConfig,
  resolveParentDefaults
} from './coordinated-automation-launch-resolution'

export { deepFreeze, sha256Hex, toCanonicalJson }

export type ResolvePromptFunction = (source: {
  path: string
  authority?: string
  digest?: string
}) => { text: string; digest?: string }

export type ResolveAutomationSnapshotOptions = {
  automation: Automation
  promptResolver?: ResolvePromptFunction
  createdAt?: number
}

function resolveChildPrompt(
  promptSource: CoordinatedAutomationChildDefinition['promptSource'],
  promptResolver?: ResolvePromptFunction
): ResolvedPrompt {
  if (promptSource.kind === 'inline') {
    return {
      kind: 'inline',
      text: promptSource.text,
      digest: `sha256:${sha256Hex(promptSource.text)}`
    }
  }
  if (!promptResolver) {
    throw new Error(
      `Cannot resolve source_reference prompt "${promptSource.path}": promptResolver is required`
    )
  }
  const resolved = promptResolver(promptSource)
  const computedHex = sha256Hex(resolved.text)
  const computedDigest = `sha256:${computedHex}`

  if (promptSource.digest) {
    if (!promptSource.digest.startsWith('sha256:')) {
      throw new Error(
        `Invalid pinned prompt digest format "${promptSource.digest}": expected sha256:[0-9a-f]{64}`
      )
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(promptSource.digest)) {
      throw new Error(
        `Invalid pinned prompt digest format "${promptSource.digest}": expected sha256:[0-9a-f]{64}`
      )
    }
    if (promptSource.digest !== computedDigest) {
      throw new Error(
        `Pinned prompt digest mismatch for "${promptSource.path}": expected ${promptSource.digest}, resolved content computed to ${computedDigest}`
      )
    }
  }

  if (resolved.digest) {
    if (!resolved.digest.startsWith('sha256:')) {
      throw new Error(
        `Resolver returned invalid digest format "${resolved.digest}": expected sha256:[0-9a-f]{64}`
      )
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(resolved.digest)) {
      throw new Error(
        `Resolver returned invalid digest format "${resolved.digest}": expected sha256:[0-9a-f]{64}`
      )
    }
    if (resolved.digest !== computedDigest) {
      throw new Error(
        `Resolver-supplied digest "${resolved.digest}" does not match computed digest "${computedDigest}" for source prompt "${promptSource.path}".`
      )
    }
  }

  return {
    kind: 'source_reference',
    path: promptSource.path,
    authority: promptSource.authority,
    text: resolved.text,
    digest: computedDigest
  }
}

export function resolveAutomationSnapshot(
  options: ResolveAutomationSnapshotOptions
): ResolvedAutomationRunSnapshot {
  const { automation, promptResolver, createdAt = Date.now() } = options
  if (!isCoordinatedAutomation(automation)) {
    throw new Error('Cannot resolve snapshot for single automation: kind must be "coordinated"')
  }
  if (
    typeof automation.definitionRevision !== 'number' ||
    automation.definitionRevision <= 0 ||
    !Number.isInteger(automation.definitionRevision)
  ) {
    throw new Error(
      'Cannot resolve snapshot: definitionRevision must be a positive integer on coordinated automations'
    )
  }
  if (!automation.outcomeContract) {
    throw new Error(
      'Cannot resolve snapshot: outcomeContract is required on coordinated automations'
    )
  }
  if (!automation.children || automation.children.length === 0) {
    throw new Error(
      'Cannot resolve snapshot: coordinated automation must define at least one child'
    )
  }
  if (!automation.executionTargetType || !automation.executionTargetId) {
    throw new Error(
      'Cannot resolve snapshot: executionTargetType and executionTargetId must be explicitly qualified'
    )
  }

  const definitionPayload = {
    kind: 'coordinated' as const,
    definitionRevision: automation.definitionRevision,
    outcomeContract: automation.outcomeContract,
    children: automation.children,
    inheritedDefaults: automation.inheritedDefaults,
    globalCeilings: automation.globalCeilings,
    publicationPolicy: automation.publicationPolicy,
    retentionPolicy: automation.retentionPolicy
  }

  const schemaParsed = CoordinatedAutomationDefinitionSchema.safeParse(definitionPayload)
  if (!schemaParsed.success) {
    throw new Error(
      `Cannot resolve snapshot: coordinated automation definition schema validation failed: ${schemaParsed.error.message}`
    )
  }

  // Why: snapshot content must come from the schema's parsed (trimmed, stripped) output so the
  // digest covers exactly what was validated, not the caller's raw payload.
  const parsed = schemaParsed.data
  const effectiveCeilings: CoordinatedAutomationCeilings = { ...parsed.globalCeilings }
  const validationResult = validateCoordinatedAutomationDefinition(
    parsed,
    undefined,
    effectiveCeilings
  )
  if (!validationResult.valid) {
    throw new Error(
      `Cannot resolve snapshot: coordinated automation definition failed validation: ${validationResult.errors.map((e) => e.message).join('; ')}`
    )
  }

  const publicationPolicy: CoordinatedAutomationPublicationPolicy = {
    allowExternalMutation: parsed.publicationPolicy?.allowExternalMutation ?? false,
    requireHumanDecisionForProduction:
      parsed.publicationPolicy?.requireHumanDecisionForProduction ?? true,
    allowedFinalStates: parsed.publicationPolicy?.allowedFinalStates
      ? [...parsed.publicationPolicy.allowedFinalStates]
      : ['completed']
  }
  const retentionPolicy: CoordinatedAutomationRetentionPolicy = {
    preserveCompletionReceipt: parsed.retentionPolicy?.preserveCompletionReceipt ?? true,
    preserveSnapshot: parsed.retentionPolicy?.preserveSnapshot,
    preserveMappings: parsed.retentionPolicy?.preserveMappings,
    artifactRetentionDays: parsed.retentionPolicy?.artifactRetentionDays,
    defaultRetentionClass: parsed.retentionPolicy?.defaultRetentionClass,
    minimumEvidenceReferences: parsed.retentionPolicy?.minimumEvidenceReferences
      ? [...parsed.retentionPolicy.minimumEvidenceReferences]
      : undefined
  }
  const outcomeContract: AutomationOutcomeContract = JSON.parse(
    JSON.stringify(parsed.outcomeContract)
  )

  const parentDefaults = resolveParentDefaults(
    { ...automation, inheritedDefaults: parsed.inheritedDefaults },
    effectiveCeilings
  )
  const resolvedChildren: ResolvedChildSnapshot[] = parsed.children.map((child) => {
    const { resolved: launchConfig, provenance } = resolveChildLaunchConfig(child, parentDefaults)
    return {
      childDefinitionId: child.id,
      role: child.role,
      name: child.name,
      prompt: resolveChildPrompt(child.promptSource, promptResolver),
      launchConfig,
      provenance,
      dependencies: child.dependencies.map((d) => ({ ...d })),
      mutationClass: child.mutationClass,
      mutationLane: child.mutationLane,
      stageAcceptance: child.stageAcceptance
        ? JSON.parse(JSON.stringify(child.stageAcceptance))
        : undefined,
      resultSchema: child.resultSchema ? JSON.parse(JSON.stringify(child.resultSchema)) : null,
      enabled: child.enabled
    }
  })

  const executionTarget = {
    type: automation.executionTargetType,
    id: automation.executionTargetId,
    generation: automation.executionTargetGeneration
  }

  const canonicalDigest = computeSnapshotCanonicalDigest({
    ...(automation.triggerPolicy ? { triggerPolicy: automation.triggerPolicy } : {}),
    automationId: automation.id,
    definitionRevision: automation.definitionRevision,
    outcomeContract,
    resolvedChildren,
    executionTarget,
    inheritedDefaults: parentDefaults,
    globalCeilings: effectiveCeilings,
    publicationPolicy,
    retentionPolicy
  })
  const snapshot: ResolvedAutomationRunSnapshot = {
    ...(automation.triggerPolicy ? { triggerPolicy: automation.triggerPolicy } : {}),
    automationId: automation.id,
    definitionRevision: automation.definitionRevision,
    createdAt,
    outcomeContract,
    resolvedChildren,
    executionTarget,
    inheritedDefaults: parentDefaults,
    globalCeilings: effectiveCeilings,
    publicationPolicy,
    retentionPolicy,
    canonicalDigest
  }
  return deepFreeze(snapshot)
}

/** Digest over everything a snapshot freezes except `createdAt`; children are ID-ordered. */
export function computeSnapshotCanonicalDigest(
  snapshot: Omit<ResolvedAutomationRunSnapshot, 'createdAt' | 'canonicalDigest'>
): string {
  const payload = {
    ...(snapshot.triggerPolicy ? { triggerPolicy: snapshot.triggerPolicy } : {}),
    automationId: snapshot.automationId,
    definitionRevision: snapshot.definitionRevision,
    outcomeContract: snapshot.outcomeContract,
    resolvedChildren: snapshot.resolvedChildren
      .slice()
      .sort((a, b) =>
        a.childDefinitionId < b.childDefinitionId
          ? -1
          : a.childDefinitionId > b.childDefinitionId
            ? 1
            : 0
      ),
    executionTarget: snapshot.executionTarget,
    inheritedDefaults: snapshot.inheritedDefaults,
    globalCeilings: snapshot.globalCeilings,
    publicationPolicy: snapshot.publicationPolicy,
    retentionPolicy: snapshot.retentionPolicy
  }
  return `sha256:${sha256Hex(toCanonicalJson(payload))}`
}
