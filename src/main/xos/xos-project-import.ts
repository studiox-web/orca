// XOS fork: `orca goals import`: move goals into the project home, one at a time or all at once,
// without ever overwriting central state that is newer than the repo copy (H5).
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { audit } from './xos-crontab'
import { isDirectory, safeReaddir } from './xos-goal-files'
import { loadOrg, orgFilePath, projectSlug, readMetaAt } from './xos-goal-org'
import {
  commitProjectHomeDir,
  projectAgentsMdPath,
  projectGoalsDir,
  projectHomeDir,
  projectItemsDir,
  projectMetaPath,
  projectSharedDir,
  type XosProjectMeta
} from './xos-project-home'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'

export type XosImportProjectResult = {
  ok: true
  homeDir: string
  meta: XosProjectMeta
  /** Goals already in the home, left as they are unless `force` was given. */
  skippedExisting: string[]
}

export type XosImportOptions = {
  /** Only these goals: the per-goal cutover the plan requires. Omit for the whole project. */
  goals?: string[]
  /** Replace goals already in the home with the repo's copy. Their newer state is overwritten. */
  force?: boolean
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

function copyDirectMarkdownFiles(srcDir: string, destDir: string, force: boolean): number {
  if (!isDirectory(srcDir)) {
    return 0
  }
  mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }
    const dest = join(destDir, entry.name)
    if (existsSync(dest) && !force) {
      continue
    }
    cpSync(join(srcDir, entry.name), dest, { force: true })
    if (entry.name.toLowerCase() !== 'readme.md' && entry.name.toLowerCase() !== 'template.md') {
      copied += 1
    }
  }
  return copied
}

export async function importProjectGoals(
  repoPath: string,
  options: XosImportOptions = {}
): Promise<XosImportProjectResult> {
  const repoRoot = resolve(repoPath)
  if (!isDirectory(repoRoot)) {
    throw new Error(`Repository folder does not exist: ${repoRoot}`)
  }
  const name = basename(repoRoot)
  const slug = projectSlug(name)
  const homeDir = projectHomeDir(repoRoot)
  const destGoalsDir = projectGoalsDir(repoRoot)
  mkdirSync(destGoalsDir, { recursive: true })
  const chosen = options.goals ? new Set(options.goals) : null
  const previous = readMetaAt<XosProjectMeta>(homeDir)
  const skippedExisting: string[] = []

  let goalsImported = 0
  const srcGoalsDir = join(repoRoot, 'automations', 'goals')
  if (isDirectory(srcGoalsDir)) {
    for (const entry of safeReaddir(srcGoalsDir)) {
      const srcGoal = join(srcGoalsDir, entry)
      if (entry.startsWith('.') || !isDirectory(srcGoal) || (chosen && !chosen.has(entry))) {
        continue
      }
      const destGoal = join(destGoalsDir, entry)
      if (existsSync(destGoal) && !options.force) {
        skippedExisting.push(entry)
        continue
      }
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
    cpSync(srcSharedDir, projectSharedDir(repoRoot), {
      recursive: true,
      force: options.force === true
    })
    sharedFilesImported = countMarkdownFiles(projectSharedDir(repoRoot))
  }
  const srcTemplateDir = join(repoRoot, 'automations', '_template')
  if (isDirectory(srcTemplateDir)) {
    cpSync(srcTemplateDir, join(homeDir, '_template'), {
      recursive: true,
      force: options.force === true
    })
  }
  const srcAgentsMd = join(repoRoot, 'automations', 'AGENTS.md')
  if (existsSync(srcAgentsMd)) {
    cpSync(srcAgentsMd, projectAgentsMdPath(repoRoot), { force: options.force === true })
  }

  const force = options.force === true
  let itemsImported = 0
  for (const type of chosen ? [] : LEGACY_ITEM_TYPES) {
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
          itemsImported += copyDirectMarkdownFiles(join(repoRoot, rel), bucketDir, force)
        }
      } else if (stage.paths[0]) {
        itemsImported += copyDirectMarkdownFiles(join(repoRoot, stage.paths[0]), destStage, force)
      }
    }
  }
  const projectsDocsDir = join(repoRoot, 'docs', 'projects')
  if (!chosen && isDirectory(projectsDocsDir)) {
    itemsImported += copyDirectMarkdownFiles(
      projectsDocsDir,
      join(projectItemsDir(repoRoot), 'project', 'active'),
      force
    )
  }

  if (!existsSync(orgFilePath(repoRoot))) {
    const org = loadOrg(repoRoot)
    writeFileSync(
      orgFilePath(repoRoot),
      `${JSON.stringify({ areas: org.areas }, null, 2)}\n`,
      'utf8'
    )
  }

  const meta: XosProjectMeta = {
    repoRoot,
    name,
    slug,
    importedAt: new Date().toISOString(),
    goalsImported,
    itemsImported,
    sharedFilesImported,
    commitSha: null,
    scope: chosen && previous?.scope !== 'project' ? 'goals' : 'project'
  }
  writeFileSync(projectMetaPath(repoRoot), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  meta.commitSha = await commitProjectHomeDir(homeDir, `xos: import ${name}`)
  writeFileSync(projectMetaPath(repoRoot), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await commitProjectHomeDir(homeDir, `xos: record import metadata for ${name}`)
  audit({ action: 'project.import', project: name, homeDir, ...meta })
  return { ok: true, homeDir, meta, skippedExisting }
}
