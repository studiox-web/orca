// XOS fork: operations on goals (§2.3a): reads answer from files, so they work with Orca closed;
// anything that touches a run goes through the runtime that owns it.
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime/types'
import type { XosActionResult, XosGoalBoard } from '../../shared/xos-goals-types'
import { buildMigrationPlan } from '../../main/xos/xos-cron-migration'
import { readCrontabText } from '../../main/xos/xos-crontab'
import { confirmGoalAuthority } from '../../main/xos/xos-goal-authority'
import { buildXosGoalBoard } from '../../main/xos/xos-goal-board'
import {
  cliRepoSource,
  findBoardGoal,
  listGoalInboxMessages,
  matchesProjectFilter,
  resolveTargetProject
} from '../../main/xos/xos-goal-cli'
import { buildBriefing, buildGoalStatus } from '../../main/xos/xos-goal-briefing'
import { parseFrontmatter, readHead } from '../../main/xos/xos-goal-files'
import { syncGitHubForProject } from '../../main/xos/xos-github-cli'
import { readReceiptLines } from '../../main/xos/xos-native-receipts'
import { appendNotification, readNotifications } from '../../main/xos/xos-notifications'
import { resolveGoalDir } from '../../main/xos/xos-project-home'
import { readTriggerProjects, setProjectTriggers } from '../../main/xos/xos-trigger-projects'
import { listRunConfigs } from '../../main/xos/xos-runtime-store'
import { releaseTakeoverSession } from '../../main/xos/xos-takeover-session'

function printOut(json: boolean, payload: unknown, text: string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text)
}

async function boardFor(flags: Map<string, string | boolean>, cwd: string): Promise<XosGoalBoard> {
  return buildXosGoalBoard(cliRepoSource(cwd, getOptionalStringFlag(flags, 'project')))
}

async function goalFor(flags: Map<string, string | boolean>, cwd: string) {
  const goalName = getRequiredStringFlag(flags, 'goal')
  const projectFilter = getOptionalStringFlag(flags, 'project')
  const found = findBoardGoal(await boardFor(flags, cwd), goalName, projectFilter, cwd)
  if (!found) {
    throw new RuntimeClientError(
      'not_found',
      `Goal "${goalName}" not found, or in several projects: pass --project.`
    )
  }
  return found
}

function scoped(board: XosGoalBoard, flags: Map<string, string | boolean>, cwd: string) {
  const filter = getOptionalStringFlag(flags, 'project')
  return board.projects.filter((project) => matchesProjectFilter(project, filter, cwd))
}

function failIfRefused(result: { ok: boolean; error?: string }): void {
  if (!result.ok) {
    throw new RuntimeClientError('invalid_argument', result.error ?? 'Refused.')
  }
}

export const XOS_GOALS_OPS_HANDLERS: Record<string, CommandHandler> = {
  'goals stop': async ({ flags, client, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const { result } = await client.call<XosActionResult>('xos.goal.stop', {
      repoRoot: project.root,
      goal: goal.goal
    })
    failIfRefused(result)
    printOut(json, result, result.ok ? result.message : '')
  },

  'goals runs': async ({ flags, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit') ?? 20
    const runs = readReceiptLines(project.root)
      .filter((receipt) => receipt.goal === goal.goal)
      .toReversed()
      .slice(0, limit)
    printOut(
      json,
      { project: project.name, goal: goal.goal, runs },
      runs
        .map((run) => `${run.started_at} ${run.status} ${run.runner ?? ''} ${run.run_id}`)
        .join('\n') || 'No native runs yet.'
    )
  },

  'goals status': async ({ flags, cwd, json }) => {
    const status = buildGoalStatus(scoped(await boardFor(flags, cwd), flags, cwd))
    printOut(
      json,
      status,
      status.projects
        .map(
          (row) =>
            `${row.project}: ${row.goals} goals, ${row.running} running, ${row.attention} need attention, ${row.inboxOpen} open messages, ${row.takenOver} taken over`
        )
        .join('\n') || 'No projects.'
    )
  },

  'goals briefing': async ({ flags, cwd, json }) => {
    const board = await boardFor(flags, cwd)
    const plan = buildMigrationPlan(await readCrontabText(), listRunConfigs())
    const briefing = buildBriefing(scoped(board, flags, cwd), plan)
    printOut(json, briefing, briefing.lines.join('\n') || 'Nothing needs attention.')
  },

  'goals messages': async ({ flags, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const messages = listGoalInboxMessages(resolveGoalDir(project.root, goal.goal))
    printOut(
      json,
      { project: project.name, goal: goal.goal, messages },
      messages
        .map(
          (message) =>
            `${String(message.status)} ${String(message.from)}: ${String(message.subject)}`
        )
        .join('\n') || 'No messages.'
    )
  },

  'goals notify': async ({ flags, json }) => {
    const entry = appendNotification({
      goal: getRequiredStringFlag(flags, 'goal'),
      text: getRequiredStringFlag(flags, 'text'),
      image: getOptionalStringFlag(flags, 'image') ?? null
    })
    printOut(json, entry, `Queued for ${entry.goal}.`)
  },

  'goals notifications': async ({ flags, json }) => {
    const notifications = readNotifications(getOptionalStringFlag(flags, 'since'))
    printOut(
      json,
      { notifications },
      notifications.map((row) => `${row.at} ${row.goal}: ${row.text}`).join('\n') ||
        'No notifications.'
    )
  },

  'goals schedule': async ({ flags, client, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const { result } = await client.call<
      { ok: true; automationId: string; message: string } | { ok: false; error: string }
    >('xos.goal.schedule', {
      repoRoot: project.root,
      goal: goal.goal,
      schedule: getRequiredStringFlag(flags, 'schedule'),
      agent: getOptionalStringFlag(flags, 'agent'),
      timezone: getOptionalStringFlag(flags, 'timezone')
    })
    failIfRefused(result)
    printOut(json, result, result.ok ? result.message : '')
  },

  'goals authorize': async ({ flags, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const result = confirmGoalAuthority({
      repoRoot: project.root,
      goal: goal.goal,
      fm: parseFrontmatter(readHead(goal.viewer.goalPath, 16 * 1024)),
      typed: getRequiredStringFlag(flags, 'confirm')
    })
    failIfRefused(result)
    printOut(json, result, `${goal.goal} may now run with its confirmed authority.`)
  },

  'goals release': async ({ flags, cwd, json }) => {
    const { project, goal } = await goalFor(flags, cwd)
    const result = releaseTakeoverSession({
      repoRoot: project.root,
      goal: goal.goal,
      note: getOptionalStringFlag(flags, 'note'),
      advance: flags.get('done') === true
    })
    failIfRefused(result)
    printOut(json, result, result.ok ? result.message : '')
  },

  'goals triggers': async ({ flags, cwd, json }) => {
    const enable = flags.get('enable') === true
    const disable = flags.get('disable') === true
    if (!enable && !disable) {
      const projects = readTriggerProjects()
      printOut(json, { projects }, projects.join('\n') || 'Queue triggers are off everywhere.')
      return
    }
    const board = await boardFor(flags, cwd)
    const project = resolveTargetProject(board, getOptionalStringFlag(flags, 'project'), cwd)
    if (!project) {
      throw new RuntimeClientError('not_found', 'Target project not found: pass --project.')
    }
    const projects = setProjectTriggers(project.root, enable)
    printOut(json, { projects }, `Queue triggers ${enable ? 'on' : 'off'} for ${project.name}.`)
  },

  'goals github-sync': async ({ flags, cwd, json }) => {
    const board = await boardFor(flags, cwd)
    const project = resolveTargetProject(board, getOptionalStringFlag(flags, 'project'), cwd)
    if (!project) {
      throw new RuntimeClientError('not_found', 'Target project not found: pass --project.')
    }
    const result = await syncGitHubForProject({
      repoRoot: project.root,
      close: flags.get('close') === true
    })
    printOut(
      json,
      result,
      `${result.synced.length} new items, ${result.closed.length} issues ${result.dryRun ? 'would close' : 'closed'}.`
    )
  },

  'goals migrate plan': async ({ json }) => {
    const plan = buildMigrationPlan(await readCrontabText(), listRunConfigs())
    printOut(
      json,
      plan,
      plan.entries
        .map(
          (entry) => `${entry.state.padEnd(18)} ${entry.schedule}  ${entry.goal ?? entry.command}`
        )
        .join('\n') || 'The crontab has no jobs.'
    )
  },

  'goals migrate replace': async ({ flags, client, json }) => {
    const { result } = await client.call<
      { ok: true; automationId: string; message: string } | { ok: false; error: string }
    >('xos.cron.replace', {
      jobId: getRequiredStringFlag(flags, 'job'),
      timezone: getOptionalStringFlag(flags, 'timezone')
    })
    failIfRefused(result)
    printOut(json, result, result.ok ? result.message : '')
  }
}
