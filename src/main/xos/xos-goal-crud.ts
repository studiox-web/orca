// XOS fork: §3d CRUD for the org chart board. Each mutation re-reads the board, checks the target
// still exists, and goes through the guarded writers (crontab: hash check + backup; org.json:
// history copy; goal folders: archive before delete). Every write lands in ~/.orca-xos/audit.jsonl.
import { basename } from 'node:path'
import type {
  XosActionResult,
  XosAreaMutation,
  XosCronMutation,
  XosGoalBoard,
  XosGoalMutation
} from '../../shared/xos-goals-types'
import { allJobs, findProject } from './xos-goal-board'
import { setCronLinesPaused, type CrontabWriteResult } from './xos-crontab'
import {
  appendManagedCronLine,
  editCronLine,
  goalScheduleCommand,
  removeCronLines
} from './xos-crontab-edit'
import {
  archiveGoalFolder,
  createGoalFolder,
  deleteArchivedFolder,
  restoreGoalFolder
} from './xos-goal-lifecycle'
import { removeArea, setGoalArea, upsertArea } from './xos-goal-org-edit'

const BACKUP_NOTE = 'A backup is in ~/.orca-xos/crontab-backups.'

function plural(count: number, word: string): string {
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
        reason: `remove ${job.name} from the Orca board`
      })
      return cronResult(result, `Removed ${job.name}`, 'That line was already gone.')
    }
    const result = await editCronLine({
      id: job.id,
      schedule: mutation.schedule,
      command: mutation.command,
      expectedHash: hash,
      reason: `edit ${job.name} from the Orca board`
    })
    return cronResult(result, `Saved ${job.goal ?? job.name}`, 'Nothing changed.')
  }
  if (mutation.kind === 'add-goal-schedule') {
    const project = findProject(board, mutation.projectKey)
    if (!project?.goals.some((goal) => goal.goal === mutation.goal)) {
      return { ok: false, error: `Goal ${mutation.goal} was not found.` }
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
    reason: `${paused ? 'pause' : 'resume'} ${targets.label} from the Orca board`
  })
  return cronResult(
    result,
    `${paused ? 'Paused' : 'Resumed'} ${targets.label}`,
    `Nothing to change: ${targets.label} is already ${paused ? 'paused' : 'running on schedule'}.`
  )
}

function attempt(action: () => XosActionResult): XosActionResult {
  try {
    return action()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function applyGoalMutation(
  board: XosGoalBoard,
  mutation: XosGoalMutation
): Promise<XosActionResult> {
  const project = findProject(board, mutation.projectKey)
  if (!project) {
    return { ok: false, error: 'That project is no longer on the board.' }
  }
  const orgName = basename(project.root)
  switch (mutation.kind) {
    case 'create':
      return attempt(() => {
        const title = mutation.title.trim() || mutation.goal
        const goalPath = createGoalFolder({
          root: project.root,
          goalsDir: project.goalsDir,
          goal: mutation.goal,
          title,
          agent: mutation.agent
        })
        if (mutation.areaId) {
          setGoalArea(orgName, mutation.goal, mutation.areaId)
        }
        return {
          ok: true,
          openPath: goalPath,
          message: `Created ${mutation.goal}. Fill in GOAL.md, then add a schedule from its viewer.`
        }
      })
    case 'set-area':
      return attempt(() => ({
        ok: true,
        message: setGoalArea(orgName, mutation.goal, mutation.areaId)
      }))
    case 'restore':
      return attempt(() => {
        const goal = restoreGoalFolder(project.goalsDir, mutation.archived)
        return {
          ok: true,
          message: `Restored ${goal}. Its schedule stays paused until you resume it.`
        }
      })
    case 'archive': {
      const goal = project.goals.find((candidate) => candidate.goal === mutation.goal)
      if (!goal) {
        return { ok: false, error: `Goal ${mutation.goal} was not found.` }
      }
      if (goal.running) {
        return { ok: false, error: `${goal.title} is running; wait for it to finish first.` }
      }
      const jobIds = goal.viewer.cron.jobs.map((job) => job.id)
      if (jobIds.length > 0) {
        const paused = await setCronLinesPaused({
          ids: new Set(jobIds),
          paused: true,
          expectedHash: mutation.crontabHash,
          reason: `archive goal ${goal.goal}`
        })
        if (!paused.ok) {
          return paused
        }
      }
      return attempt(() => {
        archiveGoalFolder(project.goalsDir, goal.goal)
        return {
          ok: true,
          message: `Archived ${goal.goal}${jobIds.length ? ` and paused ${plural(jobIds.length, 'crontab line')}` : ''}. Restore it from Archived goals.`
        }
      })
    }
    case 'delete': {
      const entry = project.archived.find((candidate) => candidate.goal === mutation.archived)
      if (!entry) {
        return { ok: false, error: `Archived goal ${mutation.archived} was not found.` }
      }
      if (mutation.confirm !== entry.goal) {
        return { ok: false, error: `Type ${entry.goal} to confirm the delete.` }
      }
      const jobIds = project.scripts.filter((job) => job.goal === entry.goal).map((job) => job.id)
      if (jobIds.length > 0) {
        const removed = await removeCronLines({
          ids: new Set(jobIds),
          expectedHash: mutation.crontabHash,
          reason: `delete archived goal ${entry.goal}`
        })
        if (!removed.ok) {
          return removed
        }
      }
      return attempt(() => {
        deleteArchivedFolder(project.goalsDir, entry.goal)
        if (project.orgSource === 'org.json') {
          setGoalArea(orgName, entry.goal, null)
        }
        return {
          ok: true,
          message: `Deleted ${entry.goal}${jobIds.length ? ` and removed ${plural(jobIds.length, 'crontab line')}` : ''}. Git still has its history.`
        }
      })
    }
  }
}

export function applyAreaMutation(board: XosGoalBoard, mutation: XosAreaMutation): XosActionResult {
  const project = findProject(board, mutation.projectKey)
  if (!project) {
    return { ok: false, error: 'That project is no longer on the board.' }
  }
  const orgName = basename(project.root)
  return attempt(() => ({
    ok: true,
    message:
      mutation.kind === 'remove'
        ? removeArea(orgName, mutation.areaId)
        : upsertArea(orgName, mutation.area, new Set(project.goals.map((goal) => goal.goal)))
  }))
}
