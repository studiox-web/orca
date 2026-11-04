// XOS fork: IPC for the Automations → Org chart board (read, run now, art, open file). Registered
// from main-process-automations.ts with one line; the §3d writes live in xos-goal-crud-ipc.ts.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import { ipcMain, shell } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type {
  XosActionResult,
  XosCronJob,
  XosGoalBoard,
  XosProject,
  XosRunNowRequest
} from '../../shared/xos-goals-types'
import { allJobs, buildXosGoalBoard, findProject, type XosRepoSource } from './xos-goal-board'
import { registerXosGoalCrudHandlers } from './xos-goal-crud-ipc'
import { registerXosStudioHandlers } from './xos-studio-ipc'
import { registerXosWorkItemHandlers } from './xos-work-items-ipc'
import { registerXosRuntimeHandlers } from './xos-runtime-ipc'
import { audit, xosHome } from './xos-crontab'
import { assembleGoalPrompt } from './xos-goal-prompt'
import { commitProjectHome, projectHomeDir } from './xos-project-home'

const ART_PREFIX = '/images/admin/ops-cards/'
const ART_MAX_BYTES = 4 * 1024 * 1024
const ART_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

function jobProject(board: XosGoalBoard, job: XosCronJob): XosProject | null {
  return (
    board.projects.find(
      (project) =>
        job.workdir &&
        (resolve(job.workdir) === project.root ||
          resolve(job.workdir).startsWith(`${project.root}${sep}`))
    ) ?? null
  )
}

/** Shows output in the terminal while still appending to the job's own log, as cron would. */
function interactiveCommand(command: string): string {
  const redirect = /\s+>>\s*("[^"]+"|'[^']+'|\S+)\s+2>&1\s*$/.exec(command)
  return redirect ? `${command.slice(0, redirect.index)} 2>&1 | tee -a ${redirect[1]}` : command
}

function buildDirectAgentCommand(args: {
  root: string
  promptPath: string
  agent: string
  model: string | null
  effort: string | null
  lockLane: string
  inboxOnly: boolean
}): string {
  const envPrefix = [
    `CASCADE_ACTIVE_LOCK_LANE=${JSON.stringify(args.lockLane)}`,
    ...(args.inboxOnly ? ['CASCADE_GOAL_INBOX_ONLY=1'] : [])
  ].join(' ')
  if (args.agent === 'claude') {
    const modelArg = args.model ? ` --model ${JSON.stringify(args.model)}` : ''
    const effortArg = args.effort ? ` --effort ${JSON.stringify(args.effort)}` : ''
    return `cd ${JSON.stringify(args.root)} && ${envPrefix} claude -p "$(cat ${JSON.stringify(args.promptPath)})"${modelArg}${effortArg} --dangerously-skip-permissions`
  }
  const modelArg = args.model ? ` -m ${JSON.stringify(args.model)}` : ''
  const effortArg = args.effort
    ? ` -c ${JSON.stringify(`model_reasoning_effort="${args.effort}"`)}`
    : ''
  return `cd ${JSON.stringify(args.root)} && ${envPrefix} codex exec --dangerously-bypass-approvals-and-sandbox -C ${JSON.stringify(args.root)}${modelArg}${effortArg} - < ${JSON.stringify(args.promptPath)}`
}

function goalRunCommand(
  project: XosProject,
  request: Extract<XosRunNowRequest, { kind: 'goal' }>
): { ok: true; command: string; modeLabel: string } | { ok: false; error: string } {
  const entry = project.goals.find((candidate) => candidate.goal === request.goal)
  const mode = request.mode ?? 'normal'
  try {
    const assembled = assembleGoalPrompt({
      repoRoot: project.root,
      goal: request.goal,
      mode,
      sidecar: request.sidecar,
      operatorMessage: request.message,
      requestedAgent: request.runner ?? entry?.viewer.agents[0],
      bypassQueueGate: true
    })
    void commitProjectHome(project.root, `xos: prepare ${mode} run for ${request.goal}`)
    if (assembled.status !== 'ready') {
      return { ok: false, error: assembled.reason }
    }
    const legacyCronScript = join(project.root, 'automations', 'bin', 'run-goal-cron.sh')
    if (existsSync(legacyCronScript) && mode !== 'sidecar') {
      if (mode === 'reply') {
        return {
          ok: true,
          modeLabel: 'Reply inbox',
          command: `cd ${JSON.stringify(project.root)} && CASCADE_GOAL_INBOX_ONLY=1 ./automations/bin/run-goal-cron.sh ${request.goal} ${assembled.agent}`
        }
      }
      const cronGoalLine = entry?.viewer.cron.jobs.find((job) =>
        /run-goal(?:-cron)?\.sh/.test(job.command)
      )
      return {
        ok: true,
        modeLabel: 'Run',
        command:
          cronGoalLine && !request.runner
            ? interactiveCommand(cronGoalLine.command)
            : `cd ${JSON.stringify(project.root)} && ./automations/bin/run-goal-cron.sh ${request.goal} ${assembled.agent}`
      }
    }
    const runDir = join(xosHome(), 'runs')
    mkdirSync(runDir, { recursive: true })
    const promptPath = join(runDir, `${project.name}-${request.goal}-${Date.now()}.prompt.md`)
    writeFileSync(promptPath, assembled.prompt, 'utf8')
    return {
      ok: true,
      modeLabel:
        mode === 'reply'
          ? 'Reply inbox'
          : mode === 'sidecar'
            ? `Sidecar ${request.sidecar}`
            : 'Run',
      command: buildDirectAgentCommand({
        root: project.root,
        promptPath,
        agent: assembled.agent,
        model: assembled.model,
        effort: assembled.effort,
        lockLane: assembled.lockLane,
        inboxOnly: mode === 'reply'
      })
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function launch(
  runtime: OrcaRuntimeService,
  project: XosProject | null,
  command: string,
  title: string
): Promise<XosActionResult> {
  if (project?.worktreeSelector) {
    try {
      await runtime.createTerminal(project.worktreeSelector, {
        command,
        title,
        focus: true,
        wslUserAct: true
      } as Parameters<OrcaRuntimeService['createTerminal']>[1])
      return { ok: true, message: `Started "${title}" in a new ${project.name} terminal.` }
    } catch (error) {
      console.warn('[xos] terminal launch failed; running detached', error)
    }
  }
  const logDir = join(xosHome(), 'runs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `${title.replace(/[^A-Za-z0-9_-]+/g, '-')}-${Date.now()}.log`)
  const fd = openSync(logPath, 'a')
  try {
    spawnProcess({
      program: '/bin/bash',
      args: ['-lc', command],
      cwd: project?.root,
      detached: true,
      stdio: ['ignore', fd, fd]
    }).unref()
  } finally {
    closeSync(fd)
  }
  return { ok: true, message: `Started "${title}" in the background. Output: ${logPath}` }
}

export function registerXosGoalHandlers(repos: XosRepoSource, runtime: OrcaRuntimeService): void {
  ipcMain.handle('xos:goals:getBoard', () => buildXosGoalBoard(repos))
  registerXosGoalCrudHandlers(repos)
  registerXosStudioHandlers(repos)
  registerXosWorkItemHandlers(repos)
  registerXosRuntimeHandlers()

  ipcMain.handle(
    'xos:goals:runNow',
    async (_event, request: XosRunNowRequest): Promise<XosActionResult> => {
      const board = await buildXosGoalBoard(repos)
      if (request.kind === 'goal') {
        const project = findProject(board, request.projectKey)
        const goal = project?.goals.find((candidate) => candidate.goal === request.goal)
        if (!project || !goal) {
          return { ok: false, error: `Goal ${request.goal} was not found.` }
        }
        if (goal.running && request.mode !== 'reply') {
          return { ok: false, error: `${goal.title} is already running (pid ${goal.running.pid}).` }
        }
        const prepared = goalRunCommand(project, request)
        if (!prepared.ok) {
          return prepared
        }
        audit({
          action: 'goal.run_now',
          project: project.name,
          goal: goal.goal,
          mode: request.mode ?? 'normal',
          sidecar: request.sidecar,
          hasMessage: Boolean(request.message?.trim()),
          command: prepared.command
        })
        return launch(runtime, project, prepared.command, `${prepared.modeLabel} ${goal.goal}`)
      }
      const job = allJobs(board).find((candidate) => candidate.id === request.jobId)
      if (!job) {
        return { ok: false, error: 'That crontab line no longer exists. Refresh the board.' }
      }
      const command = interactiveCommand(job.command)
      audit({ action: 'cron.run_now', command })
      return launch(runtime, jobProject(board, job), command, `Run ${job.goal ?? job.name}`)
    }
  )

  ipcMain.handle(
    'xos:goals:cardArt',
    (_event, args: { projectKey: string; relativePath: string }) => {
      const rel = normalize(args.relativePath)
      if (!rel.startsWith(ART_PREFIX) || rel.includes('..') || !ART_TYPES[extname(rel)]) {
        return null
      }
      const sub = rel.slice(ART_PREFIX.length)
      const roots = [
        join(resolve(args.projectKey), 'public', 'images', 'admin', 'ops-cards'),
        join(xosHome(), 'deck', 'ops-cards')
      ]
      for (const root of roots) {
        const path = join(root, sub)
        if (relative(root, path).startsWith('..')) {
          continue
        }
        try {
          if (statSync(path).size <= ART_MAX_BYTES) {
            return `data:${ART_TYPES[extname(path)]};base64,${readFileSync(path).toString('base64')}`
          }
        } catch {
          // Try the next root.
        }
      }
      return null
    }
  )

  ipcMain.handle(
    'xos:goals:openFile',
    async (_event, args: { path: string }): Promise<XosActionResult> => {
      const board = await buildXosGoalBoard(repos)
      const target = resolve(args.path)
      const project = board.projects.find(
        (candidate) =>
          target.startsWith(`${candidate.root}${sep}`) ||
          target.startsWith(`${projectHomeDir(candidate.root)}${sep}`)
      )
      if (!project) {
        return { ok: false, error: 'That file is outside every goal project.' }
      }
      if (target.startsWith(`${project.root}${sep}`) && project.worktreeSelector) {
        try {
          await runtime.openMobileFile(
            project.worktreeSelector,
            relative(project.root, target),
            'host'
          )
          return { ok: true, message: `Opened ${relative(project.root, target)}.` }
        } catch (error) {
          console.warn('[xos] editor open failed; using the system opener', error)
        }
      }
      const failure = await shell.openPath(target)
      return failure ? { ok: false, error: failure } : { ok: true, message: `Opened ${target}.` }
    }
  )
}
