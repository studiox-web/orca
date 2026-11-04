import { basename, dirname, resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime/types'
import {
  cliRepoSource,
  editGoalFromCli,
  findBoardGoal,
  listGoalInboxMessages,
  matchesProjectFilter,
  readCliAuditHistory,
  resolveTargetProject,
  runGoalFromCli,
  sendGoalInboxMessage
} from '../../main/xos/xos-goal-cli'
import { buildXosGoalBoard } from '../../main/xos/xos-goal-board'
import { applyGoalMutation } from '../../main/xos/xos-goal-crud'
import { toggleCliGoalEnabled } from '../../main/xos/xos-usage-models-cli'
import { XOS_GOALS_BOARD_HANDLERS } from './xos-goals-board'

function printOut(json: boolean, payload: unknown, text: string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text)
}

async function resolveBoardAndGoal(flags: Map<string, string | boolean>, cwd: string) {
  const projectFilter = getOptionalStringFlag(flags, 'project')
  const goalName = getRequiredStringFlag(flags, 'goal')
  const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
  const found = findBoardGoal(board, goalName, projectFilter, cwd)
  if (!found) {
    throw new RuntimeClientError('not_found', `Goal "${goalName}" not found.`)
  }
  return { board, ...found, projectFilter }
}

async function toggleGoalPause(
  flags: Map<string, string | boolean>,
  cwd: string,
  json: boolean,
  enabled: boolean
): Promise<void> {
  const projectFilter = getOptionalStringFlag(flags, 'project')
  const goalName = getOptionalStringFlag(flags, 'goal')
  const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
  const res = await toggleCliGoalEnabled({ board, goalName, projectFilter, cwd, enabled })
  if (!res.ok) {
    throw new RuntimeClientError('invalid_argument', res.error)
  }
  const label = enabled ? 'Resumed' : 'Paused'
  printOut(
    json,
    res,
    `${label} ${res.goal ? `${res.project}/${res.goal}` : `project ${res.project}`}`
  )
}

export const XOS_GOALS_HANDLERS: Record<string, CommandHandler> = {
  ...XOS_GOALS_BOARD_HANDLERS,

  'goals show': async ({ flags, cwd, json }) => {
    const { project, goal } = await resolveBoardAndGoal(flags, cwd)
    const inbox = listGoalInboxMessages(dirname(goal.viewer.goalPath))
    printOut(
      json,
      { project: project.name, projectRoot: project.root, ...goal, inbox },
      `${project.name}/${goal.goal} — ${goal.title} [area: ${goal.area.title}, model: ${goal.viewer.configuredModel ?? 'default'}, inbox: ${inbox.filter((m) => m.status === 'open').length} open]`
    )
  },

  'goals run': async ({ flags, cwd, json }) => {
    const { project, goal } = await resolveBoardAndGoal(flags, cwd)
    const res = runGoalFromCli({
      project,
      goal,
      rawMode: getOptionalStringFlag(flags, 'mode'),
      sidecar: getOptionalStringFlag(flags, 'sidecar'),
      message: getOptionalStringFlag(flags, 'message'),
      agent: getOptionalStringFlag(flags, 'agent'),
      bypassQueueGate: true
    })
    if (!res.ok && !res.skipped) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      res,
      res.ok
        ? `Prepared ${res.mode} run for ${res.project}/${res.goal} (${res.agent}) -> ${res.promptPath}`
        : `Skipped ${project.name}/${goal.goal}: ${res.error}`
    )
  },

  'goals pause': async ({ flags, cwd, json }) => toggleGoalPause(flags, cwd, json, false),
  'goals resume': async ({ flags, cwd, json }) => toggleGoalPause(flags, cwd, json, true),

  'goals create': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const slug = getRequiredStringFlag(flags, 'slug')
    const title = getRequiredStringFlag(flags, 'title')
    const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const project = resolveTargetProject(board, projectFilter, cwd)
    if (!project) {
      throw new RuntimeClientError('not_found', 'Target project not found.')
    }
    const firstAgent =
      (getOptionalStringFlag(flags, 'agents') ?? 'codex')
        .split(',')
        .map((s) => s.trim())
        .find((agent) => agent.length > 0) ?? 'codex'
    const createRes = await applyGoalMutation(board, {
      kind: 'create',
      projectKey: project.key,
      goal: slug,
      title,
      agent: firstAgent,
      areaId: null
    })
    if (!createRes.ok) {
      throw new RuntimeClientError('invalid_argument', createRes.error)
    }
    const refreshed = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const found = findBoardGoal(refreshed, slug, projectFilter, cwd)
    if (found) {
      const editRes = await editGoalFromCli({
        board: refreshed,
        project: found.project,
        goal: found.goal,
        model: getOptionalStringFlag(flags, 'model'),
        effort: getOptionalStringFlag(flags, 'effort'),
        area: getOptionalStringFlag(flags, 'area'),
        agents: getOptionalStringFlag(flags, 'agents'),
        lockLane: getOptionalStringFlag(flags, 'lock-lane'),
        schedule: getOptionalStringFlag(flags, 'schedule')
      })
      if (!editRes.ok) {
        throw new RuntimeClientError('invalid_argument', editRes.error)
      }
    }
    printOut(
      json,
      { ok: true, project: project.name, goal: slug, goalPath: createRes.openPath },
      `Created ${project.name}/${slug}`
    )
  },

  'goals edit': async ({ flags, cwd, json }) => {
    const { board, project, goal } = await resolveBoardAndGoal(flags, cwd)
    const res = await editGoalFromCli({
      board,
      project,
      goal,
      title: getOptionalStringFlag(flags, 'title'),
      area: getOptionalStringFlag(flags, 'area'),
      model: getOptionalStringFlag(flags, 'model'),
      effort: getOptionalStringFlag(flags, 'effort'),
      agents: getOptionalStringFlag(flags, 'agents'),
      lockLane: getOptionalStringFlag(flags, 'lock-lane'),
      estimatedRuntime: getOptionalStringFlag(flags, 'estimated-runtime'),
      maxRunsPerDay: getOptionalPositiveIntegerFlag(flags, 'max-runs-per-day'),
      schedule: getOptionalStringFlag(flags, 'schedule')
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      { project: project.name, goal: goal.goal, ...res },
      `Updated ${project.name}/${goal.goal}: ${res.changes.join(', ') || 'no changes'}`
    )
  },

  'goals archive': async ({ flags, cwd, json }) => {
    const { board, project, goal } = await resolveBoardAndGoal(flags, cwd)
    const res = await applyGoalMutation(board, {
      kind: 'archive',
      projectKey: project.key,
      goal: goal.goal,
      crontabHash: board.crontabHash
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      { ok: true, project: project.name, goal: goal.goal, archived: true },
      `Archived ${project.name}/${goal.goal}`
    )
  },

  'goals delete': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const goalName = getRequiredStringFlag(flags, 'goal')
    const confirm = getRequiredStringFlag(flags, 'confirm')
    let board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const active = findBoardGoal(board, goalName, projectFilter, cwd)
    if (active) {
      const arch = await applyGoalMutation(board, {
        kind: 'archive',
        projectKey: active.project.key,
        goal: active.goal.goal,
        crontabHash: board.crontabHash
      })
      if (!arch.ok) {
        throw new RuntimeClientError('invalid_argument', arch.error)
      }
      board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    }
    const project = resolveTargetProject(board, projectFilter, cwd)
    if (!project) {
      throw new RuntimeClientError('not_found', 'Target project not found.')
    }
    const res = await applyGoalMutation(board, {
      kind: 'delete',
      projectKey: project.key,
      archived: goalName,
      confirm,
      crontabHash: board.crontabHash
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      { ok: true, project: project.name, goal: goalName, deleted: true },
      `Deleted ${project.name}/${goalName}`
    )
  },

  'goals message': async ({ flags, cwd, json }) => {
    const { project, goal } = await resolveBoardAndGoal(flags, cwd)
    const msg = sendGoalInboxMessage({
      projectRoot: project.root,
      projectName: project.name,
      goalsDir: project.goalsDir,
      goal: goal.goal,
      body: getRequiredStringFlag(flags, 'body'),
      attachments: getRepeatedStringFlag(flags, 'attach'),
      cwd
    })
    const runResult =
      flags.get('run-now') === true ? runGoalFromCli({ project, goal, rawMode: 'reply' }) : null
    printOut(
      json,
      { ok: true, project: project.name, goal: goal.goal, message: msg, run: runResult },
      `Sent message ${msg.id} to ${project.name}/${goal.goal}`
    )
  },

  'goals reply': async ({ flags, cwd, json }) => {
    const { project, goal } = await resolveBoardAndGoal(flags, cwd)
    const res = runGoalFromCli({
      project,
      goal,
      rawMode: 'reply',
      agent: getOptionalStringFlag(flags, 'agent')
    })
    if (!res.ok && !res.skipped) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      res,
      res.ok
        ? `Prepared reply run for ${res.project}/${res.goal} -> ${res.promptPath}`
        : `Skipped reply run for ${project.name}/${goal.goal}: ${res.error}`
    )
  },

  'goals history': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const goalName = getOptionalStringFlag(flags, 'goal')
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit') ?? 50
    const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const runs = board.projects
      .filter((p) => matchesProjectFilter(p, projectFilter, cwd))
      .flatMap((p) =>
        p.goals
          .filter((g) => !goalName || g.goal === goalName)
          .flatMap((g) => g.viewer.recentRuns.map((r) => ({ project: p.name, ...r })))
      )
      .slice(0, limit)
    const auditEvents = readCliAuditHistory({
      project: projectFilter ? basename(resolve(cwd, projectFilter)) : undefined,
      goal: goalName,
      limit
    })
    printOut(
      json,
      { runs, auditEvents },
      `Runs: ${runs.length}, Audit events: ${auditEvents.length}`
    )
  }
}
