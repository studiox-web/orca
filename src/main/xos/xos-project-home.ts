// XOS fork: Stage B centralized project home (~/.orca-xos/projects/<slug>/) and `orca goals import`.
import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { audit } from './xos-crontab'
import { isDirectory, safeReaddir } from './xos-goal-files'
import { projectHomeDir, readMetaAt, type XosProjectHomeOwner } from './xos-goal-org'
import type { LegacyStage } from './xos-queue-map'

export { projectHomeDir }

export type XosProjectMeta = XosProjectHomeOwner & {
  name: string
  slug: string
  importedAt: string
  goalsImported: number
  itemsImported: number
  sharedFilesImported: number
  commitSha: string | null
  /** 'goals' = only chosen goals moved; the rest still run from the repo (absent = whole project). */
  scope?: 'project' | 'goals'
}

export function projectGoalsDir(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'goals')
}

export function projectSharedDir(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'shared')
}

export function projectItemsDir(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'items')
}

export function projectAgentsMdPath(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'AGENTS.md')
}

export function projectMetaPath(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'project.json')
}

export function readProjectMeta(nameOrRoot: string): XosProjectMeta | null {
  return readMetaAt<XosProjectMeta>(projectHomeDir(nameOrRoot))
}

/** The whole project moved (not just chosen goals), so new goals and items belong in the home. */
export function hasFullImport(repoRoot: string): boolean {
  const meta = readProjectMeta(repoRoot)
  return meta !== null && meta.scope !== 'goals'
}

export function hasImportedGoals(repoRoot: string): boolean {
  const goalsDir = projectGoalsDir(repoRoot)
  if (!isDirectory(goalsDir)) {
    return false
  }
  return (
    existsSync(projectMetaPath(repoRoot)) ||
    safeReaddir(goalsDir).some((name) => !name.startsWith('.') && isDirectory(join(goalsDir, name)))
  )
}

export function hasProjectGoals(repoRoot: string): boolean {
  return hasImportedGoals(repoRoot) || isDirectory(join(repoRoot, 'automations', 'goals'))
}

/** Where new goals go. Existing ones can live in either home: use resolveGoalDir for those. */
export function resolveProjectGoalsDir(repoRoot: string): string {
  if (hasFullImport(repoRoot)) {
    return projectGoalsDir(repoRoot)
  }
  const legacy = join(repoRoot, 'automations', 'goals')
  return isDirectory(legacy) ? legacy : projectGoalsDir(repoRoot)
}

/** Goals cut over one at a time (§4b): each resolves to the central home once it was imported. */
export function isGoalCentral(repoRoot: string, goal: string): boolean {
  return existsSync(join(projectGoalsDir(repoRoot), goal, 'GOAL.md'))
}

export function resolveGoalDir(repoRoot: string, goal: string): string {
  if (isGoalCentral(repoRoot, goal)) {
    return join(projectGoalsDir(repoRoot), goal)
  }
  const legacy = join(repoRoot, 'automations', 'goals', goal)
  return isDirectory(legacy) ? legacy : join(resolveProjectGoalsDir(repoRoot), goal)
}

/** Every goal of a project across both homes, sorted, without hidden or `_` folders. */
export function listProjectGoals(repoRoot: string): string[] {
  const names = new Set<string>()
  for (const dir of [projectGoalsDir(repoRoot), join(repoRoot, 'automations', 'goals')]) {
    for (const name of safeReaddir(dir)) {
      if (!name.startsWith('_') && !name.startsWith('.') && isDirectory(join(dir, name))) {
        names.add(name)
      }
    }
  }
  return [...names].sort()
}

export function resolveSharedDirs(repoRoot: string): string[] {
  return [projectSharedDir(repoRoot), join(repoRoot, 'automations', 'shared')].filter(isDirectory)
}

export function resolveAgentsMdPath(repoRoot: string): string | null {
  const candidates = [
    projectAgentsMdPath(repoRoot),
    join(repoRoot, 'automations', 'AGENTS.md'),
    join(repoRoot, 'AGENTS.md')
  ]
  for (const path of candidates) {
    try {
      if (statSync(path).isFile()) {
        return path
      }
    } catch {
      // Try next.
    }
  }
  return null
}

export function resolveStageDirs(repoRoot: string, typeId: string, stage: LegacyStage): string[] {
  const central = join(projectItemsDir(repoRoot), typeId, stage.id)
  if (isDirectory(central)) {
    if (stage.paths.length > 1) {
      const buckets = stage.paths.map((rel) => join(central, basename(rel))).filter(isDirectory)
      if (buckets.length > 0) {
        return buckets
      }
    }
    return [central]
  }
  return stage.paths.map((rel) => join(repoRoot, rel)).filter(isDirectory)
}

async function runGit(homeDir: string, args: string[]): Promise<string> {
  const result = await runProcess({ program: 'git', args, cwd: homeDir, timeoutMs: 10_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`)
  }
  return result.stdout.trim()
}

const homeCommits = new Map<string, Promise<unknown>>()
const INDEX_LOCK_RETRIES = 4
const INDEX_LOCK_BACKOFF_MS = 250

function isIndexLockError(error: unknown): boolean {
  return /index\.lock|Unable to create .*\.lock/i.test(String(error))
}

async function commitHomeOnce(homeDir: string, message: string): Promise<string> {
  if (!existsSync(join(homeDir, '.git'))) {
    await runGit(homeDir, ['init', '-q'])
  }
  await runGit(homeDir, ['add', '-A'])
  if (await runGit(homeDir, ['status', '--porcelain'])) {
    await runGit(homeDir, [
      '-c',
      'user.email=xos@orca.local',
      '-c',
      'user.name=Orca XOS',
      'commit',
      '-q',
      '-m',
      message
    ])
  }
  return runGit(homeDir, ['rev-parse', '--short', 'HEAD'])
}

/** Serialized per home; a CLI in another process can still hold index.lock, so that retries. */
export function commitProjectHomeDir(homeDir: string, message: string): Promise<string | null> {
  const attempt = async (): Promise<string | null> => {
    for (let tries = 0; ; tries += 1) {
      try {
        return await commitHomeOnce(homeDir, message)
      } catch (error) {
        if (isIndexLockError(error) && tries < INDEX_LOCK_RETRIES) {
          await new Promise((done) => setTimeout(done, INDEX_LOCK_BACKOFF_MS * (tries + 1)))
          continue
        }
        audit({ action: 'project.commit_failed', homeDir, message, error: String(error) })
        console.warn('[xos] project home commit failed', error)
        return null
      }
    }
  }
  const next = (homeCommits.get(homeDir) ?? Promise.resolve()).then(attempt, attempt)
  homeCommits.set(homeDir, next)
  return next
}

export async function commitProjectHome(
  nameOrRoot: string,
  message: string
): Promise<string | null> {
  const homeDir = projectHomeDir(nameOrRoot)
  return isDirectory(homeDir) ? commitProjectHomeDir(homeDir, message) : null
}
