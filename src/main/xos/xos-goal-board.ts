// XOS fork: assemble the goal board (stage 0) from existing goal folders, run receipts and crontab.
// Read-only over the repos; the only writes are the guarded crontab edits in xos-crontab.ts.
import { basename, join, resolve } from 'node:path'
import type { XosGoalBoard, XosProject } from '../../shared/xos-goals-types'
import { isDirectory, safeReaddir } from './xos-goal-files'
import { readRunReceipts, readTokenUsage } from './xos-goal-receipts'
import {
  hashCrontab,
  parseCrontabWithPaused,
  readCrontabText,
  toCronJob,
  type ParsedCronLine
} from './xos-crontab'
import { goalSortKey, loadOrg } from './xos-goal-org'
import { buildGoal } from './xos-goal-entry'
import { runningFor, runningGoalJobs, within } from './xos-goal-processes'

export type XosRepoSource = {
  getRepos(): readonly {
    id: string
    path: string
    displayName?: string
    connectionId?: string | null
  }[]
}

type ProjectCandidate = {
  root: string
  name: string
  worktreeSelector: string | null
}

function discoverProjects(repos: XosRepoSource, cronLines: ParsedCronLine[]): ProjectCandidate[] {
  const byRoot = new Map<string, ProjectCandidate>()
  for (const repo of repos.getRepos()) {
    if (repo.connectionId) {
      continue // single-machine operation: remote repos are not goal projects
    }
    const root = resolve(repo.path)
    if (!byRoot.has(root) && isDirectory(join(root, 'automations', 'goals'))) {
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
    if (root && !byRoot.has(root) && isDirectory(join(root, 'automations', 'goals'))) {
      byRoot.set(root, { root, name: basename(root), worktreeSelector: null })
    }
  }
  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function buildXosGoalBoard(repos: XosRepoSource): Promise<XosGoalBoard> {
  const now = Date.now()
  const warnings: string[] = []
  const crontabText = await readCrontabText()
  const cronLines = parseCrontabWithPaused(crontabText)
  const running = await runningGoalJobs()
  const claimed = new Set<string>()
  const projects: XosProject[] = []

  for (const candidate of discoverProjects(repos, cronLines)) {
    const goalsDir = join(candidate.root, 'automations', 'goals')
    const goalNames = safeReaddir(goalsDir).filter(
      (name) => !name.startsWith('_') && !name.startsWith('.') && isDirectory(join(goalsDir, name))
    )
    const known = new Set(goalNames)
    const projectLines = cronLines.filter(
      (line) => line.workdir && within(resolve(line.workdir), candidate.root)
    )
    const projectJobs = projectLines.map((line) => toCronJob(line, known, now))
    projectLines.forEach((line) => claimed.add(line.id))
    const org = loadOrg(basename(candidate.root))
    const automationsDir = join(candidate.root, 'automations')
    const runs = readRunReceipts(automationsDir)
    const usage = readTokenUsage(automationsDir)
    const goals = goalNames
      .map((goal) =>
        buildGoal({
          project: candidate,
          goal,
          org,
          runs: runs.get(goal) ?? [],
          usage: usage.get(goal) ?? [],
          cronJobs: projectJobs.filter((job) => job.goal === goal),
          running: runningFor(running, candidate.root, goal),
          now
        })
      )
      .sort((a, b) => {
        const left = goalSortKey(org, a.area, a.goal)
        const right = goalSortKey(org, b.area, b.goal)
        return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2])
      })
    for (const job of projectJobs) {
      if (job.goal && !known.has(job.goal)) {
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
      goals,
      scripts: projectJobs.filter((job) => !job.goal || !known.has(job.goal))
    })
  }

  return {
    generatedAt: new Date(now).toISOString(),
    crontabHash: hashCrontab(crontabText),
    projects,
    otherJobs: cronLines
      .filter((line) => !claimed.has(line.id))
      .map((line) => toCronJob(line, new Set(), now)),
    warnings
  }
}
