import { translate } from '@/i18n/i18n'
import type { CoordinatedRunExecutionKind } from './coordinated-run-host-kind'

export function coordinatedHostRunLabels(kind?: CoordinatedRunExecutionKind) {
  if (kind === 'fake') {
    return {
      section: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.ef7556bba0',
        'Coordinated test runs'
      ),
      title: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.2028e358fc',
        'No-effect test runs'
      ),
      description: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.895a30868b',
        'Manual isolated workers only. No live agents, publishing, or schedules. Each run keeps its saved definition revision.'
      ),
      start: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.fbf7305e30',
        'Start no-effect test run'
      ),
      recoverStart: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.14ece0f19f',
        'Recover original test start'
      ),
      refresh: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.6d450f055c',
        'Refresh test runs'
      ),
      reconcile: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.d1c62536a6',
        'Reconcile selected test run'
      ),
      selection: translate(
        'auto.components.automations.AutomationCoordinatedHostRunPanel.3807d1b0b4',
        'Selected test run'
      )
    }
  }
  return {
    section: translate('auto.components.automations.coordinatedRuns.section', 'Coordinated runs'),
    title:
      kind === 'native'
        ? translate(
            'auto.components.automations.coordinatedRuns.nativeTitle',
            'Manual native worker runs'
          )
        : translate('auto.components.automations.coordinatedRuns.section', 'Coordinated runs'),
    description:
      kind === 'native'
        ? translate(
            'auto.components.automations.coordinatedRuns.nativeDescription',
            'Uses real agents in the admitted isolated workspace. No scheduled runs or publishing. Each run keeps its saved definition revision.'
          )
        : translate(
            'auto.components.automations.coordinatedRuns.unknownDescription',
            'The owning host must confirm its worker execution mode and availability before a run can start.'
          ),
    start: translate('auto.components.automations.coordinatedRuns.manualStart', 'Start manual run'),
    recoverStart: translate(
      'auto.components.automations.coordinatedRuns.recoverStart',
      'Recover original start'
    ),
    refresh: translate('auto.components.automations.coordinatedRuns.refresh', 'Refresh runs'),
    reconcile: translate(
      'auto.components.automations.coordinatedRuns.reconcile',
      'Reconcile selected run'
    ),
    selection: translate('auto.components.automations.coordinatedRuns.selection', 'Selected run')
  }
}
