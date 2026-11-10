import type { OrchestrationCompatibilityEvidence } from '../../shared/orchestration-compatibility-evidence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import {
  isCoordinatedNativeAttempt,
  readCoordinatedNativeBinding
} from './coordinated-automation-native-attempt'

/** This narrows native report ingestion; it cannot attach, rebind or settle a Dispatch. */
export function assertCoordinatedNativeReportCaller(input: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  dispatchId: string | undefined
  from: string
  evidence?: OrchestrationCompatibilityEvidence
}): void {
  const { runtime, db, dispatchId, from, evidence } = input
  if (!dispatchId || !isCoordinatedNativeAttempt(db, dispatchId)) {
    return
  }
  const binding = readCoordinatedNativeBinding(db, dispatchId)
  const dispatch = db.getDispatchContextById(dispatchId)
  const worker = db.getWorkerDispatch(dispatchId)
  const caller = runtime.verifyOrchestrationCompatibilityCaller(evidence, {
    currentRuntimeLaunchSufficient: true
  })
  if (
    !binding ||
    !dispatch ||
    !worker ||
    !caller ||
    caller.terminalHandle !== from ||
    dispatch.consumer_generation !== 1 ||
    dispatch.assignee_handle !== from ||
    dispatch.assignee_pane_key !== caller.paneKey ||
    dispatch.process_incarnation !== caller.processIncarnation ||
    dispatch.launch_token_hash !== caller.launchTokenHash ||
    worker.runtime_epoch !== binding.runtimeGeneration ||
    runtime.getRuntimeId() !== binding.runtimeGeneration ||
    !db.isDispatchProcessCurrent({
      dispatchId,
      paneKey: caller.paneKey,
      processIncarnation: caller.processIncarnation
    })
  ) {
    throw new OrchestrationError(
      'consumer_fenced',
      'Native coordinated report requires the exact current runtime, token, pane and process authority; no settlement was applied.'
    )
  }
}
