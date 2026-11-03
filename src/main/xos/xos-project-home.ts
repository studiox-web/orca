// XOS fork: Stage B centralized project home (~/.orca-xos/projects/<slug>/) and `orca goals import`.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { runProcess } from '@orca/process-host'
import { audit, xosHome } from './xos-crontab'
import { isDirectory, safeReaddir } from './xos-goal-files'
import { loadOrg, orgFilePath, projectSlug } from './xos-goal-org'
import { LEGACY_ITEM_TYPES, type LegacyStage } from './xos-queue-map'

export type XosProjectMeta = {
  repoRoot: string
  name: string
  slug: string
  importedAt: string
  goalsImported: number
  itemsImported: number
  sharedFilesImported: number
  commitSha: string | null
}

export type XosImportProjectResult = {
  ok: true
  homeDir: string
  meta: XosProjectMeta
}

export function projectHomeDir(nameOrRoot: string): string {
  return join(xosHome(), 'projects', projectSlug(basename(nameOrRoot)))
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
  try {
    const raw: XosProjectMeta = JSON.parse(readFileSync(projectMetaPath(nameOrRoot), 'utf8'))
    return raw && typeof raw.repoRoot === 'string' ? raw : null
  } catch {
    return null
  }
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

export function resolveProjectGoalsDir(repoRoot: string): string {
  if (hasImportedGoals(repoRoot)) {
    return projectGoalsDir(repoRoot)
  }
  const legacy = join(repoRoot, 'automations', 'goals')
  return isDirectory(legacy) ? legacy : projectGoalsDir(repoRoot)
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

function countMarkdownFiles(dir: string): number {
  let count = 0
  for (const entry of safeReaddir(dir)) {
    const full = join(dir, entry)
    if (isDirectory(full)) {
      count += countMarkdownFiles(full)
    } else if (entry.endsWith('.md') && entry !== 'README.md' && entry !== 'TEMPLATE.md') {
      count += 1
    }
  }
  return count
}

function copyDirectMarkdownFiles(srcDir: string, destDir: string): number {
  if (!isDirectory(srcDir)) {
    return 0
  }
  mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }
    cpSync(join(srcDir, entry.name), join(destDir, entry.name), { force: true })
    if (entry.name.toLowerCase() !== 'readme.md' && entry.name.toLowerCase() !== 'template.md') {
      copied += 1
    }
  }
  return copied
}

async function runGit(homeDir: string, args: string[]): Promise<string> {
  const result = await runProcess({ program: 'git', args, cwd: homeDir, timeoutMs: 10_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`)
  }
  return result.stdout.trim()
}

async function initAndCommitProjectHome(homeDir: string, message: string): Promise<string | null> {
  try {
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
    return await runGit(homeDir, ['rev-parse', '--short', 'HEAD'])
  } catch {
    return null
  }
}

export async function commitProjectHome(
  nameOrRoot: string,
  message: string
): Promise<string | null> {
  const homeDir = projectHomeDir(nameOrRoot)
  return isDirectory(homeDir) ? initAndCommitProjectHome(homeDir, message) : null
}

export async function importProjectGoals(repoPath: string): Promise<XosImportProjectResult> {
  const repoRoot = resolve(repoPath)
  if (!isDirectory(repoRoot)) {
    throw new Error(`Repository folder does not exist: ${repoRoot}`)
  }
  const name = basename(repoRoot)
  const slug = projectSlug(name)
  const homeDir = projectHomeDir(repoRoot)
  const destGoalsDir = projectGoalsDir(repoRoot)
  mkdirSync(destGoalsDir, { recursive: true })

  let goalsImported = 0
  const srcGoalsDir = join(repoRoot, 'automations', 'goals')
  if (isDirectory(srcGoalsDir)) {
    for (const entry of safeReaddir(srcGoalsDir)) {
      const srcGoal = join(srcGoalsDir, entry)
      if (entry.startsWith('.') || !isDirectory(srcGoal)) {
        continue
      }
      const destGoal = join(destGoalsDir, entry)
      cpSync(srcGoal, destGoal, { recursive: true, force: true })
      if (!entry.startsWith('_')) {
        for (const sub of ['log', 'inbox', 'assets', 'sidecars']) {
          mkdirSync(join(destGoal, sub), { recursive: true })
        }
        goalsImported += 1
      }
    }
  }

  let sharedFilesImported = 0
  const srcSharedDir = join(repoRoot, 'automations', 'shared')
  if (isDirectory(srcSharedDir)) {
    cpSync(srcSharedDir, projectSharedDir(repoRoot), { recursive: true, force: true })
    sharedFilesImported = countMarkdownFiles(projectSharedDir(repoRoot))
  }
  const srcTemplateDir = join(repoRoot, 'automations', '_template')
  if (isDirectory(srcTemplateDir)) {
    cpSync(srcTemplateDir, join(homeDir, '_template'), { recursive: true, force: true })
  }
  const srcAgentsMd = join(repoRoot, 'automations', 'AGENTS.md')
  if (existsSync(srcAgentsMd)) {
    cpSync(srcAgentsMd, projectAgentsMdPath(repoRoot), { force: true })
  }

  let itemsImported = 0
  for (const type of LEGACY_ITEM_TYPES) {
    if (!type.stages.some((s) => s.paths.some((rel) => isDirectory(join(repoRoot, rel))))) {
      continue
    }
    for (const stage of type.stages) {
      const destStage = join(projectItemsDir(repoRoot), type.id, stage.id)
      mkdirSync(destStage, { recursive: true })
      if (stage.paths.length > 1) {
        for (const rel of stage.paths) {
          const bucketDir = join(destStage, basename(rel))
          mkdirSync(bucketDir, { recursive: true })
          itemsImported += copyDirectMarkdownFiles(join(repoRoot, rel), bucketDir)
        }
      } else if (stage.paths[0]) {
        itemsImported += copyDirectMarkdownFiles(join(repoRoot, stage.paths[0]), destStage)
      }
    }
  }
  const projectsDocsDir = join(repoRoot, 'docs', 'projects')
  if (isDirectory(projectsDocsDir)) {
    itemsImported += copyDirectMarkdownFiles(
      projectsDocsDir,
      join(projectItemsDir(repoRoot), 'project', 'active')
    )
  }

  if (!existsSync(orgFilePath(name))) {
    const org = loadOrg(name)
    writeFileSync(orgFilePath(name), `${JSON.stringify({ areas: org.areas }, null, 2)}\n`, 'utf8')
  }

  const meta: XosProjectMeta = {
    repoRoot,
    name,
    slug,
    importedAt: new Date().toISOString(),
    goalsImported,
    itemsImported,
    sharedFilesImported,
    commitSha: null
  }
  writeFileSync(projectMetaPath(repoRoot), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  meta.commitSha = await initAndCommitProjectHome(homeDir, `xos: import ${name}`)
  writeFileSync(projectMetaPath(repoRoot), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await initAndCommitProjectHome(homeDir, `xos: record import metadata for ${name}`)
  audit({ action: 'project.import', project: name, homeDir, ...meta })
  return { ok: true, homeDir, meta }
}
