import { sha256 } from './sha256'
import type { Automation } from './automations-types'
import type {
  ChildLaunchConfig,
  ChildLaunchConfigField,
  CoordinatedAutomationCeilings,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationPublicationPolicy,
  CoordinatedAutomationRetentionPolicy,
  OverrideProvenance,
  ResolvedAutomationRunSnapshot,
  ResolvedChildLaunchConfig,
  ResolvedChildSnapshot,
  ResolvedPrompt
} from './coordinated-automation-types'

function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const digest = sha256(bytes)
  let hex = ''
  for (let i = 0; i < digest.length; i++) {
    hex += digest[i].toString(16).padStart(2, '0')
  }
  return hex
}

export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i])
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.freeze recursively freezes array contents
    return Object.freeze(obj) as unknown as Readonly<T>
  }
  for (const [, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object') {
      deepFreeze(val)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.freeze freezes all properties
  return Object.freeze(obj) as Readonly<T>
}

export function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(toCanonicalJson).join(',')}]`
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}:${toCanonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

export type ResolvePromptFunction = (source: {
  path: string
  authority?: string
  digest?: string
}) => { text: string; digest: string }

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
    timeoutSeconds: d?.timeoutSeconds ?? ceilings.maxWallClockSeconds ?? 1800,
    maxRetries: d?.maxRetries ?? 3,
    maxReviewIterations: d?.maxReviewIterations ?? ceilings.maxReviewIterations ?? 2
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
      const val = childValue !== undefined ? childValue : defaultValue
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: val conforms to ResolvedChildLaunchConfig[K]
      return { value: val as ResolvedChildLaunchConfig[K], prov: 'overridden' }
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
  if (promptResolver) {
    const resolved = promptResolver(promptSource)
    const digest = resolved.digest.startsWith('sha256:')
      ? resolved.digest
      : `sha256:${resolved.digest}`
    return {
      kind: 'source_reference',
      path: promptSource.path,
      authority: promptSource.authority,
      text: resolved.text,
      digest
    }
  }
  const digest = promptSource.digest
    ? promptSource.digest.startsWith('sha256:')
      ? promptSource.digest
      : `sha256:${promptSource.digest}`
    : `sha256:${sha256Hex(promptSource.path)}`
  return {
    kind: 'source_reference',
    path: promptSource.path,
    authority: promptSource.authority,
    text: '',
    digest
  }
}

export function resolveAutomationSnapshot(
  options: ResolveAutomationSnapshotOptions
): ResolvedAutomationRunSnapshot {
  const { automation, promptResolver, createdAt = Date.now() } = options
  const effectiveCeilings: CoordinatedAutomationCeilings = { ...automation.globalCeilings }
  const publicationPolicy: CoordinatedAutomationPublicationPolicy = {
    allowExternalMutation: false,
    allowedFinalStates: ['ready_to_publish'],
    requireHumanDecisionForProduction: true,
    ...automation.publicationPolicy
  }
  const retentionPolicy: CoordinatedAutomationRetentionPolicy = {
    preserveCompletionReceipt: true,
    ...automation.retentionPolicy
  }
  const parentDefaults = resolveParentDefaults(automation, effectiveCeilings)
  const resolvedChildren: ResolvedChildSnapshot[] = (automation.children ?? []).map((child) => {
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
  const outcomeContract = automation.outcomeContract ?? {
    humanStatement: '',
    acceptanceCriteria: [],
    requiredApprovals: [],
    allowedFinalStates: ['ready_to_publish']
  }
  const executionTarget = {
    type: automation.executionTargetType ?? 'local',
    id: automation.executionTargetId ?? 'local',
    generation: automation.executionTargetGeneration
  }
  const configDigestPayload = {
    automationId: automation.id,
    definitionRevision: automation.definitionRevision ?? 1,
    outcomeContract,
    resolvedChildren: resolvedChildren
      .slice()
      .sort((a, b) => a.childDefinitionId.localeCompare(b.childDefinitionId)),
    executionTarget,
    inheritedDefaults: parentDefaults,
    globalCeilings: effectiveCeilings,
    publicationPolicy,
    retentionPolicy
  }
  const canonicalDigest = `sha256:${sha256Hex(toCanonicalJson(configDigestPayload))}`
  const snapshot: ResolvedAutomationRunSnapshot = {
    automationId: automation.id,
    definitionRevision: automation.definitionRevision ?? 1,
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
