import type { Automation } from './automations-types'
import type {
  ChildLaunchConfig,
  ChildLaunchConfigField,
  CoordinatedAutomationCeilings,
  CoordinatedAutomationChildDefinition,
  OverrideProvenance,
  ResolvedChildLaunchConfig
} from './coordinated-automation-types'

export function resolveParentDefaults(
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

export function resolveChildLaunchConfig(
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
