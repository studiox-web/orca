// XOS fork: assemble the goal board (stage 0) from existing goal folders, run receipts and crontab.
// Read-only; every write lives in the §3d CRUD modules (xos-crontab*, xos-goal-lifecycle, org-edit).
import { basename, join, resolve } from 'node:path'
import { isRepoOnCatalogHost } from '../../shared/execution-host'
import type { XosCronJob, XosGoalBoard, XosGoalRun, XosProject } from '../../shared/xos-goals-types'
import { safeReaddir } from './xos-goal-files'
import { readRunReceipts, readTokenUsage } from './xos-goal-receipts'
import {
  hashCrontab,
  parseCrontabWithPaused,
  readCrontabText,
  toCronJob,
  xosHome,
  type ParsedCronLine
} from './xos-crontab'
import { goalSortKey, loadOrg } from './xos-goal-org'
import { buildGoal } from './xos-goal-entry'
import { listProjectArchivedGoals } from './xos-goal-lifecycle'
import { runningFor, runningGoalJobs, within } from './xos-goal-processes'
import { liveRunRegistry } from './xos-live-registry'
import { nativeRunningFor } from './xos-live-tail'
import { readNativeReceipts } from './xos-native-receipts'
import {
  hasProjectGoals,
  listProjectGoals,
  readProjectMeta,
  resolveProjectGoalsDir
} from './xos-project-home'
import { goalQueues, scanProjectQueues } from './xos-work-items'

export type XosRepoSource = {
  getRepos(): readonly {
    id: string
    path: string
    displayName?: string
    connectionId?: string | null
  }[]
}

export type ProjectCandidate = {
  root: string
  name: string
  worktreeSelector: string | null
}

function discoverProjects(repos: XosRepoSource, cronLines: ParsedCronLine[]): ProjectCandidate[] {
  const byRoot = new Map<string, ProjectCandidate>()
  for (const repo of repos.getRepos()) {
    if (!isRepoOnCatalogHost(repo)) {
      continue // single-machine operation: remote repos are not goal projects
    }
    const root = resolve(repo.path)
    if (!byRoot.has(root) && hasProjectGoals(root)) {
      byRoot.set(root, {
        root,
        name: repo.displayName || basename(root),
        worktreeSelector: `path:${root}`
      })
    }
  }
  // Repos not added to Orca still show up when the crontab runs goals in them.
  for (const line of cronLines) {
    const root = line.workdir ? resolve(line.workdir) : null
    if (root && !byRoot.has(root) && hasProjectGoals(root)) {
      byRoot.set(root, { root, name: basename(root), worktreeSelector: null })
    }
  }
  // Imported projects in ~/.orca-xos/projects/*/project.json stay visible after crontab retirement.
  for (const slug of safeReaddir(join(xosHome(), 'projects'))) {
    const meta = readProjectMeta(slug)
    const root = meta?.repoRoot ? resolve(meta.repoRoot) : null
    if (root && !byRoot.has(root) && hasProjectGoals(root)) {
      byRoot.set(root, { root, name: meta?.name || basename(root), worktreeSelector: null })
    }
  }
  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Goal projects (repos with automations/goals), without building the board. */
export async function listGoalProjects(repos: XosRepoSource): Promise<ProjectCandidate[]> {
  const text = await readCrontabText().catch(() => '')
  return discoverProjects(repos, parseCrontabWithPaused(text))
}

export async function buildXosGoalBoard(repos: XosRepoSource): Promise<XosGoalBoard> {
  const now = Date.now()
  const warnings: string[] = []
  // Unreadable is not empty: the hash stays unmatchable, so every crontab write refuses.
  const crontabText = await readCrontabText().catch((error: unknown) => {
    warnings.push(error instanceof Error ? error.message : String(error))
    return null
  })
  const cronLines = parseCrontabWithPaused(crontabText ?? '')
  const running = await runningGoalJobs()
  const claimed = new Set<string>()
  const projects: XosProject[] = []

  for (const candidate of discoverProjects(repos, cronLines)) {
    const goalsDir = resolveProjectGoalsDir(candidate.root)
    const goalNames = listProjectGoals(candidate.root)
    const known = new Set(goalNames)
    const projectLines = cronLines.filter(
      (line) => line.workdir && within(resolve(line.workdir), candidate.root)
    )
    const projectJobs = projectLines.map((line) => toCronJob(line, known, now))
    projectLines.forEach((line) => claimed.add(line.id))
    const org = loadOrg(candidate.root)
    const automationsDir = join(candidate.root, 'automations')
    const runs = readRunReceipts(automationsDir)
    const nativeRuns = readNativeReceipts(candidate.root)
    const usage = readTokenUsage(automationsDir)
    const queueScan = scanProjectQueues(candidate.root, { activeOnly: true })
    const liveRuns = liveRunRegistry()
    const runsForGoal = (goal: string): XosGoalRun[] =>
      [...(runs.get(goal) ?? []), ...(nativeRuns.get(goal) ?? [])].sort((a, b) =>
        (b.started_at ?? '').localeCompare(a.started_at ?? '')
      )
    const goals = goalNames
      .map((goal) =>
        buildGoal({
          project: candidate,
          goal,
          org,
          runs: runsForGoal(goal),
          usage: usage.get(goal) ?? [],
          cronJobs: projectJobs.filter((job) => job.goal === goal),
          running:
            runningFor(running, candidate.root, goal) ??
            nativeRunningFor(liveRuns, candidate.root, goal),
          queues: goalQueues(queueScan, goal),
          now
        })
      )
      .sort((a, b) => {
        const left = goalSortKey(org, a.area, a.goal)
        const right = goalSortKey(org, b.area, b.goal)
        return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2])
      })
    const archived = listProjectArchivedGoals(candidate.root)
    const archivedNames = new Set(archived.map((entry) => entry.goal))
    for (const job of projectJobs) {
      if (job.goal && !known.has(job.goal) && !archivedNames.has(job.goal)) {
        warnings.push(
          `${candidate.name}: crontab runs goal "${job.goal}", which has no folder in automations/goals.`
        )
      }
    }
    projects.push({
      key: candidate.root,
      name: candidate.name,
      root: candidate.root,
      goalsDir,
      worktreeSelector: candidate.worktreeSelector,
      orgSource: org.source,
      areas: org.areas.map(({ goals: _goals, ...area }) => area),
      goals,
      archived,
      scripts: projectJobs.filter((job) => !job.goal || !known.has(job.goal))
    })
  }

  return {
    generatedAt: new Date(now).toISOString(),
    crontabHash: crontabText === null ? 'unreadable' : hashCrontab(crontabText),
    projects,
    otherJobs: cronLines
      .filter((line) => !claimed.has(line.id))
      .map((line) => toCronJob(line, new Set(), now)),
    warnings
  }
}

export function findProject(board: XosGoalBoard, key: string): XosProject | null {
  return board.projects.find((project) => project.key === key) ?? null
}

export function allJobs(board: XosGoalBoard): XosCronJob[] {
  return [
    ...board.projects.flatMap((project) => [
      ...project.goals.flatMap((goal) => goal.viewer.cron.jobs),
      ...project.scripts
    ]),
    ...board.otherJobs
  ]
}
