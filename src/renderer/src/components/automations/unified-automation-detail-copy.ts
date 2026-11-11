import { translate } from '@/i18n/i18n'
import type { UnifiedDenialReason } from '../../../../shared/unified-automation-capabilities'

export function unifiedDenialLabel(reason: UnifiedDenialReason): string {
  switch (reason) {
    case 'flag-off':
      return translate('auto.components.automations.unified.detail.denial.flagOff', 'flag off')
    case 'read-only-surface':
      return translate(
        'auto.components.automations.unified.detail.denial.readOnlySurface',
        'read only surface'
      )
    case 'local-only-goal':
      return translate(
        'auto.components.automations.unified.detail.denial.localOnlyGoal',
        'local only Goal'
      )
    case 'host-disconnected':
      return translate(
        'auto.components.automations.unified.detail.denial.hostDisconnected',
        'host disconnected'
      )
    case 'legacy-identity':
      return translate(
        'auto.components.automations.unified.detail.denial.legacyIdentity',
        'legacy identity'
      )
    case 'unsupported-platform':
      return translate(
        'auto.components.automations.unified.detail.denial.unsupportedPlatform',
        'unsupported platform'
      )
    case 'manager-unsupported':
      return translate(
        'auto.components.automations.unified.detail.denial.managerUnsupported',
        'manager unsupported'
      )
    case 'archived':
      return translate('auto.components.automations.unified.detail.denial.archived', 'archived')
    case 'conflict':
      return translate('auto.components.automations.unified.detail.denial.conflict', 'conflict')
    case 'source-missing':
      return translate(
        'auto.components.automations.unified.detail.denial.sourceMissing',
        'source missing'
      )
    case 'source-stale':
      return translate(
        'auto.components.automations.unified.detail.denial.sourceStale',
        'source stale'
      )
    case 'capability-unknown':
      return translate(
        'auto.components.automations.unified.detail.denial.capabilityUnknown',
        'capability unknown'
      )
  }
}
