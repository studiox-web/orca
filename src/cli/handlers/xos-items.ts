import { basename, resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime/types'
import { buildXosGoalBoard, listGoalProjects } from '../../main/xos/xos-goal-board'
import { cliRepoSource, matchesProjectFilter } from '../../main/xos/xos-goal-cli'
import { readTransitionEvents, transitionWorkItem } from '../../main/xos/xos-item-claims'
import { buildCliUsageSummary, listCliModels } from '../../main/xos/xos-usage-models-cli'
import { readItemSummary, scanProjectQueues } from '../../main/xos/xos-work-items'
import {
  createWorkItem,
  editWorkItem,
  locateWorkItem,
  moveWorkItem,
  readWorkItemDetailForRoots
} from '../../main/xos/xos-work-items-crud'

void transitionWorkItem
void readTransitionEvents

function printOut(json: boolean, payload: unknown, text: string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text)
}

async function getScopedRoots(
  cwd: string,
  projectFilter?: string
): Promise<{ root: string; name: string }[]> {
  const discovered = await listGoalProjects(cliRepoSource(cwd, projectFilter))
  return discovered.filter((p) => matchesProjectFilter(p, projectFilter, cwd))
}

export const XOS_ITEMS_HANDLERS: Record<string, CommandHandler> = {
  'items list': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const typeFilter = getOptionalStringFlag(flags, 'type')
    const stageFilter = getOptionalStringFlag(flags, 'stage')
    const roots = await getScopedRoots(cwd, projectFilter)
    const items = roots.flatMap((proj) =>
      scanProjectQueues(proj.root, { activeOnly: false })
        .filter(({ type }) => !typeFilter || type.id === typeFilter)
        .flatMap(({ type, stages }) =>
          stages
            .filter(({ stage }) => !stageFilter || stage.id === stageFilter)
            .flatMap(({ stage, files }) =>
              files.map((file) => ({
                project: proj.name,
                projectRoot: proj.root,
                id: basename(file.path, '.md'),
                ...readItemSummary(file, type.id, stage)
              }))
            )
        )
    )
    printOut(
      json,
      { items, total: items.length },
      items.length === 0
        ? 'No matching items.'
        : items
            .map(
              (item) =>
                `${item.project}/${item.typeId}/${item.stageId}/${item.id}${item.ready ? ' [ready]' : ''} — ${item.title}`
            )
            .join('\n')
    )
  },

  'items show': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const id = getRequiredStringFlag(flags, 'id')
    const roots = (await getScopedRoots(cwd, projectFilter)).map((r) => r.root)
    const located = locateWorkItem(roots, id, {
      typeId: getOptionalStringFlag(flags, 'type'),
      stageId: getOptionalStringFlag(flags, 'stage')
    })
    if (!located) {
      throw new RuntimeClientError('not_found', `Work item "${id}" not found.`)
    }
    const detail = readWorkItemDetailForRoots(roots, located.item.path)
    if (!detail) {
      throw new RuntimeClientError('not_found', `Work item "${id}" could not be read.`)
    }
    const payload = {
      project: basename(located.repoRoot),
      projectRoot: located.repoRoot,
      id: basename(located.item.path, '.md'),
      item: located.item,
      ...detail
    }
    printOut(
      json,
      payload,
      [
        `${payload.project}/${located.item.typeId}/${located.item.stageId}/${payload.id} — ${located.item.title}`,
        `  path: ${located.item.path}`,
        `  ready: ${located.item.ready}`,
        `  transitions: ${(detail.transitions ?? []).length}`
      ].join('\n')
    )
  },

  'items create': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const title = getRequiredStringFlag(flags, 'title')
    const roots = await getScopedRoots(cwd, projectFilter)
    const targetRoot =
      roots.find((r) => r.root === resolve(cwd))?.root ??
      roots[0]?.root ??
      (projectFilter ? resolve(cwd, projectFilter) : resolve(cwd))
    const res = createWorkItem({
      repoRoot: targetRoot,
      typeId: getOptionalStringFlag(flags, 'type') ?? 'feature-ideas',
      stageId: getOptionalStringFlag(flags, 'stage'),
      title,
      slug: getOptionalStringFlag(flags, 'id'),
      priority: getOptionalStringFlag(flags, 'priority'),
      size: getOptionalStringFlag(flags, 'size'),
      risk: getOptionalStringFlag(flags, 'risk'),
      ready: flags.get('ready') === true ? true : undefined,
      body: getOptionalStringFlag(flags, 'body')
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(
      json,
      { ...res, project: basename(targetRoot), id: basename(res.path, '.md') },
      res.message
    )
  },

  'items move': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const id = getRequiredStringFlag(flags, 'id')
    const toStageId = getRequiredStringFlag(flags, 'to-stage')
    const roots = (await getScopedRoots(cwd, projectFilter)).map((r) => r.root)
    const located = locateWorkItem(roots, id, {
      typeId: getOptionalStringFlag(flags, 'type'),
      stageId: getOptionalStringFlag(flags, 'stage')
    })
    const res = moveWorkItem({
      roots,
      pathOrQuery: located?.item.path ?? id,
      toStageId,
      bucket: getOptionalStringFlag(flags, 'reason'),
      goal: getOptionalStringFlag(flags, 'goal'),
      force: flags.get('force') === true
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(json, { ...res, id: basename(res.path, '.md') }, res.message)
  },

  'items edit': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const id = getRequiredStringFlag(flags, 'id')
    const setPairs = getRepeatedStringFlag(flags, 'set')
    const updates: Record<string, string | null> = {}
    for (const pair of setPairs) {
      const eq = pair.indexOf('=')
      if (eq <= 0) {
        throw new RuntimeClientError(
          'invalid_argument',
          `Invalid --set "${pair}" (expected key=value)`
        )
      }
      const key = pair.slice(0, eq).trim()
      const val = pair.slice(eq + 1).trim()
      updates[key] = val.length > 0 ? val : null
    }
    const ready =
      flags.get('ready') === true ? true : flags.get('unready') === true ? false : undefined
    const roots = (await getScopedRoots(cwd, projectFilter)).map((r) => r.root)
    const located = locateWorkItem(roots, id, {
      typeId: getOptionalStringFlag(flags, 'type'),
      stageId: getOptionalStringFlag(flags, 'stage')
    })
    const res = editWorkItem({
      roots,
      pathOrQuery: located?.item.path ?? id,
      updates,
      ready,
      title: getOptionalStringFlag(flags, 'title'),
      body: getOptionalStringFlag(flags, 'body')
    })
    if (!res.ok) {
      throw new RuntimeClientError('invalid_argument', res.error)
    }
    printOut(json, { ...res, id: basename(res.path, '.md') }, res.message)
  },

  'usage limits': async ({ client, json }) => {
    const { result } = await client.call<
      { agent: string; known: boolean; exhausted: boolean; note: string }[]
    >('xos.usage.limits', {})
    printOut(
      json,
      { limits: result },
      result.map((row) => `${row.agent}: ${row.known ? row.note : 'unknown'}`).join('\n')
    )
  },

  'usage summary': async ({ flags, cwd, json }) => {
    const projectFilter = getOptionalStringFlag(flags, 'project')
    const goalFilter = getOptionalStringFlag(flags, 'goal')
    const days = getOptionalPositiveIntegerFlag(flags, 'days') ?? 7
    const board = await buildXosGoalBoard(cliRepoSource(cwd, projectFilter))
    const summary = buildCliUsageSummary({
      board,
      projectFilter,
      goalFilter,
      days,
      cwd
    })
    printOut(
      json,
      summary,
      [
        `XOS Usage Summary (last ${summary.days} day(s)):`,
        `  runs: ${summary.totalRuns}`,
        `  tokens: ${summary.totalTokens.toLocaleString()}`,
        `  estimated cost: $${summary.totalCostUsd.toFixed(4)}`,
        ...summary.byGoal.map(
          (g) =>
            `  - ${g.project}/${g.goal}: ${g.runs} run(s), ${g.tokens.toLocaleString()} tokens, $${g.costUsd.toFixed(4)}`
        )
      ].join('\n')
    )
  },

  'models list': async ({ flags, json }) => {
    const agent = getOptionalStringFlag(flags, 'agent')
    const res = await listCliModels(agent)
    printOut(
      json,
      res,
      res.models
        .map(
          (m) =>
            `${m.agent}/${m.id} (${m.label}) — tier: ${m.tier ?? 'excluded'}${m.edited ? ' [edited]' : ''}${m.isDefault ? ' [default]' : ''}`
        )
        .join('\n')
    )
  }
}
