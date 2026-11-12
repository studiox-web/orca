import {
  nativeProviderHostFacts,
  validateNativeProviderWorkspace,
  type NativeProviderWorkerHost
} from './coordinated-automation-native-provider-host'
import type { AutomationRun } from '../../shared/automations-types'
import { computeSnapshotCanonicalDigest } from '../../shared/coordinated-automation-snapshot'
import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'
import { folderWorkspaceRepoId } from '../../shared/folder-workspace-worktree'
import { ROOT_DISPATCH_DEPTH } from '../../shared/nested-worker-depth'
import {
  assertNativeProviderExecutionAdmission,
  prepareNativeProviderLaunch
} from '../runtime/native-provider-execution-admission'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { launchPreparedWorkerDispatch } from '../runtime/rpc/methods/orchestration/worker/prepared-worker-dispatch-launch'
import { prepareLocalWorkerStart } from '../runtime/rpc/methods/orchestration/worker/worker-start-validation'
import { coordinatedMappingProblem } from './coordinated-automation-native-validation'
import {
  NATIVE_PROVIDER_ATTEMPT,
  nativeAttemptBindingProblem,
  type CoordinatedNativeAttemptBinding
} from './coordinated-automation-native-attempt'
import { planCoordinatedNativeProviderLaunch } from './coordinated-automation-native-provider-plan'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'
import type { CoordinatedRecoveryContext } from './coordinated-automation-recovery-context'
import { withCoordinatedReportBrief } from './coordinated-automation-report-brief'
import { withNativePilotReportToolBrief } from './coordinated-automation-native-pilot-brief'
import { LOCAL_SELF_OWNER, runScopeRefusal } from './coordinated-automation-run-host-gate'

export type CoordinatedNativeProviderWorker = Readonly<{ kind: typeof NATIVE_PROVIDER_ATTEMPT }>
const hosts = new WeakMap<CoordinatedNativeProviderWorker, NativeProviderWorkerHost>()

export function createCoordinatedNativeProviderWorker(
  input: NativeProviderWorkerHost
): CoordinatedNativeProviderWorker {
  assertNativeProviderExecutionAdmission(input.admission, input.runtime, input.store)
  if (input.runtime.getOrchestrationDb() !== input.db) {
    throw new Error('native_provider_database_mismatch')
  }
  const worker = Object.freeze({ kind: NATIVE_PROVIDER_ATTEMPT })
  hosts.set(worker, input)
  return worker
}

export function coordinatedNativeProviderHostIsActive(
  worker: CoordinatedNativeProviderWorker | undefined
): boolean {
  if (!worker) {
    return true
  }
  const host = hosts.get(worker)
  if (!host) {
    return false
  }
  try {
    assertNativeProviderExecutionAdmission(host.admission, host.runtime, host.store)
    return host.runtime.getOrchestrationDb() === host.db
  } catch {
    return false
  }
}

export function resolveActiveNativeProviderHost(
  worker: CoordinatedNativeProviderWorker
): NativeProviderWorkerHost & { generation: string } {
  const host = hosts.get(worker)
  if (!host) {
    throw new Error('coordinated_native_provider_host_refused')
  }
  const identity = assertNativeProviderExecutionAdmission(host.admission, host.runtime, host.store)
  if (host.runtime.getOrchestrationDb() !== host.db) {
    throw new Error('coordinated_native_provider_host_changed')
  }
  return { ...host, generation: identity.generation }
}

function readHost(ctx: CoordinatedRecoveryContext): NativeProviderWorkerHost {
  const host = ctx.nativeProviderWorker && hosts.get(ctx.nativeProviderWorker)
  if (!host || host.store !== ctx.store || host.db !== ctx.orchestrationDb || ctx.effectAdapter) {
    throw new Error('coordinated_native_provider_host_refused')
  }
  assertNativeProviderExecutionAdmission(host.admission, host.runtime, host.store)
  if (host.runtime.getOrchestrationDb() !== host.db || !ctx.isActive()) {
    throw new Error('coordinated_native_provider_host_changed')
  }
  return host
}

export async function prepareCoordinatedNativeProviderAttempt(
  ctx: CoordinatedRecoveryContext,
  input: {
    run: AutomationRun
    child: ResolvedChildSnapshot
    taskId: string
    retryOfDispatchId?: string
    deadlineAt?: number
    assertCurrent?: () => void
  }
): Promise<{
  binding: CoordinatedNativeAttemptBinding
  launchReceipt: ReturnType<typeof prepareLocalWorkerStart>['launch']['receipt']
  launch: (started: ReturnType<OrchestrationDb['createStartingWorkerDispatch']>) => Promise<unknown>
}> {
  const host = readHost(ctx)
  const snapshot = input.run.resolvedSnapshot!
  const identity = assertNativeProviderExecutionAdmission(host.admission, host.runtime, host.store)
  const assertCurrent = () => {
    input.assertCurrent?.()
    readHost(ctx)
    if (input.deadlineAt !== undefined && ctx.clock.now() >= input.deadlineAt) {
      throw new Error('coordinated_native_provider_deadline_elapsed')
    }
    if (host.store.automationOwnerPrecondition(input.run.automationId)?.selector.kind !== 'self') {
      throw new Error('coordinated_native_provider_owner_changed')
    }
    const current = host.store.listAutomationRuns().find((run) => run.id === input.run.id)
    const refusal = runScopeRefusal(host.store, {
      automationId: input.run.automationId,
      automationRunId: input.run.id,
      expectedOwner: LOCAL_SELF_OWNER
    })
    if (
      refusal ||
      !current?.resolvedSnapshot ||
      current.completionReceipt ||
      current.status === 'completed' ||
      current.automationId !== snapshot.automationId ||
      computeSnapshotCanonicalDigest(current.resolvedSnapshot) !== snapshot.canonicalDigest ||
      current.resolvedSnapshot.canonicalDigest !== snapshot.canonicalDigest ||
      current.orchestrationRunId !== input.run.orchestrationRunId ||
      coordinatedMappingProblem(host.db, current, current.resolvedSnapshot)
    ) {
      throw new Error(refusal ?? 'coordinated_native_provider_identity_changed')
    }
    if (
      current.childMappings?.find(
        (mapping) => mapping.childDefinitionId === input.child.childDefinitionId
      )?.taskId !== input.taskId
    ) {
      throw new Error('coordinated_native_provider_task_mismatch')
    }
  }
  assertCurrent()
  const planning = planCoordinatedNativeProviderLaunch({
    snapshot,
    child: input.child,
    taskId: input.taskId,
    host: nativeProviderHostFacts(host)
  })
  if (planning.kind === 'refused') {
    throw new CoordinatedAutomationLaunchRefusedError(`${planning.code}: ${planning.reason}`)
  }
  const plan = planning.plan
  const selector = plan.workerStart.worktree
  const scope = await host.runtime.resolveTerminalWorkspaceLaunchScope(selector)
  assertCurrent()
  validateNativeProviderWorkspace(host, plan, scope)
  const resolvedWorktree = await host.runtime.showManagedTerminalWorkspace(selector)
  assertCurrent()
  if (resolvedWorktree.id !== scope.id) {
    throw new Error('coordinated_native_provider_workspace_changed')
  }
  const { agent, launch } = prepareLocalWorkerStart({
    runtime: host.runtime,
    createsWorktree: false,
    params: {
      task: input.taskId,
      worktree: selector,
      agent: plan.workerStart.agent,
      model: plan.workerStart.model ?? undefined,
      effort: plan.workerStart.effort ?? undefined,
      timeoutMs: plan.workerStart.timeoutMs
    }
  })
  if (
    agent !== input.child.launchConfig.agentId ||
    launch.receipt.requested.agent !== agent ||
    launch.receipt.requested.model !== input.child.launchConfig.model ||
    launch.receipt.requested.effort !== input.child.launchConfig.reasoningEffort
  ) {
    throw new Error('coordinated_native_provider_launch_changed')
  }
  const binding: CoordinatedNativeAttemptBinding = {
    kind: NATIVE_PROVIDER_ATTEMPT,
    version: 1,
    automationId: input.run.automationId,
    automationRunId: input.run.id,
    orchestrationRunId: input.run.orchestrationRunId!,
    childDefinitionId: input.child.childDefinitionId,
    taskId: input.taskId,
    snapshotDigest: snapshot.canonicalDigest,
    definitionRevision: snapshot.definitionRevision,
    profile: identity.profile,
    runtimeGeneration: identity.generation,
    workspaceId: input.child.launchConfig.workspaceId!,
    retryOfDispatchId: input.retryOfDispatchId ?? null
  }
  return {
    binding,
    launchReceipt: launch.receipt,
    async launch(started) {
      const dispatchId = started.dispatch.id
      if (started.dispatch.depth > ROOT_DISPATCH_DEPTH + 1) {
        throw new Error('coordinated_native_provider_nested_refused')
      }
      const check = () => {
        assertCurrent()
        validateNativeProviderWorkspace(host, plan, scope)
        const current = host.store.listAutomationRuns().find((run) => run.id === input.run.id)!
        const problem = nativeAttemptBindingProblem(host.db, current, dispatchId)
        if (problem) {
          throw new Error(problem)
        }
      }
      check()
      const permit = prepareNativeProviderLaunch({
        admission: host.admission,
        runtime: host.runtime,
        runId: binding.orchestrationRunId,
        taskId: input.taskId,
        dispatchId,
        selection: {
          workspaceId: scope.id,
          path: scope.path,
          agent: plan.workerStart.agent,
          model: plan.workerStart.model,
          effort: plan.workerStart.effort
        },
        assertCurrent: check
      })
      const terminalHandle = host.runtime.createPreAllocatedTerminalHandle()
      return launchPreparedWorkerDispatch({
        preparedNativeProvider: permit,
        preAllocatedTerminalHandle: terminalHandle,
        onTerminalSpawnCommitted: (physical) => {
          host.db.recordCreatedWorkerTerminalCustody({
            dispatchId,
            handle: physical.handle,
            paneKey: physical.paneKey,
            processIncarnation: `${physical.ptyId}:${physical.incarnationId}`,
            worktreeId: resolvedWorktree.id,
            hostScope: JSON.stringify({ kind: 'local', hostId: 'local' })
          })
        },
        runtime: host.runtime,
        db: host.db,
        run: host.db.getRun(binding.orchestrationRunId)!,
        started: identity.pilotScope
          ? withNativePilotReportToolBrief(
              withCoordinatedReportBrief(started, input.run, input.child),
              input.run,
              host.db
            )
          : withCoordinatedReportBrief(started, input.run, input.child),
        params: {
          task: input.taskId,
          worktree: selector,
          agent,
          model: plan.workerStart.model ?? undefined,
          effort: plan.workerStart.effort ?? undefined,
          timeoutMs: plan.workerStart.timeoutMs
        },
        systemCoordinator: {
          kind: 'coordinated_run',
          runId: binding.orchestrationRunId,
          assertCurrent: check
        },
        requestedWorktree: selector,
        creationTarget: undefined,
        resolvedWorktree: {
          id: resolvedWorktree.id,
          repoId: scope.folderWorkspace
            ? folderWorkspaceRepoId(scope.folderWorkspace.projectGroupId)
            : resolvedWorktree.repoId
        },
        mode: {
          mode: 'terminal',
          preferred: 'terminal',
          reason: 'requested',
          detail: 'Host-admitted coordinated provider execution on the frozen terminal surface.'
        },
        agent,
        launch,
        chat: null,
        terminal: undefined,
        orchestrationMutation: undefined,
        recordStart: () => {},
        followUp: undefined
      })
    }
  }
}
