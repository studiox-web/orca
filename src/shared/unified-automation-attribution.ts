import type { Automation, AutomationRun } from './automations-types'
import { hostStableKey } from './automation-owner-key'
import type { StableAutomationCatalogRef } from './automation-owner-ref'
import { automationAuthority, automationRunAuthority } from './unified-automation-source-adapters'
import type {
  UnifiedAttributedAutomationRun,
  UnifiedAutomationWarning,
  UnifiedRunAuthorityAttribution
} from './unified-automation-types'

export function qualifiedAutomationKey(
  authority: StableAutomationCatalogRef,
  automationId: string
): string {
  return [hostStableKey(authority), automationId].map(encodeURIComponent).join('|')
}

export function groupedAutomations(automations: readonly Automation[]): Automation[][] {
  const groups = new Map<string, Automation[]>()
  for (const automation of automations) {
    const authority = automationAuthority(automation).stable
    const key = qualifiedAutomationKey(authority, automation.id)
    groups.set(key, [...(groups.get(key) ?? []), automation])
  }
  return [...groups.values()].sort((a, b) =>
    qualifiedAutomationKey(automationAuthority(a[0]).stable, a[0].id).localeCompare(
      qualifiedAutomationKey(automationAuthority(b[0]).stable, b[0].id)
    )
  )
}

export function latestRunsByAutomationAuthority(
  automations: readonly Automation[],
  runs: readonly AutomationRun[]
): {
  latest: Map<string, UnifiedAttributedAutomationRun>
  warnings: UnifiedAutomationWarning[]
} {
  const latest = new Map<string, UnifiedAttributedAutomationRun>()
  const warnings: UnifiedAutomationWarning[] = []
  const definitionsById = new Map<string, Map<string, StableAutomationCatalogRef>>()
  for (const automation of automations) {
    const authority = automationAuthority(automation).stable
    const definitions = definitionsById.get(automation.id) ?? new Map()
    definitions.set(qualifiedAutomationKey(authority, automation.id), authority)
    definitionsById.set(automation.id, definitions)
  }
  for (const run of runs) {
    const definitions = definitionsById.get(run.automationId) ?? new Map()
    const attribution = runAuthorityAttribution(run, definitions)
    if (!attribution) {
      const qualifier = `${definitions.size} definition ${definitions.size === 1 ? 'authority' : 'authorities'}`
      warnings.push({
        code: 'run-attribution-conflict',
        message: `Native run ${run.id} for automation ${run.automationId} has no matching authority-qualified host context across ${qualifier} and was not attributed.`
      })
      continue
    }
    const key = qualifiedAutomationKey(attribution.authority, run.automationId)
    const current = latest.get(key)
    const at = run.startedAt ?? run.createdAt
    const currentAt = current
      ? (current.run.startedAt ?? current.run.createdAt)
      : Number.NEGATIVE_INFINITY
    if (
      !current ||
      at > currentAt ||
      (at === currentAt && run.id.localeCompare(current.run.id) > 0)
    ) {
      latest.set(key, { run, authorityAttribution: attribution })
    }
  }
  return { latest, warnings }
}

function runAuthorityAttribution(
  run: AutomationRun,
  definitions: ReadonlyMap<string, StableAutomationCatalogRef>
): UnifiedRunAuthorityAttribution | null {
  const recorded = automationRunAuthority(run)
  if (!recorded) {
    const authority = definitions.size === 1 ? definitions.values().next().value : undefined
    return authority ? { authority, evidence: 'inferred-unique-definition' } : null
  }
  if (definitions.has(qualifiedAutomationKey(recorded, run.automationId))) {
    return { authority: recorded, evidence: 'run-context' }
  }
  if (recorded.authority.kind !== 'runtime' || recorded.selector.kind !== 'self') {
    return null
  }
  const environmentId = recorded.authority.environmentId
  const candidates = [...definitions.values()].filter(
    (authority) =>
      authority.authority.kind === 'runtime' &&
      authority.authority.environmentId === environmentId &&
      authority.selector.kind === 'ssh'
  )
  return candidates.length === 1
    ? { authority: candidates[0], evidence: 'inferred-execution-target' }
    : null
}
