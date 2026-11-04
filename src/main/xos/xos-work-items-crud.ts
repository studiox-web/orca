// XOS fork: Stage C work-item CRUD & transition timeline (§3h.2). Electron-free so both IPC and CLI use it.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { XosItemActionResult } from '../../shared/xos-items-types'
import { audit } from './xos-crontab'
import { isDirectory, parseFrontmatter } from './xos-goal-files'
import {
  patchMarkdownFrontmatter,
  recordTransitionEvent,
  transitionWorkItem
} from './xos-item-claims'
import {
  commitProjectHome,
  hasFullImport,
  projectItemsDir,
  resolveStageDirs
} from './xos-project-home'
import { LEGACY_ITEM_TYPES, type LegacyItemType, type LegacyStage } from './xos-queue-map'
import { readItemSummary } from './xos-work-items'
import { locateWorkItem } from './xos-work-item-read'

export {
  locateWorkItem,
  readWorkItemDetailForRoots,
  type LocatedWorkItem
} from './xos-work-item-read'

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'item'
  )
}

export function resolveStageTargetDir(
  repoRoot: string,
  type: LegacyItemType,
  stage: LegacyStage,
  bucket?: string | null
): string {
  const cleanBucket = bucket?.trim().replace(/[^a-z0-9_-]/gi, '') || null
  const existingDirs = resolveStageDirs(repoRoot, type.id, stage)
  const useCentral =
    hasFullImport(repoRoot) || isDirectory(join(projectItemsDir(repoRoot), type.id))
  if (cleanBucket) {
    const matchingExisting = existingDirs.find((dir) => basename(dir) === cleanBucket)
    if (matchingExisting) {
      return matchingExisting
    }
    if (useCentral) {
      return join(projectItemsDir(repoRoot), type.id, stage.id, cleanBucket)
    }
    const matchingRel = stage.paths.find((rel) => basename(rel) === cleanBucket)
    return matchingRel
      ? join(repoRoot, matchingRel)
      : join(repoRoot, stage.paths[0] ?? `items/${type.id}/${stage.id}`, cleanBucket)
  }
  if (existingDirs.length > 0) {
    return existingDirs[0]
  }
  return useCentral
    ? join(projectItemsDir(repoRoot), type.id, stage.id)
    : join(repoRoot, stage.paths[0] ?? `items/${type.id}/${stage.id}`)
}

function setDottedKey(fm: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split('.')
  let cur: Record<string, unknown> = fm
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) {
      cur[part] = {}
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded just above to be a non-null, non-array object.
    cur = cur[part] as Record<string, unknown>
  }
  const last = parts.at(-1)!
  if (value === null || value === undefined) {
    delete cur[last]
  } else {
    cur[last] = value
  }
}

export function createWorkItem(args: {
  repoRoot: string
  typeId: string
  stageId?: string
  title: string
  body?: string
  priority?: string
  size?: string
  risk?: string
  ready?: boolean
  slug?: string
  bucket?: string | null
  nowMs?: number
}): XosItemActionResult {
  const title = args.title.trim()
  if (!title) {
    return { ok: false, error: 'Item title is required.' }
  }
  const type = LEGACY_ITEM_TYPES.find((t) => t.id === args.typeId)
  const stage = type
    ? args.stageId
      ? type.stages.find((s) => s.id === args.stageId)
      : type.stages[0]
    : undefined
  if (!type || !stage) {
    return {
      ok: false,
      error: `Unknown item type or stage (${args.typeId}/${args.stageId ?? 'default'}).`
    }
  }
  const nowIso = new Date(args.nowMs ?? Date.now()).toISOString()
  const datePrefix = nowIso.slice(0, 10)
  const baseSlug = (args.slug?.trim() || `${datePrefix}-${slugifyTitle(title)}`).replace(
    /\.md$/,
    ''
  )
  const targetDir = resolveStageTargetDir(args.repoRoot, type, stage, args.bucket)
  mkdirSync(targetDir, { recursive: true })
  let fullPath = join(targetDir, `${baseSlug}.md`)
  for (let seq = 2; existsSync(fullPath); seq += 1) {
    fullPath = join(targetDir, `${baseSlug}-${seq}.md`)
  }
  const fm: Record<string, unknown> = {
    title,
    created: datePrefix,
    status: 'open',
    ...(args.priority ? { priority: args.priority } : {}),
    ...(args.size ? { size: args.size } : {}),
    ...(args.risk ? { risk: args.risk } : {})
  }
  if (args.ready !== undefined) {
    setDottedKey(fm, stage.readyKey ?? 'builder.ready', args.ready)
  }
  const bodyText = args.body?.trim() ? args.body.trim() : `# ${title}\n`
  writeFileSync(fullPath, `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${bodyText}\n`, 'utf8')
  recordTransitionEvent(args.repoRoot, {
    at: nowIso,
    item: basename(fullPath, '.md'),
    fromPath: '',
    toPath: fullPath,
    fromStage: 'created',
    toStage: stage.id,
    goal: 'operator',
    ...(args.bucket ? { outcome: args.bucket } : {})
  })
  void commitProjectHome(args.repoRoot, `xos: create ${type.id} item ${basename(fullPath)}`)
  audit({
    action: 'item.create',
    repoRoot: args.repoRoot,
    typeId: type.id,
    stageId: stage.id,
    path: fullPath
  })
  const item = readItemSummary(
    { path: fullPath, mtimeMs: statSync(fullPath).mtimeMs, bucket: args.bucket ?? null },
    type.id,
    stage
  )
  return { ok: true, message: `Created ${title} in ${stage.label}.`, path: fullPath, item }
}

export function moveWorkItem(args: {
  roots: string[]
  pathOrQuery: string
  toStageId: string
  bucket?: string | null
  goal?: string
  nowMs?: number
}): XosItemActionResult {
  const located = locateWorkItem(args.roots, args.pathOrQuery)
  if (!located) {
    return { ok: false, error: `Work item not found: ${args.pathOrQuery}` }
  }
  const toStage = located.type.stages.find((s) => s.id === args.toStageId)
  if (!toStage) {
    return {
      ok: false,
      error: `Stage "${args.toStageId}" does not exist on type "${located.type.id}".`
    }
  }
  const bucket =
    args.bucket ?? (toStage.kind === 'rejected' && toStage.paths.length > 1 ? 'not-now' : null)
  const toDir = resolveStageTargetDir(located.repoRoot, located.type, toStage, bucket)
  if (bucket && toStage.kind === 'rejected') {
    const raw = readFileSync(located.item.path, 'utf8')
    writeFileSync(
      located.item.path,
      patchMarkdownFrontmatter(raw, { rejection_reason: bucket }),
      'utf8'
    )
  }
  const destPath = transitionWorkItem({
    repoRoot: located.repoRoot,
    filePath: located.item.path,
    toDir,
    goal: args.goal ?? 'operator',
    outcome: bucket ?? undefined,
    nowMs: args.nowMs
  })
  audit({
    action: 'item.move',
    repoRoot: located.repoRoot,
    from: located.item.path,
    to: destPath,
    toStage: toStage.id,
    bucket
  })
  const item = readItemSummary(
    { path: destPath, mtimeMs: statSync(destPath).mtimeMs, bucket },
    located.type.id,
    toStage
  )
  return {
    ok: true,
    message: `Moved ${item.title} to ${toStage.label}${bucket ? ` (${bucket})` : ''}.`,
    path: destPath,
    item
  }
}

export function editWorkItem(args: {
  roots: string[]
  pathOrQuery: string
  title?: string
  ready?: boolean | null
  updates?: Record<string, string | null>
  body?: string
}): XosItemActionResult {
  const located = locateWorkItem(args.roots, args.pathOrQuery)
  if (!located) {
    return { ok: false, error: `Work item not found: ${args.pathOrQuery}` }
  }
  const raw = readFileSync(located.item.path, 'utf8')
  const fm = { ...parseFrontmatter(raw) }
  const end = raw.startsWith('---') ? raw.indexOf('\n---', 3) : -1
  const currentBody = end === -1 ? raw : raw.slice(raw.indexOf('\n', end + 4) + 1)
  if (args.title?.trim()) {
    fm.title = args.title.trim()
  }
  if (args.ready !== undefined) {
    setDottedKey(fm, located.stage.readyKey ?? 'builder.ready', args.ready)
  }
  for (const [key, val] of Object.entries(args.updates ?? {})) {
    setDottedKey(fm, key, val === '' ? null : val)
  }
  fm.updated_at = new Date().toISOString()
  const nextBody = args.body !== undefined ? `${args.body.trim()}\n` : currentBody
  const nextText = `---\n${stringifyYaml(fm).trimEnd()}\n---\n${nextBody.startsWith('\n') ? nextBody : `\n${nextBody}`}`
  writeFileSync(located.item.path, nextText, 'utf8')
  void commitProjectHome(located.repoRoot, `xos: edit item ${basename(located.item.path)}`)
  audit({ action: 'item.edit', repoRoot: located.repoRoot, path: located.item.path })
  const item = readItemSummary(
    {
      path: located.item.path,
      mtimeMs: statSync(located.item.path).mtimeMs,
      bucket: located.item.bucket
    },
    located.type.id,
    located.stage
  )
  return { ok: true, message: `Updated ${item.title}.`, path: located.item.path, item }
}
