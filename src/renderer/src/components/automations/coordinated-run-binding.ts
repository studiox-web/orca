import type { Automation } from '../../../../shared/automations-types'
import type { AutomationOwnerRef } from '../../../../shared/automation-owner-ref'
import { ownerKey } from '../../../../shared/automation-owner-key'

export type CoordinatedRunBinding = { automation: Automation; owner: AutomationOwnerRef }

export function coordinatedRunBindingKey(binding: CoordinatedRunBinding): string {
  return JSON.stringify([ownerKey(binding.owner), binding.automation.id])
}
