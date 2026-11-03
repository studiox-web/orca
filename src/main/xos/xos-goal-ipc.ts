// XOS fork: IPC for the Automations → Org chart board. Registered from register-core-handlers.ts
// with one line, so upstream rebases only touch that hook.
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { ipcMain, shell } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type {
  XosActionResult,
  XosCronJob,
  XosCronMutation,
  XosGoalBoard,
  XosProject,
  XosRunNowRequest
} from '../../shared/xos-goals-types'
import { buildXosGoalBoard, type XosRepoSource } from './xos-goal-board'
import { audit, setCronLinesPaused, xosHome } from './xos-crontab'

const ART_PREFIX = '/images/admin/ops-cards/'
const ART_MAX_BYTES = 4 * 1024 * 1024
const ART_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

function findProject(board: XosGoalBoard, key: string): XosProject | null {
  return board.projects.find((project) => project.key === key) ?? null
}

function allJobs(board: XosGoalBoard): XosCronJob[] {
  return [
    ...board.projects.flatMap((project) => [
      ...project.goals.flatMap((goal) => goal.viewer.cron.jobs),
      ...project.scripts
    ]),
    ...board.otherJobs
  ]
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

function goalRunCommand(project: XosProject, goal: string): string {
  const entry = project.goals.find((candidate) => candidate.goal === goal)
  const cronGoalLine = entry?.viewer.cron.jobs.find((job) =>
    /run-goal(?:-cron)?\.sh/.test(job.command)
  )
  if (cronGoalLine) {
    // Reuse the scheduled command (PATH, cd, wrapper) so locks and receipts behave like cron.
    return interactiveCommand(cronGoalLine.command)
  }
  const runner = entry?.viewer.agents[0] ?? 'codex'
  return `cd ${JSON.stringify(project.root)} && ./automations/bin/run-goal-cron.sh ${goal} ${runner}`
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
      return {
        ok: true,
        message: `Started "${title}" in a new ${project.name} terminal.`
      }
    } catch (error) {
      console.warn('[xos] terminal launch failed; running detached', error)
    }
  }
  // Not an Orca project (or no window): run it the way cron would, logging to ~/.orca-xos/runs.
  const logDir = join(xosHome(), 'runs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `${title.replace(/[^A-Za-z0-9_-]+/g, '-')}-${Date.now()}.log`)
  const fd = openSync(logPath, 'a')
  try {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd: project?.root,
      detached: true,
      stdio: ['ignore', fd, fd]
    })
    child.unref()
  } finally {
    closeSync(fd)
  }
  return {
    ok: true,
    message: `Started "${title}" in the background. Output: ${logPath}`
  }
}

export function registerXosGoalHandlers(repos: XosRepoSource, runtime: OrcaRuntimeService): void {
  ipcMain.handle('xos:goals:getBoard', () => buildXosGoalBoard(repos))

  ipcMain.handle(
    'xos:goals:mutateCron',
    async (_event, mutation: XosCronMutation): Promise<XosActionResult> => {
      const board = await buildXosGoalBoard(repos)
      let ids: string[] = []
      let label = ''
      if (mutation.kind === 'pause-goal' || mutation.kind === 'resume-goal') {
        const goal = findProject(board, mutation.projectKey)?.goals.find(
          (g) => g.goal === mutation.goal
        )
        if (!goal) {
          return { ok: false, error: `Goal ${mutation.goal} was not found.` }
        }
        ids = goal.viewer.cron.jobs.map((job) => job.id)
        label = `goal ${mutation.goal}`
        if (ids.length === 0) {
          return {
            ok: false,
            error: `${mutation.goal} has no crontab schedule to ${mutation.kind === 'pause-goal' ? 'pause' : 'resume'}.`
          }
        }
      } else {
        const job = allJobs(board).find((candidate) => candidate.id === mutation.jobId)
        if (!job) {
          return {
            ok: false,
            error: 'That crontab line no longer exists. Refresh the board.'
          }
        }
        ids = [job.id]
        label = job.name
      }
      const paused = mutation.kind === 'pause-goal' || mutation.kind === 'pause-job'
      const result = await setCronLinesPaused({
        ids: new Set(ids),
        paused,
        expectedHash: mutation.crontabHash,
        reason: `${paused ? 'pause' : 'resume'} ${label} from the Orca board`
      })
      if (!result.ok) {
        return result
      }
      return {
        ok: true,
        changedLines: result.changed,
        message:
          result.changed === 0
            ? `Nothing to change: ${label} is already ${paused ? 'paused' : 'running on schedule'}.`
            : `${paused ? 'Paused' : 'Resumed'} ${label} (${result.changed} crontab line${result.changed === 1 ? '' : 's'}). A backup is in ~/.orca-xos/crontab-backups.`
      }
    }
  )

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
        if (goal.running) {
          return {
            ok: false,
            error: `${goal.title} is already running (pid ${goal.running.pid}).`
          }
        }
        const command = goalRunCommand(project, goal.goal)
        audit({
          action: 'goal.run_now',
          project: project.name,
          goal: goal.goal,
          command
        })
        return launch(runtime, project, command, `Run ${goal.goal}`)
      }
      const job = allJobs(board).find((candidate) => candidate.id === request.jobId)
      if (!job) {
        return {
          ok: false,
          error: 'That crontab line no longer exists. Refresh the board.'
        }
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
      // Per-project art overrides the shared default deck in ~/.orca-xos/deck/ops-cards.
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
          if (statSync(path).size > ART_MAX_BYTES) {
            continue
          }
          return `data:${ART_TYPES[extname(path)]};base64,${readFileSync(path).toString('base64')}`
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
      const project = board.projects.find((candidate) =>
        target.startsWith(`${candidate.root}${sep}`)
      )
      if (!project) {
        return { ok: false, error: 'That file is outside every goal project.' }
      }
      if (project.worktreeSelector) {
        try {
          await runtime.openMobileFile(
            project.worktreeSelector,
            relative(project.root, target),
            'host'
          )
          return {
            ok: true,
            message: `Opened ${relative(project.root, target)}.`
          }
        } catch (error) {
          console.warn('[xos] editor open failed; using the system opener', error)
        }
      }
      const failure = await shell.openPath(target)
      return failure ? { ok: false, error: failure } : { ok: true, message: `Opened ${target}.` }
    }
  )
}
