// XOS fork: Stage C Agent-facing CLI backend (§2.3a) for `orca goals`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type {
  XosAuditEvent,
  XosGoal,
  XosGoalBoard,
  XosGoalRunMode,
  XosProject
} from '../../shared/xos-goals-types'
import { audit, xosHome } from './xos-crontab'
import type { XosRepoSource } from './xos-goal-board'
import { applyCronMutation } from './xos-goal-crud'
import { isDirectory } from './xos-goal-files'
import { listGoalInboxMessages, sendGoalInboxMessage } from './xos-goal-inbox'
import { resolveOrCreateAreaId, setGoalArea } from './xos-goal-org-edit'
import { projectSlug } from './xos-goal-org'
import { assembleGoalPrompt } from './xos-goal-prompt'
import { patchMarkdownFrontmatter } from './xos-item-claims'
import { commitProjectHome, hasProjectGoals } from './xos-project-home'

export { listGoalInboxMessages, sendGoalInboxMessage }

export function cliRepoSource(cwd: string, projectFilter?: string): XosRepoSource {
  const candidates = new Set<string>()
  const resolvedCwd = resolve(cwd)
  if (hasProjectGoals(resolvedCwd)) {
    candidates.add(resolvedCwd)
  }
  if (projectFilter) {
    const resolvedFilter = resolve(cwd, projectFilter)
    if (isDirectory(resolvedFilter)) {
      candidates.add(resolvedFilter)
    }
  }
  return {
    getRepos: () =>
      [...candidates].map((path, index) => ({
        id: `cli-${index}`,
        path,
        displayName: basename(path)
      }))
  }
}

export function matchesProjectFilter(
  project: { root: string; name: string },
  filter: string | undefined,
  cwd: string
): boolean {
  if (!filter) {
    return true
  }
  const lower = filter.toLowerCase()
  const resolved = resolve(cwd, filter)
  return (
    project.root === resolved ||
    project.root === filter ||
    project.name.toLowerCase() === lower ||
    basename(project.root).toLowerCase() === lower ||
    projectSlug(project.name) === projectSlug(filter)
  )
}

export function matchesAreaFilter(
  area: { id: string; title: string },
  filter: string | undefined
): boolean {
  if (!filter) {
    return true
  }
  const lower = filter.toLowerCase()
  return area.id.toLowerCase() === lower || area.title.toLowerCase() === lower
}

export function resolveTargetProject(
  board: XosGoalBoard,
  filter: string | undefined,
  cwd: string
): XosProject | null {
  if (filter) {
    return board.projects.find((p) => matchesProjectFilter(p, filter, cwd)) ?? null
  }
  return board.projects.find((p) => p.root === resolve(cwd)) ?? board.projects[0] ?? null
}

export function findBoardGoal(
  board: XosGoalBoard,
  goalName: string,
  projectFilter: string | undefined,
  cwd: string
): { project: XosProject; goal: XosGoal } | null {
  for (const project of board.projects) {
    if (!matchesProjectFilter(project, projectFilter, cwd)) {
      continue
    }
    const goal = project.goals.find((g) => g.goal === goalName)
    if (goal) {
      return { project, goal }
    }
  }
  return null
}

export async function editGoalFromCli(args: {
  board: XosGoalBoard
  project: XosProject
  goal: XosGoal
  title?: string
  area?: string
  model?: string
  effort?: string
  agents?: string
  lockLane?: string
  estimatedRuntime?: string
  maxRunsPerDay?: number
  schedule?: string
}): Promise<{ ok: true; goalPath: string; changes: string[] } | { ok: false; error: string }> {
  const goalPath = args.goal.viewer.goalPath
  if (!existsSync(goalPath)) {
    return { ok: false, error: `GOAL.md not found at ${goalPath}` }
  }
  const changes: string[] = []
  let text = readFileSync(goalPath, 'utf8')
  const fmUpdates: Record<string, string | null> = {}
  const setFm = (key: string, val: string | undefined): void => {
    if (val !== undefined) {
      fmUpdates[key] = val || null
      changes.push(`${key}=${val}`)
    }
  }
  setFm('model', args.model)
  setFm('model_reasoning_effort', args.effort)
  if (args.agents !== undefined) {
    const list = args.agents
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setFm('agents', `[${list.join(', ')}]`)
  }
  setFm('lock_lane', args.lockLane)
  setFm('estimated_runtime', args.estimatedRuntime)
  if (args.maxRunsPerDay !== undefined) {
    setFm('max_runs_per_day', String(args.maxRunsPerDay))
  }
  if (Object.keys(fmUpdates).length > 0) {
    text = patchMarkdownFrontmatter(text, fmUpdates)
  }
  if (args.title?.trim()) {
    text = /^#\s+.+$/m.test(text)
      ? text.replace(/^#\s+.+$/m, `# Goal: ${args.title.trim()}`)
      : `${text.trimEnd()}\n\n# Goal: ${args.title.trim()}\n`
    changes.push(`title=${args.title.trim()}`)
  }
  writeFileSync(goalPath, text, 'utf8')
  if (args.area !== undefined) {
    if (args.area.trim()) {
      const resolved = resolveOrCreateAreaId(args.project, args.area)
      if (!resolved.ok) {
        return { ok: false, error: resolved.error }
      }
      setGoalArea(basename(args.project.root), args.goal.goal, resolved.areaId)
    } else {
      setGoalArea(basename(args.project.root), args.goal.goal, null)
    }
    changes.push(`area=${args.area}`)
  }
  if (args.schedule?.trim()) {
    const cronRes = await applyCronMutation(args.board, {
      kind: 'add-goal-schedule',
      projectKey: args.project.key,
      goal: args.goal.goal,
      schedule: args.schedule.trim(),
      runner: args.goal.viewer.agents[0] ?? 'codex',
      crontabHash: args.board.crontabHash
    })
    if (!cronRes.ok) {
      return cronRes
    }
    changes.push(`schedule=${args.schedule.trim()}`)
  }
  void commitProjectHome(args.project.root, `xos: edit goal ${args.goal.goal}`)
  audit({ action: 'goal.edit', project: args.project.name, goal: args.goal.goal, changes })
  return { ok: true, goalPath, changes }
}

export function runGoalFromCli(args: {
  project: XosProject
  goal: XosGoal
  rawMode?: string
  sidecar?: string
  message?: string
  agent?: string
  bypassQueueGate?: boolean
}):
  | {
      ok: true
      project: string
      goal: string
      mode: XosGoalRunMode
      sidecar: string | null
      agent: string
      model: string | null
      effort: string | null
      lockLane: string
      promptPath: string
      reopenedFromDod: boolean
      openInboxCount: number
    }
  | { ok: false; skipped?: boolean; status?: string; error: string } {
  let mode: XosGoalRunMode = 'normal'
  let sidecar = args.sidecar
  if (args.rawMode) {
    if (args.rawMode === 'reply') {
      mode = 'reply'
    } else if (args.rawMode === 'sidecar' || args.rawMode.startsWith('sidecar:')) {
      mode = 'sidecar'
      if (args.rawMode.startsWith('sidecar:')) {
        sidecar = args.rawMode.slice('sidecar:'.length)
      }
    } else if (args.rawMode !== 'normal') {
      return { ok: false, error: `Invalid run mode "${args.rawMode}".` }
    }
  } else if (sidecar) {
    mode = 'sidecar'
  }
  const assembled = assembleGoalPrompt({
    repoRoot: args.project.root,
    goal: args.goal.goal,
    mode,
    sidecar,
    operatorMessage: args.message,
    requestedAgent: args.agent ?? args.goal.viewer.agents[0],
    bypassQueueGate: args.bypassQueueGate ?? true
  })
  void commitProjectHome(args.project.root, `xos: prepare ${mode} run for ${args.goal.goal}`)
  if (assembled.status !== 'ready') {
    return { ok: false, skipped: true, status: assembled.status, error: assembled.reason }
  }
  const runDir = join(xosHome(), 'runs')
  mkdirSync(runDir, { recursive: true })
  const promptPath = join(runDir, `${args.project.name}-${args.goal.goal}-${Date.now()}.prompt.md`)
  writeFileSync(promptPath, assembled.prompt, 'utf8')
  audit({
    action: 'goal.run_now',
    project: args.project.name,
    goal: args.goal.goal,
    mode,
    sidecar: sidecar ?? null,
    agent: assembled.agent,
    promptPath
  })
  return {
    ok: true,
    project: args.project.name,
    goal: args.goal.goal,
    mode,
    sidecar: sidecar ?? null,
    agent: assembled.agent,
    model: assembled.model,
    effort: assembled.effort,
    lockLane: assembled.lockLane,
    promptPath,
    reopenedFromDod: assembled.reopenedFromDod,
    openInboxCount: assembled.openInboxCount
  }
}

export function readCliAuditHistory(args: {
  project?: string
  goal?: string
  limit?: number
}): XosAuditEvent[] {
  const path = join(xosHome(), 'audit.jsonl')
  if (!existsSync(path)) {
    return []
  }
  const limit = Math.max(1, Math.min(args.limit ?? 50, 500))
  const events: XosAuditEvent[] = []
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean).toReversed()) {
    try {
      const ev: XosAuditEvent = JSON.parse(line)
      if (args.project && String(ev.project ?? '').toLowerCase() !== args.project.toLowerCase()) {
        continue
      }
      if (args.goal && String(ev.goal ?? '') !== args.goal) {
        continue
      }
      events.push(ev)
      if (events.length >= limit) {
        break
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return events
}
