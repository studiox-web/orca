import { splitWorktreeId } from '../../shared/worktree/id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import {
  resolveLocalLaunchScopeRuntime,
  resolveLocalWorkspaceRuntime
} from '../local-project-runtime-resolution'
import type { Store } from '../persistence/loading-store/store'
import {
  assertNativeProviderExecutionAdmission,
  type NativeProviderExecutionAdmission
} from '../runtime/native-provider-execution-admission'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { prepareLocalWorkerStart } from '../runtime/rpc/methods/orchestration/worker/worker-start-validation'
import { resolveWorktreeLaunchHost } from '../runtime/worktree-launch-host-repo'
import type {
  CoordinatedNativeProviderHostFacts,
  CoordinatedNativeProviderLaunchPlan,
  CoordinatedNativeWorkspaceAuthority
} from './coordinated-automation-native-provider-plan'
import { CoordinatedAutomationLaunchRefusedError } from './coordinated-automation-materialization'

export type NativeProviderWorkerHost = {
  runtime: OrcaRuntimeService
  store: Store
  db: OrchestrationDb
  admission: NativeProviderExecutionAdmission
}

function remoteWorkspaceAuthority(
  hostId: string | null | undefined
): CoordinatedNativeWorkspaceAuthority | null {
  if (!hostId || hostId === 'local') {
    return null
  }
  if (hostId.startsWith('ssh:')) {
    return { kind: 'ssh', connectionId: hostId.slice(4) }
  }
  return { kind: 'remote_host', hostId }
}

function workspaceAuthority(
  store: Store,
  workspaceId: string
): CoordinatedNativeWorkspaceAuthority {
  const key = parseWorkspaceKey(workspaceId)
  if (key?.type === 'folder') {
    const folder = store.getFolderWorkspace(key.folderWorkspaceId)
    if (!folder) {
      return { kind: 'missing' }
    }
    if (folder.isArchived) {
      return { kind: 'archived' }
    }
    const remote = remoteWorkspaceAuthority(folder.executionHostId)
    if (folder.connectionId) {
      return { kind: 'ssh', connectionId: folder.connectionId }
    }
    if (remote) {
      return remote
    }
    const group = store.getProjectGroups().find((entry) => entry.id === folder.projectGroupId)
    if (!group || group.connectionId) {
      return { kind: 'missing' }
    }
    const runtime = resolveLocalLaunchScopeRuntime(store, {
      id: workspaceId,
      path: folder.folderPath,
      connectionId: null,
      repo: null,
      folderWorkspace: folder
    })
    if (runtime && runtime.status !== 'resolved') {
      return { kind: 'missing' }
    }
    return runtime?.status === 'resolved' && runtime.runtime.kind === 'wsl'
      ? { kind: 'wsl' }
      : { kind: 'local_folder' }
  }
  if (key?.type !== 'worktree') {
    return { kind: 'missing' }
  }
  const parsed = splitWorktreeId(key.worktreeId)
  const metadata = store.getWorktreeMeta(key.worktreeId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  if (!parsed || !metadata || !repo) {
    return { kind: 'missing' }
  }
  if (metadata.isArchived) {
    return { kind: 'archived' }
  }
  const resolution = resolveWorktreeLaunchHost(store.getRepos(), {
    repoId: parsed.repoId,
    hostId: metadata.hostId
  })
  if (resolution.kind === 'ambiguous') {
    return { kind: 'missing' }
  }
  if (resolution.connectionId) {
    return { kind: 'ssh', connectionId: resolution.connectionId }
  }
  const remote = remoteWorkspaceAuthority(repo.executionHostId)
  if (remote) {
    return remote
  }
  const runtime = resolveLocalWorkspaceRuntime(store, repo, parsed.worktreePath)
  if (runtime && runtime.status !== 'resolved') {
    return { kind: 'missing' }
  }
  return runtime?.status === 'resolved' && runtime.runtime.kind === 'wsl'
    ? { kind: 'wsl' }
    : { kind: 'local_worktree' }
}

export function nativeProviderHostFacts(
  host: NativeProviderWorkerHost
): CoordinatedNativeProviderHostFacts {
  const identity = assertNativeProviderExecutionAdmission(host.admission, host.runtime, host.store)
  return {
    hostKind: identity.hostKind,
    workspaceAuthority: (workspaceId) => workspaceAuthority(host.store, workspaceId),
    launchSupport(launch) {
      try {
        if (host.store.getSettings().agentCmdOverrides?.[launch.agent]) {
          return { supported: false, reason: 'custom command overrides are not frozen by this run' }
        }
        if (host.runtime.resolveOrchestrationAgentLauncher(launch.agent) !== launch.agent) {
          return { supported: false, reason: 'the agent launcher resolves to another provider' }
        }
        const prepared = prepareLocalWorkerStart({
          runtime: host.runtime,
          createsWorktree: false,
          params: {
            task: 'native_provider_preflight',
            worktree: 'current',
            agent: launch.agent,
            model: launch.model ?? undefined,
            effort: launch.reasoningEffort ?? undefined
          }
        })
        const requested = prepared.launch.receipt.requested
        return prepared.agent === launch.agent &&
          requested.agent === launch.agent &&
          requested.model === launch.model &&
          requested.effort === launch.reasoningEffort
          ? { supported: true }
          : { supported: false, reason: 'worker start changed the frozen launch selection' }
      } catch (error) {
        return { supported: false, reason: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}

export function validateNativeProviderWorkspace(
  host: NativeProviderWorkerHost,
  plan: CoordinatedNativeProviderLaunchPlan,
  scope: {
    id: string
    connectionId: string | null
    path: string
    repo: { id: string } | null
    folderWorkspace: { projectGroupId: string } | null
  }
): void {
  const authority = workspaceAuthority(host.store, plan.workerStart.worktree.slice(3))
  const key = parseWorkspaceKey(scope.id)
  const currentPath =
    key?.type === 'folder'
      ? host.store.getFolderWorkspace(key.folderWorkspaceId)?.folderPath
      : key?.type === 'worktree'
        ? splitWorktreeId(key.worktreeId)?.worktreePath
        : undefined
  const resolution = resolveLocalLaunchScopeRuntime(host.store, {
    ...scope,
    repo: host.store.getRepo(scope.repo?.id ?? '') ?? null,
    folderWorkspace: scope.folderWorkspace
      ? (host.store.getFolderWorkspace(scope.id.replace(/^folder:/, '')) ?? null)
      : null
  })
  if (
    authority.kind !== plan.workspaceKind ||
    currentPath !== scope.path ||
    scope.id !== plan.workerStart.worktree.slice(3) ||
    scope.connectionId ||
    (resolution?.status === 'resolved' && resolution.runtime.kind === 'wsl')
  ) {
    throw new CoordinatedAutomationLaunchRefusedError(
      'workspace_not_local: workspace authority changed.'
    )
  }
}
