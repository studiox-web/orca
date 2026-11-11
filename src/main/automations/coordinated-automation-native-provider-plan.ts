import type { TuiAgent } from '../../shared/tui-agent'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { parseWorkspaceKey } from '../../shared/workspace-scope'

/**
 * Guarded source for running coordinated children on normal providers. Nothing here launches:
 * this module only translates one frozen child launch configuration into the exact inputs the
 * existing worker start already takes, or refuses. No host, capability string or RPC payload
 * installs it; execution needs a separate, explicit authorization that no source grants yet.
 */
export const COORDINATED_NATIVE_PROVIDER_CAPABILITY = 'coordinated_native_provider_runs_v1'

/** Where a frozen workspace actually lives, as its owning host proves it — never a guessed path. */
export type CoordinatedNativeWorkspaceAuthority =
  | { kind: 'local_worktree' }
  | { kind: 'local_folder' }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'wsl' }
  | { kind: 'remote_host'; hostId: string }
  | { kind: 'archived' }
  | { kind: 'missing' }

/** Facts the host reads from its own environment and Store; never taken from a caller. */
export type CoordinatedNativeProviderHostFacts = Readonly<{
  hostKind: 'local_desktop' | 'headless_daemon' | 'remote_server' | 'mobile_client'
  workspaceAuthority: (workspaceId: string) => CoordinatedNativeWorkspaceAuthority
  /** Whether this host can launch exactly this agent/model/effort; never offers a substitute. */
  launchSupport: (launch: {
    agent: TuiAgent
    model: string | null
    reasoningEffort: string | null
  }) => { supported: true } | { supported: false; reason: string }
}>

export type CoordinatedNativeProviderRefusalCode =
  | 'host_not_local_desktop'
  | 'target_not_local'
  | 'external_effects'
  | 'surface_unsupported'
  | 'session_reuse_unsupported'
  | 'extra_args_unsupported'
  | 'workspace_mode_unsupported'
  | 'workspace_unresolved'
  | 'workspace_not_local'
  | 'launch_unsupported'

/** The exact existing worker-start inputs for one frozen child; every value is the frozen one. */
export type CoordinatedNativeProviderLaunchPlan = Readonly<{
  capability: typeof COORDINATED_NATIVE_PROVIDER_CAPABILITY
  childDefinitionId: string
  workspaceKind: 'local_worktree' | 'local_folder'
  workerStart: Readonly<{
    task: string
    worktree: string
    agent: TuiAgent
    model: string | null
    effort: string | null
    setup: 'run' | 'skip' | 'inherit'
    timeoutMs: number
  }>
}>

export type CoordinatedNativeProviderPlanning =
  | { kind: 'planned'; plan: CoordinatedNativeProviderLaunchPlan }
  | { kind: 'refused'; code: CoordinatedNativeProviderRefusalCode; reason: string }

function refuse(
  code: CoordinatedNativeProviderRefusalCode,
  reason: string
): CoordinatedNativeProviderPlanning {
  return { kind: 'refused', code, reason }
}

export function planCoordinatedNativeProviderLaunch(input: {
  snapshot: ResolvedAutomationRunSnapshot
  child: ResolvedChildSnapshot
  taskId: string
  host: CoordinatedNativeProviderHostFacts
}): CoordinatedNativeProviderPlanning {
  const { snapshot, child, host } = input
  const config = child.launchConfig
  const id = child.childDefinitionId
  if (host.hostKind !== 'local_desktop') {
    return refuse(
      'host_not_local_desktop',
      `A ${host.hostKind} host cannot prove local operator custody of a coordinated worker.`
    )
  }
  if (snapshot.executionTarget.type !== 'local') {
    return refuse(
      'target_not_local',
      `This run was frozen for ${snapshot.executionTarget.type}:${snapshot.executionTarget.id}; only its owning host may execute it.`
    )
  }
  if (
    snapshot.publicationPolicy.allowExternalMutation ||
    (child.stageAcceptance?.requiredEffects?.length ?? 0) > 0
  ) {
    return refuse(
      'external_effects',
      `Child "${id}" may mutate external state; no real effect authority exists for provider runs.`
    )
  }
  if (config.surface !== 'terminal') {
    return refuse(
      'surface_unsupported',
      `Child "${id}" is frozen to the ${config.surface} surface; only terminal workers report through the authenticated worker path.`
    )
  }
  if (config.reuseSession) {
    return refuse(
      'session_reuse_unsupported',
      `Child "${id}" is frozen to reuse a session; a coordinated attempt owns exactly one fresh process.`
    )
  }
  if (config.extraAgentArgs !== '') {
    return refuse(
      'extra_args_unsupported',
      `Child "${id}" freezes extra agent arguments the worker start cannot carry; they are never dropped.`
    )
  }
  if (config.workspaceMode !== 'existing') {
    return refuse(
      'workspace_mode_unsupported',
      `Child "${id}" is frozen to create a workspace per run; that creation is not wired to coordinated runs.`
    )
  }
  if (!config.workspaceId || !parseWorkspaceKey(config.workspaceId)) {
    return refuse('workspace_unresolved', `Child "${id}" names no exact frozen workspace.`)
  }
  const authority = host.workspaceAuthority(config.workspaceId)
  if (authority.kind === 'missing' || authority.kind === 'archived') {
    return refuse(
      'workspace_unresolved',
      `Frozen workspace ${config.workspaceId} is ${authority.kind}; no other workspace is substituted.`
    )
  }
  if (authority.kind !== 'local_worktree' && authority.kind !== 'local_folder') {
    return refuse(
      'workspace_not_local',
      `Frozen workspace ${config.workspaceId} belongs to ${authority.kind} authority, not this local host.`
    )
  }
  const support = host.launchSupport({
    agent: config.agentId,
    model: config.model,
    reasoningEffort: config.reasoningEffort
  })
  if (!support.supported) {
    return refuse(
      'launch_unsupported',
      `Child "${id}" cannot launch as frozen (${support.reason}); no model, effort or provider is substituted.`
    )
  }
  return {
    kind: 'planned',
    plan: Object.freeze({
      capability: COORDINATED_NATIVE_PROVIDER_CAPABILITY,
      childDefinitionId: id,
      workspaceKind: authority.kind,
      workerStart: Object.freeze({
        task: input.taskId,
        worktree: `id:${config.workspaceId}`,
        agent: config.agentId,
        model: config.model,
        effort: config.reasoningEffort,
        setup: config.setupDecision,
        timeoutMs: config.timeoutSeconds * 1000
      })
    })
  }
}

export const COORDINATED_NATIVE_PROVIDER_EXECUTION_REFUSAL =
  'coordinated_native_provider_execution_not_authorized: a valid launch plan exists, but real provider execution for coordinated runs has no admitted host and stays off.'
