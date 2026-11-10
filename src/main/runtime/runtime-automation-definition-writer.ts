import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../shared/automations-types'
import type {
  AutomationDestination,
  AutomationUpdatePreconditions
} from '../../shared/automation-owner-precondition'
import type { Repo } from '../../shared/repo-types'
import { parseExecutionHostId } from '../../shared/execution-host'
import { hostQualifiedRepoSelector } from './runtime-repo-selector'
import type { RuntimeStore } from './runtime-store-contract'
import { hasRuntimeAutomationUpdateValue } from './runtime-automation-update-value'
import {
  assertAutomationRunContextMatchesTarget,
  type RuntimeAutomationTargetResolvers,
  type RuntimeAutomationTargetInput,
  type RuntimeAutomationCreateInput,
  type RuntimeAutomationUpdateInput
} from './runtime-automation-run-context'

export class RuntimeAutomationDefinitionWriter {
  constructor(
    private readonly store: RuntimeStore | null,
    private readonly resolvers: RuntimeAutomationTargetResolvers
  ) {}

  async create(
    input: RuntimeAutomationCreateInput,
    write: (
      input: AutomationCreateInput,
      options: { destination?: AutomationDestination; resolvedRepo?: Repo }
    ) => Automation,
    destination?: AutomationDestination
  ): Promise<Automation> {
    const target = await this.resolveTarget(input)
    assertAutomationRunContextMatchesTarget(input.runContext, target.repo)
    if (input.reuseSession && target.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    const automation = write(
      {
        creationKey: input.creationKey,
        name: input.name,
        prompt: input.prompt,
        precheck: input.precheck,
        agentId: input.agentId,
        extraAgentArgs: input.extraAgentArgs,
        launchSetupPatch: input.launchSetupPatch,
        runContext: input.runContext,
        sourceContext: input.sourceContext,
        projectId: target.projectId,
        workspaceMode: target.workspaceMode,
        workspaceId: target.workspaceId,
        baseBranch: input.baseBranch,
        setupDecision: input.setupDecision,
        reuseSession: input.reuseSession,
        timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        rrule: input.rrule,
        dtstart: input.dtstart,
        enabled: input.enabled,
        missedRunGraceMinutes: input.missedRunGraceMinutes
      },
      { destination: destination ?? input.destination, resolvedRepo: target.repo ?? undefined }
    )
    await this.store?.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return automation
  }

  async update(
    current: Automation,
    updates: RuntimeAutomationUpdateInput,
    options: AutomationUpdatePreconditions | undefined,
    write: (
      patch: AutomationUpdateInput,
      options: AutomationUpdatePreconditions & { resolvedRepo?: Repo }
    ) => Automation
  ): Promise<Automation> {
    const patch: AutomationUpdateInput = {}
    this.copyPatchValues(updates, patch)
    const targetChanged =
      hasRuntimeAutomationUpdateValue(updates, 'repo') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspace') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspaceMode')
    let resolvedRepo: Repo | undefined
    if (targetChanged) {
      const target = await this.resolveTarget(updates, current)
      resolvedRepo = target.repo ?? undefined
      assertAutomationRunContextMatchesTarget(updates.runContext, target.repo)
      if (patch.reuseSession === true && target.workspaceMode !== 'existing') {
        throw new Error('Session reuse requires an existing workspace target.')
      }
      patch.projectId = target.projectId
      patch.workspaceMode = target.workspaceMode
      patch.workspaceId = target.workspaceId
      if (target.workspaceMode !== 'existing') {
        patch.reuseSession = false
      }
    }
    if (
      !targetChanged &&
      hasRuntimeAutomationUpdateValue(updates, 'runContext') &&
      current.projectId
    ) {
      const host = parseExecutionHostId(updates.runContext?.hostId ?? current.runContext?.hostId)
      const repo = await this.resolvers.showRepo(
        hostQualifiedRepoSelector(
          `id:${current.projectId}`,
          host?.kind === 'runtime' ? 'local' : host?.id
        )
      )
      assertAutomationRunContextMatchesTarget(updates.runContext, repo)
    }
    if (!targetChanged && patch.reuseSession && current.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    const automation = write(patch, { ...options, resolvedRepo })
    await this.store?.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return automation
  }

  private copyPatchValues(
    updates: RuntimeAutomationUpdateInput,
    patch: AutomationUpdateInput
  ): void {
    const keys = [
      'name',
      'prompt',
      'precheck',
      'agentId',
      'extraAgentArgs',
      'launchSetupPatch',
      'runContext',
      'sourceContext',
      'baseBranch',
      'setupDecision',
      'reuseSession',
      'timezone',
      'rrule',
      'dtstart',
      'enabled',
      'missedRunGraceMinutes'
    ] as const
    for (const key of keys) {
      if (hasRuntimeAutomationUpdateValue(updates, key)) {
        Object.assign(patch, { [key]: updates[key] })
      }
    }
  }
  private async resolveTarget(
    input: RuntimeAutomationTargetInput,
    current?: Automation
  ): Promise<{
    projectId: string
    workspaceMode: Automation['workspaceMode']
    workspaceId?: string | null
    repo: Repo | null
  }> {
    const hasRepo = input.repo !== undefined
    const hasWorkspace = input.workspace !== undefined
    if (
      current?.workspaceMode === 'existing' &&
      hasRepo &&
      !hasWorkspace &&
      input.workspaceMode !== 'new_per_run'
    ) {
      throw new Error(
        'Repo updates for existing-workspace automation require workspaceMode new_per_run.'
      )
    }
    const contextHost = parseExecutionHostId(
      input.runContext?.hostId ??
        (!input.repo && !input.workspace ? current?.runContext?.hostId : undefined)
    )
    const hostId = contextHost?.kind === 'runtime' ? 'local' : contextHost?.id
    const workspace = input.workspace
      ? await this.resolvers.showManagedWorktree(input.workspace, hostId)
      : null
    const repoSelector =
      input.repo ??
      (workspace?.repoId
        ? `id:${workspace.repoId}`
        : current?.projectId
          ? `id:${current.projectId}`
          : null)
    const repo = repoSelector
      ? await this.resolvers.showRepo(
          hostQualifiedRepoSelector(repoSelector, hostId ?? workspace?.hostId)
        )
      : null
    const workspaceMode =
      input.workspaceMode ??
      (workspace
        ? 'existing'
        : input.repo && !current
          ? 'new_per_run'
          : (current?.workspaceMode ?? 'new_per_run'))
    if (workspaceMode === 'existing') {
      const workspaceId = workspace?.id ?? current?.workspaceId
      const projectId = workspace?.repoId ?? current?.projectId
      if (repo && repo.id !== projectId) {
        throw new Error('Selected workspace belongs to a different repo.')
      }
      if (!workspaceId || !projectId) {
        throw new Error('Existing-workspace automation requires --workspace.')
      }
      return { projectId, workspaceMode, workspaceId, repo }
    }
    const projectId = repo?.id ?? workspace?.repoId ?? current?.projectId
    if (!projectId) {
      throw new Error('Automation requires --repo or --workspace.')
    }
    return { projectId, workspaceMode: 'new_per_run', workspaceId: null, repo }
  }
}
