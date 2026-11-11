import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { translate } from '@/i18n/i18n'
import type {
  CoordinatedPendingGate,
  CoordinatedRunOperatorOutcome
} from './coordinated-run-operator-client'

export function gateScopeLabel(gate: CoordinatedPendingGate, view: CoordinatedRunView): string {
  if (gate.scope === 'parent') {
    return translate(
      'auto.components.automations.AutomationCoordinatedHostRunControls.ff41aee1ba',
      'Parent outcome (no stage scope)'
    )
  }
  if (!gate.childDefinitionId) {
    return translate(
      'auto.components.automations.AutomationCoordinatedHostRunControls.2985550c91',
      'Run-level escalation (no stage scope)'
    )
  }
  if (gate.scope === 'escalation') {
    return translate(
      'auto.components.automations.coordinatedLabels.stageEscalation',
      '{{child}} (escalation)',
      { child: gate.childDefinitionId }
    )
  }
  const stage = view.inspection.stages.find(
    (entry) => entry.childDefinitionId === gate.childDefinitionId
  )
  const dispatchId = stage?.pendingApproval?.dispatchId
  const candidate = stage?.gateResolutionEligibility.stageCandidate
  const attempt =
    candidate?.kind === 'attempt'
      ? translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.d295074e6a',
          'attempt {{value0}} (no held report)',
          { value0: candidate.dispatchId }
        )
      : candidate?.kind === 'no_attempt'
        ? translate('auto.components.automations.coordinatedLabels.noAttempt', 'no attempt')
        : translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.15076c7ef1',
            'candidate unavailable'
          )
  return `${gate.childDefinitionId} / ${stage?.taskId ?? translate('auto.components.automations.coordinatedLabels.noTask', 'no-task')} / ${
    dispatchId
      ? translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.4ac74b8a82',
          'report from {{value0}}',
          { value0: dispatchId }
        )
      : attempt
  }`
}

export function gateImpact() {
  return {
    stage: translate(
      'auto.components.automations.AutomationCoordinatedHostRunControls.e1d54deaea',
      'This decision applies only to the report or attempt shown here. Rejecting a held report may start a retry within the saved retry budget. With no held report, rejection halts the run. Escalation leaves the requirement pending for a later approval or rejection.'
    ),
    parent: translate(
      'auto.components.automations.AutomationCoordinatedHostRunControls.c82013ac96',
      'This decision applies to the parent outcome, not to any one stage.'
    ),
    escalation: translate(
      'auto.components.automations.AutomationCoordinatedHostRunControls.ebfca8574b',
      'An escalation decision records your acknowledgement only. It does not clear the halt or approve a requirement.'
    )
  } as const
}

export function operatorOutcomeMessage(outcome: CoordinatedRunOperatorOutcome): string {
  const { action, disposition } = outcome
  const subject =
    action.kind === 'stop'
      ? translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.91ee9583a7',
          'stop request'
        )
      : action.kind === 'retry'
        ? translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.0dca7ffd0b',
            'retry of stage {{value0}}',
            { value0: action.childDefinitionId }
          )
        : translate(
            'auto.components.automations.AutomationCoordinatedHostRunControls.19d5f08d7f',
            '{{value0}} decision for {{value1}} gate {{value2}}',
            { value0: action.decision, value1: action.scope, value2: action.gateId }
          )
  const recorded =
    disposition === 'already_recorded'
      ? translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.9ec0788096',
          'The host had already recorded this {{value0}}; this request wrote nothing.',
          { value0: subject }
        )
      : translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.c5016fc0d9',
          'The host recorded the {{value0}}.',
          { value0: subject }
        )
  const caveat =
    action.kind === 'stop'
      ? translate(
          'auto.components.automations.AutomationCoordinatedHostRunControls.0fa46a6c42',
          ' Worker exit is not proven until the run settles.'
        )
      : ''
  return translate(
    'auto.components.automations.AutomationCoordinatedHostRunControls.a4ef48a37a',
    '{{value0}}{{value1}} Reported run state: {{value2}}{{value3}}.',
    {
      value0: recorded,
      value1: caveat,
      value2: outcome.state,
      value3: outcome.reason ? ` (${outcome.reason})` : ''
    }
  )
}
