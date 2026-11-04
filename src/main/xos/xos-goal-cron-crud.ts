// XOS fork: §3d crontab mutations from the board and the CLI. Each one re-reads the board, checks
// the target still exists, and goes through the guarded writers (hash check, backup, adoption).
import type { XosActionResult, XosCronMutation, XosGoalBoard } from '../../shared/xos-goals-types'
import { allJobs, findProject } from './xos-goal-board'
import { setCronLinesPaused, type CrontabWriteResult } from './xos-crontab'
import {
  appendManagedCronLine,
  editCronLine,
  goalScheduleCommand,
  removeCronLines
} from './xos-crontab-edit'
import { isGoalCentral } from './xos-project-home'

const BACKUP_NOTE = 'A backup is in ~/.orca-xos/crontab-backups.'

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function cronResult(result: CrontabWriteResult, done: string, noop: string): XosActionResult {
  if (!result.ok) {
    return result
  }
  return result.changed === 0
    ? { ok: true, changedLines: 0, message: noop }
    : {
        ok: true,
        changedLines: result.changed,
        message: `${done} (${plural(result.changed, 'crontab line')}). ${BACKUP_NOTE}`
      }
}

/** Crontab line ids a pause/resume targets, with a label for messages. */
function pauseTargets(
  board: XosGoalBoard,
  mutation: Extract<XosCronMutation, { kind: `${'pause' | 'resume'}-${string}` }>
): { ids: string[]; label: string } | { error: string } {
  if (mutation.kind === 'pause-job' || mutation.kind === 'resume-job') {
    const job = allJobs(board).find((candidate) => candidate.id === mutation.jobId)
    return job
      ? { ids: [job.id], label: job.name }
      : { error: 'That crontab line no longer exists. Refresh the board.' }
  }
  const project = findProject(board, mutation.projectKey)
  if (!project) {
    return { error: 'That project is no longer on the board.' }
  }
  if (mutation.kind === 'pause-goal' || mutation.kind === 'resume-goal') {
    const goal = project.goals.find((candidate) => candidate.goal === mutation.goal)
    if (!goal) {
      return { error: `Goal ${mutation.goal} was not found.` }
    }
    return { ids: goal.viewer.cron.jobs.map((job) => job.id), label: `goal ${goal.goal}` }
  }
  if (mutation.kind === 'pause-area' || mutation.kind === 'resume-area') {
    const goals = project.goals.filter((goal) => goal.area.id === mutation.areaId)
    const title = project.areas.find((area) => area.id === mutation.areaId)?.title
    return {
      ids: goals.flatMap((goal) => goal.viewer.cron.jobs.map((job) => job.id)),
      label: `area ${title ?? mutation.areaId}`
    }
  }
  return {
    ids: [
      ...project.goals.flatMap((goal) => goal.viewer.cron.jobs.map((job) => job.id)),
      ...project.scripts.map((job) => job.id)
    ],
    label: `project ${project.name}`
  }
}

export async function applyCronMutation(
  board: XosGoalBoard,
  mutation: XosCronMutation
): Promise<XosActionResult> {
  const hash = mutation.crontabHash
  if (mutation.kind === 'edit-job' || mutation.kind === 'remove-job') {
    const job = allJobs(board).find((candidate) => candidate.id === mutation.jobId)
    if (!job) {
      return { ok: false, error: 'That crontab line no longer exists. Refresh the board.' }
    }
    if (mutation.kind === 'remove-job') {
      const result = await removeCronLines({
        ids: new Set([job.id]),
        expectedHash: hash,
        reason: `remove ${job.name} from the Orca board`,
        adopt: mutation.adopt
      })
      return cronResult(result, `Removed ${job.name}`, 'That line was already gone.')
    }
    const result = await editCronLine({
      id: job.id,
      schedule: mutation.schedule,
      command: mutation.command,
      expectedHash: hash,
      reason: `edit ${job.name} from the Orca board`,
      adopt: mutation.adopt
    })
    return cronResult(result, `Saved ${job.goal ?? job.name}`, 'Nothing changed.')
  }
  if (mutation.kind === 'add-goal-schedule') {
    const project = findProject(board, mutation.projectKey)
    if (!project?.goals.some((goal) => goal.goal === mutation.goal)) {
      return { ok: false, error: `Goal ${mutation.goal} was not found.` }
    }
    if (isGoalCentral(project.root, mutation.goal)) {
      return {
        ok: false,
        error: `${mutation.goal} lives in the project home, which crontab scripts can't run. Use orca goals schedule.`
      }
    }
    const command = goalScheduleCommand({
      root: project.root,
      goal: mutation.goal,
      runner: mutation.runner,
      siblingCommands: allJobs(board)
        .filter((job) => job.workdir && project.goals.some((goal) => goal.goal === job.goal))
        .map((job) => job.command)
    })
    if (typeof command !== 'string') {
      return { ok: false, error: command.error }
    }
    const result = await appendManagedCronLine({
      label: `${project.name} ${mutation.goal}`,
      schedule: mutation.schedule,
      command,
      expectedHash: hash,
      reason: `schedule goal ${mutation.goal} from the Orca board`
    })
    return cronResult(result, `Scheduled ${mutation.goal}`, 'Nothing changed.')
  }
  const targets = pauseTargets(board, mutation)
  if ('error' in targets) {
    return { ok: false, error: targets.error }
  }
  const paused = mutation.kind.startsWith('pause-')
  if (targets.ids.length === 0) {
    return { ok: false, error: `${targets.label} has no crontab schedule to change.` }
  }
  const result = await setCronLinesPaused({
    ids: new Set(targets.ids),
    paused,
    expectedHash: hash,
    reason: `${paused ? 'pause' : 'resume'} ${targets.label} from the Orca board`,
    adopt: mutation.adopt,
    includeMigrationPaused: mutation.kind === 'resume-job'
  })
  return cronResult(
    result,
    `${paused ? 'Paused' : 'Resumed'} ${targets.label}`,
    `Nothing to change: ${targets.label} is already ${paused ? 'paused' : 'running on schedule'}.`
  )
}
