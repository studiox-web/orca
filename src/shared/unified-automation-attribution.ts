import type { Automation, AutomationRun } from './automations-types'
import { hostStableKey } from './automation-owner-key'
import type { StableAutomationCatalogRef } from './automation-owner-ref'
import { automationAuthority, automationRunAuthority } from './unified-automation-source-adapters'
import type { UnifiedAutomationWarning } from './unified-automation-types'

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
): { latest: Map<string, AutomationRun>; warnings: UnifiedAutomationWarning[] } {
  const latest = new Map<string, AutomationRun>()
  const warnings: UnifiedAutomationWarning[] = []
  const definitionKeys = new Set(
    automations.map((automation) =>
      qualifiedAutomationKey(automationAuthority(automation).stable, automation.id)
    )
  )
  for (const run of runs) {
    const authority = automationRunAuthority(run)
    if (!authority) {
      warnings.push({
        code: 'run-attribution-conflict',
        message: `Native run ${run.id} for automation ${run.automationId} has no authority-qualified host context and was not attributed.`
      })
      continue
    }
    const key = qualifiedAutomationKey(authority, run.automationId)
    if (!definitionKeys.has(key)) {
      warnings.push({
        code: 'run-attribution-conflict',
        message: `Native run ${run.id} for automation ${run.automationId} belongs to ${hostStableKey(authority)}, which has no matching definition in this snapshot.`
      })
      continue
    }
    const current = latest.get(key)
    const at = run.startedAt ?? run.createdAt
    const currentAt = current ? (current.startedAt ?? current.createdAt) : Number.NEGATIVE_INFINITY
    if (!current || at > currentAt || (at === currentAt && run.id.localeCompare(current.id) > 0)) {
      latest.set(key, run)
    }
  }
  return { latest, warnings }
}
