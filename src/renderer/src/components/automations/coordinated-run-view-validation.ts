import { translate } from '@/i18n/i18n'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import type { CoordinatedRunSelectionInput } from '../../../../shared/rpc-contract/coordinated-automation-run-params'
import type { CoordinatedRunExecutionKind } from './coordinated-run-host-kind'

export function validateCoordinatedRunView(
  view: CoordinatedRunView,
  selection: CoordinatedRunSelectionInput,
  expectedRevision?: number,
  expectedKey?: string,
  executionKind?: CoordinatedRunExecutionKind
): CoordinatedRunView {
  const inspection = view.inspection
  if (
    view.runtimeId !== selection.runtimeId ||
    inspection.automationId !== selection.automationId ||
    inspection.automationRunId !== selection.automationRunId ||
    (expectedRevision !== undefined && inspection.definitionRevision !== expectedRevision) ||
    (expectedKey !== undefined && inspection.idempotencyKey !== expectedKey) ||
    (executionKind !== undefined && (view.executionKind ?? 'fake') !== executionKind)
  ) {
    throw new Error(
      translate(
        'auto.components.automations.coordinatedRuns.responseIdentityChanged',
        'The host returned a different runtime, parent, run, revision, request identity, or execution mode. Refresh to inspect the exact run.'
      )
    )
  }
  if (inspection.receipt.kind === 'available') {
    const receipt = inspection.receipt.receipt
    const identity = receipt.identityChain
    if (
      identity.automationId !== inspection.automationId ||
      identity.automationRunId !== inspection.automationRunId ||
      identity.orchestrationRunId !== inspection.orchestrationRunId ||
      identity.definitionRevision !== inspection.definitionRevision ||
      receipt.frozenConfigDigest !== inspection.canonicalDigest ||
      identity.taskMappings.some(
        (mapping) =>
          !inspection.stages.some(
            (stage) =>
              stage.childDefinitionId === mapping.childDefinitionId &&
              stage.taskId === mapping.taskId &&
              stage.mappedDispatchId === mapping.dispatchId
          )
      )
    ) {
      throw new Error(
        translate(
          'auto.components.automations.coordinated.run.api.client.76cc2a16b8',
          'The receipt identity does not match the selected host run. Evidence is unavailable.'
        )
      )
    }
  }
  return view
}
