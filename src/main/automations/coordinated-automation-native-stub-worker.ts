import type { AutomationRun } from '../../shared/automations-types'
import { computeSnapshotCanonicalDigest } from '../../shared/coordinated-automation-snapshot'
import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'
import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import {
  assertNativeStubComposition,
  requireNativeStubLaunch,
  type NativeStubSessionTestComposition,
  type PreparedNativeStubLaunch
} from '../runtime/native-stub-session-test-host'
import { observeNativeStubPhysicalSpawn } from '../runtime/native-stub-physical-spawn'
import { beginNativeStubFixtureObservation } from '../runtime/native-stub-fixture-protocol'
import { launchPreparedWorkerDispatch } from '../runtime/rpc/methods/orchestration/worker/prepared-worker-dispatch-launch'
import { folderWorkspaceRepoId } from '../../shared/folder-workspace-worktree'
import { ROOT_DISPATCH_DEPTH } from '../../shared/nested-worker-depth'
import { withCoordinatedReportBrief } from './coordinated-automation-report-brief'
import { coordinatedMappingProblem } from './coordinated-automation-native-validation'
import { LOCAL_SELF_OWNER, runScopeRefusal } from './coordinated-automation-run-host-gate'
import {
  NATIVE_STUB_ATTEMPT,
  nativeAttemptBindingProblem,
  type CoordinatedNativeAttemptBinding
} from './coordinated-automation-native-attempt'
import type { CoordinatedRecoveryContext } from './coordinated-automation-recovery-context'

export type CoordinatedNativeStubWorker = Readonly<{ kind: typeof NATIVE_STUB_ATTEMPT }>
export type NativeStubWorkerHost = {
  runtime: OrcaRuntimeService
  store: Store
  db: OrchestrationDb
  composition: NativeStubSessionTestComposition
}
const hosts = new WeakMap<CoordinatedNativeStubWorker, NativeStubWorkerHost>()
const lanes = new WeakMap<OrchestrationDb, Map<string, Promise<void>>>()

/** Process-local admission only; neither a capability string nor an RPC payload installs a host. */
export function createCoordinatedNativeStubWorker(
  input: NativeStubWorkerHost
): CoordinatedNativeStubWorker {
  assertNativeStubComposition(input.composition, input.runtime, input.store)
  if (input.runtime.getOrchestrationDb() !== input.db) {
    throw new Error('native_stub_database_mismatch')
  }
  const worker = Object.freeze({ kind: NATIVE_STUB_ATTEMPT })
  hosts.set(worker, input)
  return worker
}

export function inNativeStubDispatchLane<T>(
  db: OrchestrationDb,
  taskId: string,
  operation: () => Promise<T>
): Promise<T> {
  let queue = lanes.get(db)
  if (!queue) {
    queue = new Map()
    lanes.set(db, queue)
  }
  return runKeyedSerializedOperation(queue, taskId, operation)
}

/** Non-throwing liveness for host lifetime gates; a revoked or re-bound composition reads inactive. */
export function coordinatedNativeStubHostIsActive(
  worker: CoordinatedNativeStubWorker | undefined
): boolean {
  if (!worker) {
    return true
  }
  const host = hosts.get(worker)
  if (!host) {
    return false
  }
  try {
    assertNativeStubComposition(host.composition, host.runtime, host.store)
    return host.runtime.getOrchestrationDb() === host.db
  } catch {
    return false
  }
}

/** Stop-path host resolution; shared with the native stop authority module. */
export function resolveActiveNativeStubHost(
  worker: CoordinatedNativeStubWorker
): NativeStubWorkerHost {
  const host = hosts.get(worker)
  if (!host) {
    throw new Error('coordinated_native_stub_host_refused')
  }
  assertNativeStubComposition(host.composition, host.runtime, host.store)
  if (host.runtime.getOrchestrationDb() !== host.db) {
    throw new Error('coordinated_native_stub_host_changed')
  }
  return host
}

function readHost(ctx: CoordinatedRecoveryContext): NativeStubWorkerHost {
  const host = ctx.nativeStubWorker && hosts.get(ctx.nativeStubWorker)
  if (!host || host.store !== ctx.store || host.db !== ctx.orchestrationDb || ctx.effectAdapter) {
    throw new Error('coordinated_native_stub_host_refused')
  }
  assertNativeStubComposition(host.composition, host.runtime, host.store)
  if (host.runtime.getOrchestrationDb() !== host.db || !ctx.isActive()) {
    throw new Error('coordinated_native_stub_host_changed')
  }
  return host
}

function validateFrozenLaunch(child: ResolvedChildSnapshot, run: AutomationRun): string {
  const config = child.launchConfig
  if (
    config.agentId !== 'codex' ||
    config.model !== null ||
    config.reasoningEffort !== null ||
    config.surface !== 'terminal' ||
    config.extraAgentArgs !== '' ||
    config.reuseSession ||
    config.workspaceMode !== 'existing' ||
    !config.workspaceId?.startsWith('folder:') ||
    config.baseBranch !== null ||
    config.setupDecision !== 'skip' ||
    config.maxRetries !== 0 ||
    config.maxReviewIterations !== 0 ||
    child.mutationClass !== 'read_only' ||
    run.resolvedSnapshot?.publicationPolicy.allowExternalMutation ||
    (child.stageAcceptance?.requiredEffects?.length ?? 0) > 0
  ) {
    throw new Error('coordinated_native_stub_frozen_launch_unsupported')
  }
  return config.workspaceId
}

export async function prepareCoordinatedNativeStubAttempt(
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
  launch: (started: ReturnType<OrchestrationDb['createStartingWorkerDispatch']>) => Promise<unknown>
}> {
  const host = readHost(ctx)
  const snapshot = input.run.resolvedSnapshot!
  const identity = assertNativeStubComposition(host.composition, host.runtime, host.store)
  const workspaceId = validateFrozenLaunch(input.child, input.run)
  const assertCurrent = () => {
    input.assertCurrent?.()
    readHost(ctx)
    if (input.deadlineAt !== undefined && ctx.clock.now() >= input.deadlineAt) {
      throw new Error('coordinated_native_stub_deadline_elapsed')
    }
    const current = host.store.listAutomationRuns().find((r) => r.id === input.run.id)
    // The run's FROZEN scope is the authority here; later definition edits for future runs neither
    // redirect nor strand this run, while archive/owner/target revocation still refuses.
    const refusal = runScopeRefusal(host.store, {
      automationId: input.run.automationId,
      automationRunId: input.run.id,
      expectedOwner: LOCAL_SELF_OWNER
    })
    if (
      refusal ||
      !current?.resolvedSnapshot ||
      current.completionReceipt ||
      current.automationId !== snapshot.automationId ||
      current.status === 'completed' ||
      computeSnapshotCanonicalDigest(current.resolvedSnapshot) !== snapshot.canonicalDigest ||
      current.resolvedSnapshot.canonicalDigest !== snapshot.canonicalDigest ||
      current.orchestrationRunId !== input.run.orchestrationRunId ||
      coordinatedMappingProblem(host.db, current, current.resolvedSnapshot)
    ) {
      throw new Error(refusal ?? 'coordinated_native_stub_identity_changed')
    }
    const mapping = current.childMappings?.find(
      (m) => m.childDefinitionId === input.child.childDefinitionId
    )
    if (mapping?.taskId !== input.taskId) {
      throw new Error('coordinated_native_stub_task_mismatch')
    }
  }
  assertCurrent()
  const permit: PreparedNativeStubLaunch = await host.composition.prepare(
    host.runtime,
    `id:${workspaceId}`
  )
  assertCurrent()
  const workspace = requireNativeStubLaunch(permit, host.runtime).workspace
  const binding: CoordinatedNativeAttemptBinding = {
    kind: NATIVE_STUB_ATTEMPT,
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
    workspaceId,
    retryOfDispatchId: input.retryOfDispatchId ?? null
  }
  return {
    binding,
    async launch(started) {
      const dispatchId = started.dispatch.id
      if (started.dispatch.depth > ROOT_DISPATCH_DEPTH + 1) {
        throw new Error('coordinated_native_stub_nested_refused')
      }
      const check = () => {
        assertCurrent()
        const current = host.store.listAutomationRuns().find((r) => r.id === input.run.id)!
        const problem = nativeAttemptBindingProblem(host.db, current, dispatchId)
        if (problem) {
          throw new Error(problem)
        }
      }
      check()
      observeNativeStubPhysicalSpawn(
        permit,
        (physical) => {
          // The launch was admitted before spawn; retain custody even when revocation raced its reply.
          if (
            physical.workspaceId !== workspaceId ||
            physical.runtimeGeneration !== identity.generation
          ) {
            throw new Error('coordinated_native_stub_physical_identity_changed')
          }
          // Observe before the stub's first render so its own readiness markers cannot be missed.
          beginNativeStubFixtureObservation(permit, host.runtime, physical)
          host.db.recordCreatedWorkerTerminalCustody({
            dispatchId,
            handle: physical.handle,
            paneKey: physical.paneKey,
            processIncarnation: `${physical.ptyId}:${physical.incarnationId}`,
            worktreeId: workspaceId,
            hostScope: JSON.stringify({ kind: 'local', hostId: 'local' })
          })
        },
        check
      )
      return launchPreparedWorkerDispatch({
        preparedNativeStub: permit,
        runtime: host.runtime,
        db: host.db,
        run: host.db.getRun(binding.orchestrationRunId)!,
        started: withCoordinatedReportBrief(started, input.run, input.child),
        params: {
          task: input.taskId,
          worktree: `id:${workspaceId}`,
          agent: 'codex',
          timeoutMs: input.child.launchConfig.timeoutSeconds * 1000
        },
        systemCoordinator: {
          kind: 'coordinated_run',
          runId: binding.orchestrationRunId,
          assertCurrent: check
        },
        requestedWorktree: `id:${workspaceId}`,
        creationTarget: undefined,
        resolvedWorktree: {
          id: workspace.id,
          repoId: folderWorkspaceRepoId(workspace.folderWorkspace!.projectGroupId)
        },
        mode: {
          mode: 'terminal',
          preferred: 'terminal',
          reason: 'requested',
          detail: 'Host-admitted pinned native stub session test; no real agent execution.'
        },
        agent: 'codex',
        launch: {
          preferences: undefined,
          receipt: { requested: { agent: 'codex', model: null, effort: null }, effective: null }
        },
        chat: null,
        terminal: undefined,
        orchestrationMutation: undefined,
        recordStart: () => {},
        followUp: undefined
      })
    }
  }
}
