// XOS fork: OV1's data for the operator bot: a deterministic rollup of the board and cutover state,
// so `orca goals briefing` needs no agent run. The AI-written TLDR banner stays out of this.
import type { XosProject } from '../../shared/xos-goals-types'
import type { XosMigrationPlan } from './xos-cron-migration'

const FAILURE = /fail|error|limit/i

function attentionGoals(project: XosProject): string[] {
  return project.goals.filter((goal) => FAILURE.test(goal.result)).map((goal) => goal.goal)
}

export function buildGoalStatus(projects: readonly XosProject[]) {
  return {
    projects: projects.map((project) => ({
      project: project.name,
      root: project.root,
      goals: project.goals.length,
      running: project.goals.filter((goal) => goal.running).length,
      attention: attentionGoals(project).length,
      inboxOpen: project.goals.reduce((sum, goal) => sum + goal.messages.inboxOpen, 0),
      takenOver: project.goals.filter((goal) => goal.takeover).length
    }))
  }
}

export function buildBriefing(projects: readonly XosProject[], plan: XosMigrationPlan) {
  const notRunning = plan.entries.filter((entry) => entry.state === 'not-running')
  const lines: string[] = []
  if (notRunning.length > 0) {
    lines.push(
      `${notRunning.length} paused crontab job(s) have no replacement and are not running.`
    )
  }
  for (const project of projects) {
    const failing = attentionGoals(project)
    if (failing.length > 0) {
      lines.push(`${project.name}: last run needs attention for ${failing.join(', ')}.`)
    }
    const waiting = project.goals.filter((goal) => goal.messages.inboxOpen > 0)
    if (waiting.length > 0) {
      lines.push(`${project.name}: open messages for ${waiting.map((g) => g.goal).join(', ')}.`)
    }
    const held = project.goals.filter((goal) => goal.takeover)
    if (held.length > 0) {
      lines.push(`${project.name}: operator at the helm of ${held.map((g) => g.goal).join(', ')}.`)
    }
  }
  return { lines, notRunning: notRunning.map((entry) => entry.command) }
}
