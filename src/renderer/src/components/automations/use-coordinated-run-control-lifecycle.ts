import { useEffect, useRef, useState } from 'react'
import type { RunControlActionRequest } from './AutomationRunControlImpactDialog'
import type {
  CoordinatedRunOperatorActions,
  ProjectedCoordinatedStage
} from './coordinated-automation-run-types'
import type { ProjectedCoordinatedRun } from './coordinated-automation-run-projection'

export type CoordinatedRunControlNotice = {
  runId: string
  label: string
  state: 'pending' | 'succeeded' | 'failed'
  message: string
}

/** Single-flight operator-control lifecycle: duplicate submits are refused, results are fenced to the run that submitted them, and success copy never claims a host outcome. */
export function useCoordinatedRunControlLifecycle(input: {
  activeRunId: string | null
  projection: ProjectedCoordinatedRun | null
  operatorActions?: CoordinatedRunOperatorActions | null
}) {
  const { activeRunId, projection, operatorActions } = input
  const [controlRequest, setControlRequest] = useState<RunControlActionRequest | null>(null)
  const [controlNotice, setControlNotice] = useState<CoordinatedRunControlNotice | null>(null)
  const controlBusyRef = useRef(false)
  const controlsBusy = controlNotice?.state === 'pending'

  // Why: a dialog or result notice bound to a previous selection must never confirm or report against the newly selected run.
  useEffect(() => {
    setControlRequest(null)
    setControlNotice(null)
  }, [activeRunId])

  const runControlAction = async (
    runId: string,
    label: string,
    invoke: () => void | Promise<void>
  ): Promise<void> => {
    if (controlBusyRef.current) {
      return
    }
    controlBusyRef.current = true
    setControlNotice({ runId, label, state: 'pending', message: '' })
    try {
      await invoke()
      setControlNotice({
        runId,
        label,
        state: 'succeeded',
        message: `${label} request submitted. The owning host settles the outcome; refresh to inspect the exact run.`
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setControlNotice({
        runId,
        label,
        state: 'failed',
        message: `The host did not confirm the ${label.toLowerCase()} request (${detail}). No outcome change is claimed; refresh to inspect the exact run before retrying.`
      })
    } finally {
      controlBusyRef.current = false
    }
  }

  const requestControl = (request: RunControlActionRequest): void => {
    if (controlBusyRef.current) {
      return
    }
    setControlRequest(request)
  }

  const handleConfirmStop = (): void => {
    const onStopRun = operatorActions?.stopRun?.onStopRun
    if (!projection?.stopEligibility.canStop || !onStopRun) {
      return
    }
    void runControlAction(projection.automationRunId, 'Stop run', () =>
      onStopRun({
        automationId: projection.automationId,
        automationRunId: projection.automationRunId,
        orchestrationRunId: projection.orchestrationRunId,
        definitionRevision: projection.definitionRevision,
        targetExecutionAuthority: projection.targetExecutionAuthority
      })
    )
  }

  const handleConfirmRetry = (stage: ProjectedCoordinatedStage): void => {
    const onRetryStage = operatorActions?.retryStage?.onRetryStage
    const orchestrationRunId = projection?.orchestrationRunId ?? null
    if (
      !projection ||
      !onRetryStage ||
      !orchestrationRunId ||
      !stage.retryEligibility.canRetry ||
      !stage.taskId ||
      !stage.retryEligibility.retryOfDispatchId
    ) {
      return
    }
    const retryOfDispatchId = stage.retryEligibility.retryOfDispatchId
    const taskId = stage.taskId
    void runControlAction(projection.automationRunId, 'Retry stage', () =>
      onRetryStage({
        automationId: projection.automationId,
        automationRunId: projection.automationRunId,
        orchestrationRunId,
        childDefinitionId: stage.childDefinitionId,
        taskId,
        retryOfDispatchId,
        definitionRevision: projection.definitionRevision,
        targetExecutionAuthority: projection.targetExecutionAuthority
      })
    )
  }

  const handleConfirmResolveGate = (
    stage: ProjectedCoordinatedStage,
    gateId: string,
    decision: 'approve' | 'reject' | 'escalate',
    note: string
  ): void => {
    const onResolveGate = operatorActions?.resolveGate?.onResolveGate
    const orchestrationRunId = projection?.orchestrationRunId ?? null
    if (
      !projection ||
      !onResolveGate ||
      !orchestrationRunId ||
      !stage.gateResolutionEligibility.canResolve
    ) {
      return
    }
    void runControlAction(projection.automationRunId, 'Resolve gate', () =>
      onResolveGate({
        automationId: projection.automationId,
        automationRunId: projection.automationRunId,
        orchestrationRunId,
        childDefinitionId: stage.childDefinitionId,
        taskId: stage.taskId ?? undefined,
        dispatchId: stage.activeDispatchId ?? undefined,
        gateId,
        decision,
        note: note || undefined,
        targetExecutionAuthority: projection.targetExecutionAuthority
      })
    )
  }

  return {
    controlsBusy,
    controlNotice,
    controlRequest,
    requestControl,
    closeControlRequest: () => setControlRequest(null),
    handleConfirmStop,
    handleConfirmRetry,
    handleConfirmResolveGate
  }
}
