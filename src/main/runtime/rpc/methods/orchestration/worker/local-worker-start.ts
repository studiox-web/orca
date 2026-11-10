import { launchPreparedWorkerDispatch } from './prepared-worker-dispatch-launch'
import { createLocalWorkerStartDispatch } from './local-worker-start-dispatch'
import { probeWorkerOpenCodeModelLaunchSupport } from './worker-opencode-model-preflight'
import { resolveWorkerConfiguredAgentParams } from './worker-configured-agent-preflight'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { DispatchContextRow, RunRow, TaskRow } from '../../../../orchestration/types'
import type {
  OrchestrationCallerIdentity,
  OrchestrationSessionCaller
} from '../../../../orchestration/orchestration-caller-identity'
import { resolveDispatchCallerWorktreeId } from '../../orchestration-caller-workspace'
import {
  resolveWorkerStartModeOnHost,
  type WorkerStartModeReceipt
} from '../../orchestration-worker-start-mode'
import type { placeWorkerAgent } from './worker-start-agent-placement'
import { assertOrchestrationWorktreeCreationSupported } from './folder-worktree-placement'
import { resolveWorkerWorktreeCreationTarget } from './worker-worktree-creation'
import type { WorkerStartInput } from './worker-start-schema'
import { assertExplicitWorkerUsable } from './explicit-worker-terminal-validation'
import { resolveDispatchAssigneeParty } from '../../../../orchestration/orchestration-party'
import { chatAssigneeOf, chatWorkerMode } from '../chat-assignee-admission'
import { releaseRetriedWorkerTerminal } from './retried-worker-terminal-release'
import { prepareLocalWorkerStart } from './worker-start-validation'
import type { WorkerStartMutation } from './worker-start-mutation'
import { prepareWorkerStartCard } from '../../../../orchestration/worker-start-card'
import type { WorkerFollowUp } from './worker-follow-up-placement'

export async function startLocalWorker(args: {
  params: WorkerStartInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  /** Called only once effect-free validation passes, so a refused start binds no new Run. */
  bindRun: () => RunRow
  taskDeps: string[] | undefined
  coordinator: OrchestrationCallerIdentity | null
  callerSession?: OrchestrationSessionCaller
  existingTask?: TaskRow
  orchestrationMutation?: WorkerStartMutation
  /** Settings-driven; the executing host still gets to refuse below. */
  mode: WorkerStartModeReceipt
  /** Set when a worker starts its own helper; the helper reports to this Dispatch. */
  helperCreator?: DispatchContextRow
  followUp?: WorkerFollowUp
}): Promise<unknown> {
  const { runtime, db, coordinator, callerSession, orchestrationMutation } = args
  const recordStart = prepareWorkerStartCard(runtime, callerSession)
  // `--terminal` names a party: a chat by its `/clear` root address, as its Dispatch does.
  const terminal = args.params.terminal && resolveDispatchAssigneeParty(args.params.terminal, db)
  const params = terminal ? { ...args.params, terminal: terminal.address } : args.params
  const chat = terminal ? chatAssigneeOf(terminal) : null
  const requestedWorktree = params.worktree ?? 'current'
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const creationTargetFor = (callerWorktreeId: string) =>
    resolveWorkerWorktreeCreationTarget({
      runtime,
      requestedWorktree,
      repo: params.repo,
      callerWorktreeId
    })
  const launchParams = await resolveWorkerConfiguredAgentParams(runtime, params, async () => {
    const callerWorkspaceId = await resolveDispatchCallerWorktreeId(
      runtime,
      params.from,
      callerSession
    )
    return createsWorktree
      ? { repo: (await creationTargetFor(callerWorkspaceId)).repoSelector }
      : {
          worktree: requestedWorktree === 'current' ? `id:${callerWorkspaceId}` : requestedWorktree
        }
  })
  let openCodeModelLaunchSupported = false
  if (!createsWorktree && launchParams.agent === 'opencode' && launchParams.model) {
    const callerWorkspaceId = await resolveDispatchCallerWorktreeId(
      runtime,
      params.from,
      callerSession
    )
    openCodeModelLaunchSupported = await probeWorkerOpenCodeModelLaunchSupport(
      runtime,
      launchParams,
      { worktree: requestedWorktree === 'current' ? `id:${callerWorkspaceId}` : requestedWorktree }
    )
  }

  const { agent, launch } = prepareLocalWorkerStart({
    params: launchParams,
    createsWorktree,
    runtime,
    openCodeModelLaunchSupported
  })

  const coordinatorWorktreeId = await resolveDispatchCallerWorktreeId(
    runtime,
    params.from,
    callerSession
  )
  const creationTarget = createsWorktree
    ? await creationTargetFor(coordinatorWorktreeId)
    : undefined
  if (creationTarget) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: creationTarget.repoSelector,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  const resolvedWorktree: Awaited<ReturnType<typeof placeWorkerAgent>>['worktree'] | undefined =
    creationTarget
      ? undefined
      : requestedWorktree === 'current'
        ? await runtime.showManagedTerminalWorkspace(`id:${coordinatorWorktreeId}`)
        : await runtime.showManagedTerminalWorkspace(requestedWorktree)
  if (terminal) {
    await assertExplicitWorkerUsable({
      runtime,
      db,
      terminal,
      from: params.from,
      coordinator,
      resolvedWorktreeId: resolvedWorktree?.id
    })
  }
  const hostMode = resolveWorkerStartModeOnHost(runtime, args.mode, resolvedWorktree?.id, agent)
  const mode = chatWorkerMode(await hostMode, chat)

  const run = args.bindRun()
  const started = createLocalWorkerStartDispatch(args, {
    params,
    run,
    requestedWorktree,
    createsWorktree,
    mode,
    resolvedWorktreeId: resolvedWorktree?.id,
    repoSelector: creationTarget?.repoSelector,
    agent,
    launchReceipt: launch.receipt
  })
  releaseRetriedWorkerTerminal(runtime, db, params)
  return launchPreparedWorkerDispatch({
    runtime,
    db,
    params,
    run,
    started,
    requestedWorktree,
    creationTarget,
    resolvedWorktree,
    mode,
    agent,
    launch,
    chat,
    terminal,
    orchestrationMutation,
    recordStart,
    followUp: args.followUp
  })
}
