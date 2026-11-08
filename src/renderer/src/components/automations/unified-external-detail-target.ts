import { hostStableKey, toStableCatalogRef } from '../../../../shared/automation-owner-key'
import type { UnifiedAutomationRow } from '../../../../shared/unified-automation-types'
import type { ExternalAutomationListEntry } from './external-automation-list-entries'

export function findExactUnifiedExternalEntry(
  row: UnifiedAutomationRow,
  entries: readonly ExternalAutomationListEntry[]
): ExternalAutomationListEntry | null {
  if (row.identity.kind !== 'external') {
    return null
  }
  const identity = row.identity
  return (
    entries.find(
      (entry) =>
        entry.manager.id === identity.managerId &&
        entry.job.id === identity.jobId &&
        hostStableKey(toStableCatalogRef(entry.scope.owner)) === hostStableKey(identity.authority)
    ) ?? null
  )
}

export function openExactUnifiedExternalEntry(
  row: UnifiedAutomationRow,
  entries: readonly ExternalAutomationListEntry[],
  actions: {
    selectAutomationRow: (key: string | null) => void
    selectExternalKey: (key: string | null) => void
    setActivePaneTab: (tab: 'overview') => void
    setIsDetailOpen: (open: boolean) => void
    openNativeList: () => void
  }
): boolean {
  const candidate = findExactUnifiedExternalEntry(row, entries)
  if (!candidate) {
    return false
  }
  actions.selectAutomationRow(null)
  actions.selectExternalKey(candidate.key)
  actions.setActivePaneTab('overview')
  actions.setIsDetailOpen(true)
  actions.openNativeList()
  return true
}
