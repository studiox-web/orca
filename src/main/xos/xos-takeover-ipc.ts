// XOS fork: Stage D drill-in IPC (plan §3e, §3h.2): live run tails, the next buildable item, and
// Continue on… / Build now / Work on it myself. Interactive sessions launch through the runtime's
// own agent-startup machinery (managed worktree or project-workspace terminal) so the prompt is
// primed exactly like a launcher agent tab; autonomous builds reuse the native goal runner.
import { basename, resolve } from 'node:path'
import { ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hostQualifiedRepoSelector } from '../runtime/runtime-repo-selector'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { TuiAgent } from '../../shared/tui-agent'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { writeXosModelArgs } from '../../shared/xos-model-args'
import type { Repo } from '../../shared/repo-types'
import type {
  XosActionResult,
  XosContinueOnRequest,
  XosGoalBoard
} from '../../shared/xos-goals-types'
import { buildXosGoalBoard, findProject, type XosRepoSource } from './xos-goal-board'
import { audit } from './xos-crontab'
import { liveRunRegistry, startNativeGoalRun } from './xos-live-runs'
import { readLiveTail } from './xos-live-tail'
import {
  buildTakeoverPrompt,
  nextEligibleItem,
  recordTakeoverReceipt,
  resolveItemWorkspace
} from './xos-takeover'
import { releaseTakeoverSession, startTakeoverSession } from './xos-takeover-session'

/** §3h.2 drill-in: claim the item, assemble the takeover prompt, then either open an interactive
 *  agent session (existing project workspace, or a new managed worktree for code items) or start
 *  an autonomous native build run in a fresh managed worktree. */
async function continueOn(
  repos: XosRepoSource,
  runtime: OrcaRuntimeService,
  board: XosGoalBoard,
  request: XosContinueOnRequest
): Promise<XosActionResult> {
  const project = findProject(board, request.projectKey)
  const goal = project?.goals.find((candidate) => candidate.goal === request.goal)
  if (!project || !goal) {
    return { ok: false, error: `Goal ${request.goal} was not found.` }
  }
  if (!isTuiAgent(request.agent)) {
    return { ok: false, error: `Unknown agent "${request.agent}".` }
  }
  const agent: TuiAgent = request.agent
  const itemPath = request.itemPath ?? null
  const itemSlug = itemPath
    ? basename(itemPath, '.md')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .slice(0, 30)
    : ''
  const worktreeName = `xos-${request.goal.slice(0, 24)}${itemSlug ? `-${itemSlug}` : ''}`.slice(
    0,
    48
  )
  // The store hands out full Repo rows; XosRepoSource only promises id/path, so guard at the edge.
  const repo = (): Repo | null =>
    repos.getRepos().find((entry): entry is Repo => resolve(entry.path) === project.root) ?? null

  if (request.mode === 'build') {
    const target = repo()
    if (!target) {
      return {
        ok: false,
        error: `${project.name} is not registered in Orca; add it to use Build now.`
      }
    }
    const created = await runtime.createManagedWorktree({
      repoSelector: hostQualifiedRepoSelector(`id:${target.id}`, getRepoExecutionHostId(target)),
      name: worktreeName,
      setupDecision: 'inherit',
      activate: false,
      createdWithAgent: agent,
      wslUserAct: true,
      telemetrySource: 'unknown',
      comment: `XOS Build now: ${request.goal}${itemSlug ? ` — ${itemSlug}` : ''}`
    })
    const removeWorktree = (): Promise<unknown> =>
      runtime
        .removeManagedWorktree(`path:${created.worktree.path}`, { force: true })
        .catch((error) => console.warn('[xos] could not remove a failed Build now worktree', error))
    const started = await startNativeGoalRun({
      repoRoot: project.root,
      goal: request.goal,
      message: request.message,
      itemPath: itemPath ?? undefined,
      runner: request.agent,
      model: request.model,
      effort: request.effort,
      force: true,
      trigger: 'build_now',
      worktree: { path: created.worktree.path, branch: created.worktree.branch ?? null }
    })
    if (!started.ok) {
      await removeWorktree()
      return started
    }
    audit({
      action: 'goal.build_now',
      project: project.name,
      goal: request.goal,
      item: itemPath,
      worktree: created.worktree.path,
      runId: started.runId
    })
    return {
      ok: true,
      message: `Building ${itemSlug || request.goal} in a new worktree. ${started.message}`
    }
  }

  const prepared = buildTakeoverPrompt({
    repoRoot: project.root,
    goal: request.goal,
    agent: request.agent,
    message: request.message,
    itemPath,
    fromStartedAt: request.fromStartedAt ?? null
  })
  if (!prepared.ok) {
    return { ok: false, error: prepared.error }
  }
  const session = await startTakeoverSession({
    repoRoot: project.root,
    goal: request.goal,
    agent: request.agent,
    itemPath
  })
  if (!session.ok) {
    return session
  }
  const abandon = (error: string): XosActionResult => {
    releaseTakeoverSession({ repoRoot: project.root, goal: request.goal, note: error })
    return { ok: false, error }
  }
  const modelArgs = writeXosModelArgs(agent, '', {
    model: request.model,
    effort: request.effort
  })
  const agentArgs = modelArgs || null
  const workspace = itemPath ? resolveItemWorkspace(project.root, itemPath) : 'existing'
  if (workspace === 'new-worktree') {
    const target = repo()
    if (!target) {
      return abandon(
        `${project.name} is not registered in Orca; add it to open a worktree session.`
      )
    }
    const created = await runtime.createManagedWorktree({
      repoSelector: hostQualifiedRepoSelector(`id:${target.id}`, getRepoExecutionHostId(target)),
      name: worktreeName,
      setupDecision: 'inherit',
      activate: true,
      createdWithAgent: agent,
      startupAgent: agent,
      startupPrompt: prepared.prompt,
      ...(agentArgs !== null ? { startupAgentArgs: agentArgs } : {}),
      startupLaunchSource: 'xos_takeover',
      wslUserAct: true,
      telemetrySource: 'unknown',
      comment: `XOS takeover: ${request.goal}${itemSlug ? ` — ${itemSlug}` : ''}`
    })
    recordTakeoverReceipt({
      repoRoot: project.root,
      goal: request.goal,
      agent: request.agent,
      trigger: 'manual_takeover',
      itemPath,
      worktreePath: created.worktree.path,
      branch: created.worktree.branch ?? null,
      parentRunId: prepared.fromRunId ?? null
    })
    audit({
      action: 'goal.takeover_worktree',
      project: project.name,
      goal: request.goal,
      item: itemPath,
      worktree: created.worktree.path
    })
    return {
      ok: true,
      message: `Opened a worktree with ${request.agent} primed for ${goal.title}. Review the prompt and press Enter.`
    }
  }
  if (!project.worktreeSelector) {
    return abandon(
      `${project.name} has no Orca workspace; add it to Orca to take over interactively.`
    )
  }
  await runtime.createTerminal(project.worktreeSelector, {
    startupAgent: agent,
    startupPrompt: prepared.prompt,
    startupPromptDelivery: 'draft',
    ...(agentArgs !== null ? { agentArgs } : {}),
    title: `Take over: ${goal.title}${itemSlug ? ` (${itemSlug})` : ''}`,
    focus: true,
    wslUserAct: true
  })
  recordTakeoverReceipt({
    repoRoot: project.root,
    goal: request.goal,
    agent: request.agent,
    trigger: 'manual_takeover',
    itemPath,
    parentRunId: prepared.fromRunId ?? null
  })
  audit({
    action: 'goal.takeover_session',
    project: project.name,
    goal: request.goal,
    item: itemPath,
    agent: request.agent
  })
  return {
    ok: true,
    message: `${request.agent} is at the helm of ${goal.title}. Review the draft prompt and press Enter.`
  }
}

export function registerXosTakeoverHandlers(
  repos: XosRepoSource,
  runtime: OrcaRuntimeService
): void {
  ipcMain.handle('xos:goals:liveTail', (_event, args: { projectKey: string; goal: string }) =>
    readLiveTail(liveRunRegistry(), args.projectKey, args.goal)
  )

  ipcMain.handle(
    'xos:goals:releaseTakeover',
    (_event, args: { projectKey: string; goal: string; note?: string; advance?: boolean }) =>
      releaseTakeoverSession({ ...args, repoRoot: args.projectKey })
  )

  ipcMain.handle('xos:goals:nextItem', (_event, args: { projectKey: string; goal: string }) =>
    nextEligibleItem(args.projectKey, args.goal)
  )

  ipcMain.handle(
    'xos:goals:continueOn',
    async (_event, request: XosContinueOnRequest): Promise<XosActionResult> =>
      continueOn(repos, runtime, await buildXosGoalBoard(repos), request)
  )
}
