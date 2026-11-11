import { translate } from '@/i18n/i18n'
import type {
  AutomationRun,
  CoordinatedRunQuarantineSummary
} from '../../../../shared/automations-types'
import type {
  CoordinatedApprovalObservation,
  CoordinatedParentSemanticState,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-types'

export function deriveParentSemanticOutcome(input: {
  run: AutomationRun
  quarantine: CoordinatedRunQuarantineSummary | null
  stages: readonly ProjectedCoordinatedStage[]
  parentApprovals: readonly CoordinatedApprovalObservation[]
}): { state: CoordinatedParentSemanticState; reason: string } {
  const { run, quarantine, stages, parentApprovals } = input
  if (quarantine) {
    return {
      state: 'quarantined',
      reason: translate(
        'auto.components.automations.coordinatedLabels.quarantinedReason',
        'Quarantined: {{reason}}',
        { reason: quarantine.reason }
      )
    }
  }
  if (run.completionReceipt) {
    return {
      state: run.completionReceipt.finalState,
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.1142efa25d',
        'Verified completion receipt ({{value0}}).',
        { value0: run.completionReceipt.finalState }
      )
    }
  }
  if (stages.some((s) => s.hasUncertainEffect || s.stageExecutionStatus === 'uncertain')) {
    return {
      state: 'outcome_uncertain',
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.a750864e8e',
        'Mutation lane stopped: an external effect returned uncertain and requires reconciliation.'
      )
    }
  }
  if (run.status === 'completed') {
    return {
      state: 'unaccepted',
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.75c6959928',
        'Technical process completed, but no verified semantic completion receipt is persisted.'
      )
    }
  }
  if (
    stages.some((s) => s.stageExecutionStatus === 'waiting_for_approval') ||
    parentApprovals.some((a) => a.status === 'pending')
  ) {
    return {
      state: 'waiting_for_approval',
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.3a3ac64157',
        'Waiting for required human or distinct-reviewer approval.'
      )
    }
  }
  if (stages.some((s) => s.stageExecutionStatus === 'blocked')) {
    return {
      state: 'blocked',
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.089e966170',
        'One or more worker stages are blocked.'
      )
    }
  }
  if (
    run.status === 'dispatch_failed' ||
    run.materializationPhase === 'materialization_failed' ||
    run.materializationPhase === 'compensation_failed' ||
    stages.some((s) => s.stageExecutionStatus === 'failed')
  ) {
    return {
      state: 'failed',
      reason:
        run.error ??
        run.materializationError ??
        translate(
          'auto.components.automations.coordinated.automation.run.summary.68abdf2362',
          'One or more worker stages failed.'
        )
    }
  }
  if (
    run.status === 'dispatching' ||
    run.status === 'dispatched' ||
    stages.some((s) => s.stageExecutionStatus === 'active')
  ) {
    return {
      state: 'in_progress',
      reason: translate(
        'auto.components.automations.coordinated.automation.run.summary.c9d2c55c94',
        'Specialist workers are executing in native orchestration.'
      )
    }
  }
  return {
    state: 'pending',
    reason: translate(
      'auto.components.automations.coordinated.automation.run.summary.81c3604d43',
      'Run is queued or awaiting stage materialization.'
    )
  }
}
