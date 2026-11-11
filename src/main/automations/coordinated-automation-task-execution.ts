import { prepareCoordinatedNativeStubAttempt } from './coordinated-automation-native-stub-worker'
import { prepareCoordinatedNativeProviderAttempt } from './coordinated-automation-native-provider-worker'
import { inNativeDispatchLane } from './coordinated-automation-native-dispatch-lane'
import {
  isCoordinatedNativeAttempt,
  nativeAttemptBindingProblem,
  nativeAttemptStartOptions,
  runCoordinatedNativeAttemptKind
} from './coordinated-automation-native-attempt'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'
import { validateLaunchPolicy } from './coordinated-automation-result-validation'
import {
  assertCoordinatorActive,
  CoordinatedHostStoppedError,
  type CoordinatedRecoveryContext,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider,
  CoordinatedWorkerStartError,
  FAKE_EFFECT_ADAPTER_KIND
} from './coordinated-automation-recovery-context'
import { validateAttemptReport } from './coordinated-automation-attempt-validation'
import {
  COORDINATED_START_FAILURE_PREFIX,
  COORDINATED_TIMEOUT_PREFIX
} from './coordinated-automation-attempt-prefixes'
import { encodeCoordinatedWorkerReport } from './coordinated-automation-worker-report-envelope'
export { createDefaultFakeNoEffectsWorkerProvider } from './coordinated-automation-fake-worker-provider'

const FAKE_WORKER_CAPABILITIES = new Set(['fake_no_effects', 'shadow_fake_worker'])

function hasFakeWorkerCapability(provider: CoordinatedWorkerProvider): boolean {
  const declared = [provider.capability, ...(provider.capabilities ?? [])]
  return declared.some((c) => c !== undefined && FAKE_WORKER_CAPABILITIES.has(c))
}

export function executeCoordinatedTaskDispatch(
  ...args: Parameters<typeof executeTaskDispatch>
): ReturnType<typeof executeTaskDispatch> {
  const [ctx, input] = args
  return ctx.nativeStubWorker || ctx.nativeProviderWorker
    ? inNativeDispatchLane(ctx.orchestrationDb, input.taskId, () => executeTaskDispatch(...args))
    : executeTaskDispatch(...args)
}

async function executeTaskDispatch(
  ctx: CoordinatedRecoveryContext,
  input: {
    automationRunId: string
    taskId: string
    retryOfDispatchId?: string
    /** Persisted attempt deadline; the worker is raced against it on the coordinator clock. */
    deadlineAt?: number
    /** Binds the write-ahead attempt record to the created native Dispatch. */
    onDispatchCreated?: (dispatchId: string) => void
    /** Throws when this coordinator generation was replaced; no native write follows. */
    assertCurrent?: () => void
  }
): Promise<{ taskId: string; dispatchId: string; outcome: string }> {
  const { automationRunId, taskId, retryOfDispatchId } = input
  const { store, orchestrationDb, probe, workerProvider } = ctx
  const run = store.listAutomationRuns().find((r) => r.id === automationRunId)
  if (!run) {
    throw new Error(`Automation run "${automationRunId}" not found.`)
  }
  if (run.status === 'completed' || run.completionReceipt !== null) {
    throw new CoordinatedAutomationLaunchRefusedError(
      `Run "${automationRunId}" is already completed; cannot dispatch task "${taskId}".`
    )
  }
  if (run.materializationPhase !== 'ready_for_dispatch') {
    throw new Error(
      `Run "${automationRunId}" is in phase "${run.materializationPhase}", expected "ready_for_dispatch".`
    )
  }
  const snapshot = run.resolvedSnapshot
  if (!snapshot || !run.orchestrationRunId) {
    throw new Error(
      `Run "${automationRunId}" has no resolved snapshot or linked orchestration Run.`
    )
  }
  if (!probe.hasRun(run.orchestrationRunId)) {
    throw new Error(
      `Orchestration Run "${run.orchestrationRunId}" not found for run "${automationRunId}".`
    )
  }

  const mapping = (run.childMappings ?? []).find((m) => m.taskId === taskId)
  if (!mapping) {
    throw new Error(`Task "${taskId}" has no mapped child definition in run "${automationRunId}".`)
  }
  const child = snapshot.resolvedChildren.find(
    (c) => c.childDefinitionId === mapping.childDefinitionId
  )
  if (!child || !child.enabled) {
    throw new Error(
      `Child definition "${mapping.childDefinitionId}" not found or disabled in snapshot.`
    )
  }
  if (!probe.hasTask(run.orchestrationRunId, taskId)) {
    throw new Error(
      `Task "${taskId}" does not exist in orchestration Run "${run.orchestrationRunId}".`
    )
  }

  const policyCheck = validateLaunchPolicy(child, snapshot, {
    fakeEffects: ctx.effectAdapter?.kind === FAKE_EFFECT_ADAPTER_KIND
  })
  if (!policyCheck.allowed) {
    throw new CoordinatedAutomationLaunchRefusedError(policyCheck.reason)
  }
  if (ctx.nativeStubWorker && ctx.nativeProviderWorker) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'A coordinated run cannot mix the pinned stub host with a normal-provider host.'
    )
  }
  if (
    !ctx.nativeStubWorker &&
    !ctx.nativeProviderWorker &&
    !hasFakeWorkerCapability(workerProvider)
  ) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'Provider rejected: the disabled shadow implementation requires an explicit host-owned fake/no-effect provider capability.'
    )
  }

  const deadlineAt = input.deadlineAt ?? ctx.clock.now() + child.launchConfig.timeoutSeconds * 1000
  const existing = orchestrationDb.getDispatchContext(taskId)
  if (existing && isCoordinatedNativeAttempt(orchestrationDb, existing.id)) {
    const current = store.listAutomationRuns().find((r) => r.id === run.id)!
    const problem = nativeAttemptBindingProblem(orchestrationDb, current, existing.id)
    if (problem) {
      throw new Error(problem)
    }
    return { taskId, dispatchId: existing.id, outcome: 'native_retained' }
  }
  const previousNativeKind = runCoordinatedNativeAttemptKind(
    orchestrationDb,
    run.orchestrationRunId
  )
  const nativeKind = ctx.nativeStubWorker?.kind ?? ctx.nativeProviderWorker?.kind
  if (previousNativeKind && previousNativeKind !== nativeKind) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'Native attempts exist; a fresh launch without the same native host is refused.'
    )
  }
  const prepareInput = {
    run,
    child,
    taskId,
    retryOfDispatchId,
    deadlineAt,
    assertCurrent: input.assertCurrent
  }
  const native = ctx.nativeStubWorker
    ? await prepareCoordinatedNativeStubAttempt(ctx, prepareInput)
    : ctx.nativeProviderWorker
      ? await prepareCoordinatedNativeProviderAttempt(ctx, prepareInput)
      : undefined
  input.assertCurrent?.()
  if (native && existing) {
    throw new Error('native_existing_attempt_refused')
  }
  const started = orchestrationDb.createStartingWorkerDispatch({
    taskId,
    taskRunId: run.orchestrationRunId,
    retryOf: retryOfDispatchId,
    creator: { kind: 'system' },
    maxDepth: 5,
    runtimeEpoch: native?.binding.runtimeGeneration,
    startOptions: {
      agent: child.launchConfig.agentId,
      model: child.launchConfig.model,
      reasoningEffort: child.launchConfig.reasoningEffort,
      surface: child.launchConfig.surface,
      extraAgentArgs: child.launchConfig.extraAgentArgs,
      reuseSession: child.launchConfig.reuseSession,
      workspaceMode: child.launchConfig.workspaceMode,
      workspaceId: child.launchConfig.workspaceId,
      baseBranch: child.launchConfig.baseBranch,
      setupDecision: child.launchConfig.setupDecision,
      timeoutMs: (child.launchConfig.timeoutSeconds ?? 60) * 1000,
      maxRetries: child.launchConfig.maxRetries,
      maxReviewIterations: child.launchConfig.maxReviewIterations,
      mode: { mode: native ? 'terminal' : 'headless' },
      ...(native && 'launchReceipt' in native ? { launch: native.launchReceipt } : {}),
      ...(native ? nativeAttemptStartOptions(native.binding) : {})
    }
  })
  const { dispatch } = started
  const boundaryDetail = {
    automationRunId,
    childDefinitionId: child.childDefinitionId,
    label: dispatch.id
  }
  ctx.boundary('dispatch.after-native-start', boundaryDetail)
  input.onDispatchCreated?.(dispatch.id)

  store.recordCoordinatedChildDispatch({
    automationRunId: run.id,
    childDefinitionId: child.childDefinitionId,
    dispatchId: dispatch.id
  })
  ctx.boundary('dispatch.after-mapping', boundaryDetail)

  if (native) {
    await store.flushPendingOrThrowAsync()
    input.assertCurrent?.()
    await raceWorkerDeadline(ctx, native.launch(started), deadlineAt)
    input.assertCurrent?.()
    assertCoordinatorActive(ctx)
    return { taskId, dispatchId: dispatch.id, outcome: 'native_retained' }
  }

  const identity: CoordinatedWorkerIdentity = {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId: dispatch.id
  }
  const settle = (outcome: 'succeeded' | 'failed', result: string): void => {
    input.assertCurrent?.()
    orchestrationDb.settleWorkerReport({ taskId, dispatchId: dispatch.id, outcome, result })
    ctx.boundary('report.after-native-settle', boundaryDetail)
  }

  let rawReport: unknown
  try {
    const raced = await raceWorkerDeadline(ctx, workerProvider.run(identity), input.deadlineAt)
    if (raced.timedOut) {
      settle(
        'failed',
        `${COORDINATED_TIMEOUT_PREFIX} attempt ${dispatch.id} passed its ${child.launchConfig.timeoutSeconds}s deadline.`
      )
      return { taskId, dispatchId: dispatch.id, outcome: 'timed_out' }
    }
    rawReport = raced.value
  } catch (error) {
    if (error instanceof CoordinatedHostStoppedError) {
      // Host stop abandoned the wait; the attempt stays unsettled for a later generation.
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    const started = !(error instanceof CoordinatedWorkerStartError)
    settle('failed', started ? message : `${COORDINATED_START_FAILURE_PREFIX} ${message}`)
    return { taskId, dispatchId: dispatch.id, outcome: started ? 'failed' : 'start_failed' }
  }

  const currentRun = store.listAutomationRuns().find((r) => r.id === automationRunId)
  const currentMappedDispatchId = (currentRun?.childMappings ?? []).find(
    (m) => m.taskId === taskId && m.childDefinitionId === child.childDefinitionId
  )?.dispatchId
  if (!currentMappedDispatchId || currentMappedDispatchId !== dispatch.id) {
    settle(
      'failed',
      encodeCoordinatedWorkerReport(
        rawReport,
        `Task "${taskId}" mapped dispatchId "${currentMappedDispatchId ?? ''}" does not match active dispatch "${dispatch.id}".`
      )
    )
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }

  const validation = validateAttemptReport(ctx, {
    report: rawReport,
    run,
    snapshot,
    child,
    taskId,
    dispatchId: currentMappedDispatchId
  })
  if (!validation.valid && validation.awaitingApproval) {
    // Technically delivered; stage admission holds it for the operator instead of rejecting it.
    settle('succeeded', encodeCoordinatedWorkerReport(validation.awaitingApproval.report))
    return { taskId, dispatchId: dispatch.id, outcome: 'awaiting_approval' }
  }
  if (!validation.valid) {
    settle('failed', encodeCoordinatedWorkerReport(rawReport, validation.error))
    return { taskId, dispatchId: dispatch.id, outcome: 'failed' }
  }
  settle(
    validation.report.outcome === 'succeeded' ? 'succeeded' : 'failed',
    encodeCoordinatedWorkerReport(validation.report)
  )
  return { taskId, dispatchId: dispatch.id, outcome: validation.report.outcome }
}

/**
 * Resolves with the worker's value, or `timedOut` once the persisted deadline passes. Every wait
 * is registered so host stop cancels its timer and abandons the wait without settling anything.
 */
function raceWorkerDeadline(
  ctx: CoordinatedRecoveryContext,
  work: Promise<unknown>,
  deadlineAt: number | undefined
): Promise<{ timedOut: true } | { timedOut: false; value: unknown }> {
  return new Promise((resolve, reject) => {
    let cancelTimer: () => void = () => {}
    const finish = (settle: () => void): void => {
      cancelTimer()
      ctx.pendingWaits.delete(abandon)
      settle()
    }
    const abandon = (): void => finish(() => reject(new CoordinatedHostStoppedError()))
    ctx.pendingWaits.add(abandon)
    if (deadlineAt !== undefined && ctx.clock.setTimer) {
      const remaining = Math.max(0, deadlineAt - ctx.clock.now())
      cancelTimer = ctx.clock.setTimer(remaining, () =>
        ctx.isActive() ? finish(() => resolve({ timedOut: true })) : abandon()
      )
    }
    work.then(
      (value) => finish(() => resolve({ timedOut: false, value })),
      (error: unknown) => finish(() => reject(error))
    )
  })
}
