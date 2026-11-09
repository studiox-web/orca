import type { Automation } from './automations-types'
import {
  isCoordinatedAutomation,
  type ChildLaunchConfig,
  type ChildLaunchConfigField,
  type CoordinatedAutomationCeilings,
  type CoordinatedAutomationChildDefinition,
  type CoordinatedAutomationPublicationPolicy,
  type CoordinatedAutomationRetentionPolicy,
  type OverrideProvenance,
  type ResolvedAutomationRunSnapshot,
  type ResolvedChildLaunchConfig,
  type ResolvedChildSnapshot,
  type ResolvedPrompt
} from './coordinated-automation-types'
import { validateCoordinatedAutomationDefinition } from './coordinated-automation-validation'
import { deepFreeze, sha256Hex, toCanonicalJson } from './coordinated-automation-canonical-digest'

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

function resolveParentDefaults(
  automation: Automation,
  ceilings: CoordinatedAutomationCeilings
): ResolvedChildLaunchConfig {
  const d = automation.inheritedDefaults
  return {
    agentId: d?.agentId ?? automation.agentId,
    model: d?.model ?? null,
    reasoningEffort: d?.reasoningEffort ?? null,
    surface: d?.surface ?? automation.surface ?? 'terminal',
    extraAgentArgs: d?.extraAgentArgs ?? automation.extraAgentArgs ?? '',
    reuseSession: d?.reuseSession ?? automation.reuseSession ?? false,
    workspaceMode: d?.workspaceMode ?? automation.workspaceMode ?? 'existing',
    workspaceId: d?.workspaceId ?? automation.workspaceId ?? null,
    baseBranch: d?.baseBranch ?? automation.baseBranch ?? null,
    setupDecision: d?.setupDecision ?? automation.setupDecision ?? 'inherit',
    timeoutSeconds:
      d?.timeoutSeconds ??
      (ceilings.maxWallClockSeconds ? Math.min(1800, ceilings.maxWallClockSeconds) : 1800),
    maxRetries: d?.maxRetries ?? 3,
    maxReviewIterations:
      d?.maxReviewIterations ??
      (ceilings.maxReviewIterations !== undefined ? Math.min(2, ceilings.maxReviewIterations) : 2)
  }
}

function resolveChildLaunchConfig(
  child: CoordinatedAutomationChildDefinition,
  parentDefaults: ResolvedChildLaunchConfig
): {
  resolved: ResolvedChildLaunchConfig
  provenance: Record<ChildLaunchConfigField, OverrideProvenance>
} {
  const cfg = child.launchConfig
  const explicitProv = cfg.provenance ?? {}

  function resolveField<K extends ChildLaunchConfigField>(
    field: K,
    childValue: ChildLaunchConfig[K],
    defaultValue: ResolvedChildLaunchConfig[K]
  ): { value: ResolvedChildLaunchConfig[K]; prov: OverrideProvenance } {
    if (explicitProv[field] === 'overridden') {
      if (childValue !== undefined) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: childValue conforms to ResolvedChildLaunchConfig[K]
        return { value: childValue as ResolvedChildLaunchConfig[K], prov: 'overridden' }
      }
      return { value: defaultValue, prov: 'inherited' }
    }
    if (explicitProv[field] === 'inherited') {
      return { value: defaultValue, prov: 'inherited' }
    }
    if (childValue !== undefined) {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: childValue conforms to ResolvedChildLaunchConfig[K]
      return { value: childValue as ResolvedChildLaunchConfig[K], prov: 'overridden' }
    }
    return { value: defaultValue, prov: 'inherited' }
  }

  const fields: ChildLaunchConfigField[] = [
    'agentId',
    'model',
    'reasoningEffort',
    'surface',
    'extraAgentArgs',
    'reuseSession',
    'workspaceMode',
    'workspaceId',
    'baseBranch',
    'setupDecision',
    'timeoutSeconds',
    'maxRetries',
    'maxReviewIterations'
  ]

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dynamically populated across all ChildLaunchConfigField keys
  const resolved = {} as ResolvedChildLaunchConfig
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dynamically populated across all ChildLaunchConfigField keys
  const provenance = {} as Record<ChildLaunchConfigField, OverrideProvenance>

  for (const f of fields) {
    const res = resolveField(f, cfg[f], parentDefaults[f])
    // @ts-expect-error dynamic key assignment
    resolved[f] = res.value
    provenance[f] = res.prov
  }

  return { resolved, provenance }
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
    const pinned = promptSource.digest.startsWith('sha256:')
      ? promptSource.digest
      : `sha256:${promptSource.digest}`
    if (!/^sha256:[0-9a-f]{64}$/.test(pinned)) {
      throw new Error(
        `Invalid pinned prompt digest format "${promptSource.digest}": expected sha256:[0-9a-f]{64}`
      )
    }
    if (pinned !== computedDigest) {
      throw new Error(
        `Pinned prompt digest mismatch for "${promptSource.path}": expected ${pinned}, resolved content computed to ${computedDigest}`
      )
    }
  }

  if (resolved.digest) {
    const resolverDigest = resolved.digest.startsWith('sha256:')
      ? resolved.digest
      : `sha256:${resolved.digest}`
    if (!/^sha256:[0-9a-f]{64}$/.test(resolverDigest)) {
      throw new Error(
        `Resolver returned invalid digest format "${resolved.digest}": expected sha256:[0-9a-f]{64}`
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

  const effectiveCeilings: CoordinatedAutomationCeilings = { ...automation.globalCeilings }
  const validationResult = validateCoordinatedAutomationDefinition(
    {
      kind: 'coordinated',
      definitionRevision: automation.definitionRevision,
      outcomeContract: automation.outcomeContract,
      children: automation.children,
      inheritedDefaults: automation.inheritedDefaults,
      globalCeilings: automation.globalCeilings,
      publicationPolicy: automation.publicationPolicy,
      retentionPolicy: automation.retentionPolicy
    },
    automation.inheritedDefaults,
    effectiveCeilings
  )
  if (!validationResult.valid) {
    throw new Error(
      `Cannot resolve snapshot: coordinated automation definition failed validation: ${validationResult.errors.map((e) => e.message).join('; ')}`
    )
  }

  const publicationPolicy: CoordinatedAutomationPublicationPolicy = {
    allowExternalMutation: false,
    allowedFinalStates: ['completed'],
    requireHumanDecisionForProduction: true,
    ...automation.publicationPolicy
  }
  const retentionPolicy: CoordinatedAutomationRetentionPolicy = {
    preserveCompletionReceipt: true,
    ...automation.retentionPolicy
  }
  const parentDefaults = resolveParentDefaults(automation, effectiveCeilings)
  const resolvedChildren: ResolvedChildSnapshot[] = automation.children.map((child) => {
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

  const outcomeContract = automation.outcomeContract
  const executionTarget = {
    type: automation.executionTargetType,
    id: automation.executionTargetId,
    generation: automation.executionTargetGeneration
  }

  const configDigestPayload = {
    automationId: automation.id,
    definitionRevision: automation.definitionRevision,
    outcomeContract,
    resolvedChildren: resolvedChildren
      .slice()
      .sort((a, b) =>
        a.childDefinitionId < b.childDefinitionId
          ? -1
          : a.childDefinitionId > b.childDefinitionId
            ? 1
            : 0
      ),
    executionTarget,
    inheritedDefaults: parentDefaults,
    globalCeilings: effectiveCeilings,
    publicationPolicy,
    retentionPolicy
  }
  const canonicalDigest = `sha256:${sha256Hex(toCanonicalJson(configDigestPayload))}`
  const snapshot: ResolvedAutomationRunSnapshot = {
    automationId: automation.id,
    definitionRevision: automation.definitionRevision,
    createdAt,
    outcomeContract: JSON.parse(JSON.stringify(outcomeContract)),
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
