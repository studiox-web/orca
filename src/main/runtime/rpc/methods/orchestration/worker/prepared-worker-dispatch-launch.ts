import type { PreparedNativeStubLaunch } from '../../../../native-stub-session-test-host'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { RunRow } from '../../../../orchestration/types'
import type { WorkerStartModeReceipt } from '../../orchestration-worker-start-mode'
import type { WorkerStartInput } from './worker-start-schema'
import type { prepareLocalWorkerStart } from './worker-start-validation'
import type { prepareWorkerStartCard } from '../../../../orchestration/worker-start-card'
import type { WorkerWorktreeCreationTarget } from './worker-worktree-creation'
import { waitForWorkerAgentReady } from '../../../../launched-agent-composer-readiness'
import { describeTerminalWaitBlockedReason } from '../../../../../../shared/terminal-wait-blocked-reason-legacy-alias'
import { EXISTING_WORKTREE_SETUP, placeWorkerAgent } from './worker-start-agent-placement'
import { awaitStructuredWorkerSetupGate } from './worker-start-structured-setup-gate'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './worker-setup-gate'
import { failWorkerStartWithReceipt } from './worker-start-receipt'
import { recordCreatedWorkerTerminalCustody } from './created-worker-terminal-custody'
import { requireWorkerAuthority, type WorkerEffect } from './worker-topology'
import { deliverAndSettleWorkerStartReadiness } from './worker-start-readiness-settlement'
import type { WorkerStartMutation } from './worker-start-mutation'
import { rebindReusedStructuredWorker } from '../../orchestration-structured-worker-session'
import { placedWorkerParty, type WorkerFollowUp } from './worker-follow-up-placement'

type PreparedWorkerDispatchLaunch = {
  preparedNativeStub?: PreparedNativeStubLaunch
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  params: WorkerStartInput
  run: RunRow
  started: ReturnType<OrchestrationDb['createStartingWorkerDispatch']>
  requestedWorktree: string
  creationTarget: WorkerWorktreeCreationTarget | undefined
  resolvedWorktree: Awaited<ReturnType<typeof placeWorkerAgent>>['worktree'] | undefined
  mode: WorkerStartModeReceipt
  agent: ReturnType<typeof prepareLocalWorkerStart>['agent']
  launch: ReturnType<typeof prepareLocalWorkerStart>['launch']
  chat: Parameters<typeof placedWorkerParty>[1]
  terminal: Parameters<typeof placedWorkerParty>[2]
  orchestrationMutation: WorkerStartMutation | undefined
  recordStart: ReturnType<typeof prepareWorkerStartCard>
  followUp: WorkerFollowUp | undefined
}

// Internal launch plumbing: the caller must authorize, validate and allocate the Dispatch first.
export async function launchPreparedWorkerDispatch(
  args: PreparedWorkerDispatchLaunch
): Promise<unknown> {
  const {
    runtime,
    db,
    params,
    run,
    started,
    requestedWorktree,
    creationTarget,
    agent,
    launch,
    chat,
    terminal,
    orchestrationMutation,
    recordStart
  } = args
  let { mode, resolvedWorktree } = args
  const effects: WorkerEffect[] = []
  const task = started.task
  if (resolvedWorktree) {
    effects.push(
      { kind: 'worktree', action: 'reused', id: resolvedWorktree.id },
      { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
    )
  }
  let terminalHandle = params.terminal
  let placed: Awaited<ReturnType<typeof placeWorkerAgent>> | undefined
  let failedStage = 'terminal_create'
  const onStage = (stage: string) => {
    failedStage = stage
  }
  let result: unknown
  try {
    placed = await placeWorkerAgent({
      preparedNativeStub: args.preparedNativeStub,
      runtime,
      db,
      dispatchId: started.dispatch.id,
      taskId: task.id,
      params,
      requestedWorktree,
      creationTarget,
      resolvedWorktree,
      mode,
      agent,
      launchPreferences: launch.preferences,
      effects,
      onStage,
      followUp: args.followUp
    })
    // New worktrees resolve host support after creation, so the final mode receipt may differ from preflight.
    mode = placed.mode
    resolvedWorktree = placed.worktree
    terminalHandle = placed.terminalHandle
    const { structuredSession, setupReceipt } = placed
    const { workerChat, external, created, authority } = placedWorkerParty(placed, chat, terminal)
    const setupStage = {
      db,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      terminalHandle,
      setup: setupReceipt,
      effects
    }
    recordCreatedWorkerTerminalCustody(runtime, setupStage, created && !structuredSession)
    if (persistGatedSetupSpawnFailure(setupStage)) {
      failedStage = 'setup_start'
      throw new Error('Setup terminal failed to start before the gated agent launch.')
    }
    persistWorkerReadinessStage(setupStage)

    failedStage = 'agent_readiness'
    // A structured worker's setup gate and its preamble's wait share one deadline: the timeout.
    const readinessDeadline = Date.now() + (params.timeoutMs ?? 60_000)
    // Structured readiness comes from preamble delivery, not TUI idle; only repo wait-for-setup policy gates here.
    const wait = structuredSession
      ? await awaitStructuredWorkerSetupGate({
          runtime,
          setup: setupReceipt,
          effects,
          timeoutMs: Math.max(0, readinessDeadline - Date.now())
        })
      : workerChat
        ? // A chat takes its task as a queued send whatever it is doing, so nothing is waited on.
          null
        : await waitForWorkerAgentReady(runtime, terminalHandle, {
            agent,
            reusesTerminal: Boolean(params.terminal),
            creation: placed.terminalCreation,
            timeoutMs: params.timeoutMs ?? 60_000
          })
    if (wait) {
      persistWorkerSetupWaitOutcome({ ...setupStage, wait })
      if (!wait.satisfied) {
        if (setupReceipt.state === 'failed') {
          failedStage = 'setup_wait'
        }
        throw new Error(
          wait.blockedReason
            ? `Agent startup blocked: ${describeTerminalWaitBlockedReason(wait.blockedReason)}`
            : structuredSession
              ? `Setup did not finish before the structured worker started (${wait.status}).`
              : `Agent did not become ready (${wait.status}).`
        )
      }
    }
    const terminalAuthority = authority ?? requireWorkerAuthority(runtime, terminalHandle)
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: terminalHandle,
      ...terminalAuthority,
      worktreeId: resolvedWorktree.id,
      effects,
      setupState: setupReceipt.state,
      terminalOwnership: external ? 'external' : 'created'
    })
    if (workerChat) {
      rebindReusedStructuredWorker(terminalHandle, db)
    }

    result = await deliverAndSettleWorkerStartReadiness({
      runtime,
      db,
      run,
      task: placed.extraSpec ? { ...task, spec: `${task.spec}\n\n${placed.extraSpec}` } : task,
      dispatchId: started.dispatch.id,
      dispatchDepth: started.dispatch.depth,
      structuredSession,
      terminalHandle,
      coordinatorHandle: params.from,
      devMode: params.devMode,
      requestId: orchestrationMutation?.requestId ?? started.dispatch.id,
      agent: agent ?? null,
      launchedAgent: external || workerChat ? null : (agent ?? null),
      setupReceipt,
      launchReceipt: launch.receipt,
      mode,
      timeoutMs: params.timeoutMs ?? 60_000,
      readinessDeadline,
      effects,
      terminalRevealWarning: placed.warning,
      onStage
    })
  } catch (error) {
    result = await failWorkerStartWithReceipt({
      runtime,
      structuredSession: placed?.structuredSession ?? null,
      db,
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      failedStage,
      error,
      setup: placed?.setupReceipt ?? EXISTING_WORKTREE_SETUP,
      launch: launch.receipt,
      mode
    })
  }
  if (
    !params.terminal &&
    terminalHandle &&
    result &&
    typeof result === 'object' &&
    'state' in result &&
    result.state === 'ready'
  ) {
    recordStart({
      dispatchId: started.dispatch.id,
      workerAddress: terminalHandle,
      task: task.spec,
      agent: agent ?? null
    })
  }
  return result
}
