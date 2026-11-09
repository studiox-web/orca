import type { AutomationKind } from '../../../../shared/automations-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export function isCoordinatedAutomationsFeatureEnabled(settings?: GlobalSettings | null): boolean {
  return settings?.experimentalCoordinatedAutomations === true
}

export function shouldShowWorkersSection(
  automation?: { kind?: AutomationKind } | null,
  settings?: GlobalSettings | null
): boolean {
  if (automation?.kind === 'coordinated') {
    return true
  }
  return isCoordinatedAutomationsFeatureEnabled(settings)
}
