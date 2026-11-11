// XOS fork: §3d CRUD for the org chart board. Each mutation re-reads the board, checks the target
// still exists, and goes through the guarded writers (crontab: hash check + backup; org.json:
// history copy; goal folders: archive before delete). Every write lands in ~/.orca-xos/audit.jsonl.
import { dirname } from 'node:path'
import type {
  XosActionResult,
  XosAreaMutation,
  XosGoalBoard,
  XosGoalMutation
} from '../../shared/xos-goals-types'
import { findProject } from './xos-goal-board'
import { setCronLinesPaused } from './xos-crontab'
import { removeCronLines } from './xos-crontab-edit'
import { plural } from './xos-goal-cron-crud'
import {
  archivedGoalHome,
  archiveGoalFolder,
  createGoalFolder,
  deleteArchivedFolder,
  restoreGoalFolder
} from './xos-goal-lifecycle'
import { removeArea, setGoalArea, upsertArea } from './xos-goal-org-edit'
import { commitProjectHome, resolveGoalDir } from './xos-project-home'
import { importProjectGoals } from './xos-project-import'

export { applyCronMutation } from './xos-goal-cron-crud'

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
  const orgName = project.root
  switch (mutation.kind) {
    case 'import-project':
      try {
        const { meta, skippedExisting } = await importProjectGoals(project.root, {
          goals: mutation.goals
        })
        const kept = skippedExisting.length
          ? ` Kept ${plural(skippedExisting.length, 'goal')} already there.`
          : ''
        return {
          ok: true,
          message: `Imported ${meta.goalsImported} goals and ${meta.itemsImported} items into ~/.orca-xos/projects/${meta.slug}.${kept}`
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
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
        void commitProjectHome(project.root, `xos: create goal ${mutation.goal}`)
        return {
          ok: true,
          openPath: goalPath,
          message: `Created ${mutation.goal}. Fill in GOAL.md, then add a schedule from its viewer.`
        }
      })
    case 'set-area':
      return attempt(() => {
        const message = setGoalArea(orgName, mutation.goal, mutation.areaId)
        void commitProjectHome(project.root, `xos: update area for ${mutation.goal}`)
        return { ok: true, message }
      })
    case 'restore':
      return attempt(() => {
        const goal = restoreGoalFolder(
          archivedGoalHome(project.root, mutation.archived),
          mutation.archived
        )
        void commitProjectHome(project.root, `xos: restore goal ${goal}`)
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
          reason: `archive goal ${goal.goal}`,
          adopt: true
        })
        if (!paused.ok) {
          return paused
        }
      }
      return attempt(() => {
        archiveGoalFolder(dirname(resolveGoalDir(project.root, goal.goal)), goal.goal)
        void commitProjectHome(project.root, `xos: archive goal ${goal.goal}`)
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
          reason: `delete archived goal ${entry.goal}`,
          adopt: true
        })
        if (!removed.ok) {
          return removed
        }
      }
      return attempt(() => {
        deleteArchivedFolder(archivedGoalHome(project.root, entry.goal), entry.goal)
        if (project.orgSource === 'org.json') {
          setGoalArea(orgName, entry.goal, null)
        }
        void commitProjectHome(project.root, `xos: delete archived goal ${entry.goal}`)
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
  const orgName = project.root
  return attempt(() => ({
    ok: true,
    message:
      mutation.kind === 'remove'
        ? removeArea(orgName, mutation.areaId)
        : upsertArea(orgName, mutation.area, new Set(project.goals.map((goal) => goal.goal)))
  }))
}
