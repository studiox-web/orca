// XOS fork: §3d area CRUD. Areas live in ~/.orca-xos/projects/<slug>/org.json. The first edit
// writes the current (possibly default) org out, and every write keeps the previous version in
// org-history/ so any change can be reverted by hand.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { XosGoalArea, XosProject } from '../../shared/xos-goals-types'
import { audit } from './xos-crontab'
import { loadOrg, orgFilePath, type XosOrg } from './xos-goal-org'

type OrgArea = XosGoalArea & { goals: string[] }
const HISTORY_KEEP = 50
export const AREA_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

function editableAreas(org: XosOrg): OrgArea[] {
  return org.areas.map((area) => ({ ...area, goals: [...(area.goals ?? [])] }))
}

function saveOrg(projectName: string, areas: OrgArea[], event: Record<string, unknown>): void {
  const path = orgFilePath(projectName)
  mkdirSync(dirname(path), { recursive: true })
  let backup: string | null = null
  if (existsSync(path)) {
    const historyDir = join(dirname(path), 'org-history')
    mkdirSync(historyDir, { recursive: true })
    backup = join(historyDir, `org-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    copyFileSync(path, backup)
    const old = readdirSync(historyDir)
      .filter((name) => name.startsWith('org-'))
      .sort()
      .toReversed()
      .slice(HISTORY_KEEP)
    for (const name of old) {
      rmSync(join(historyDir, name), { force: true })
    }
  }
  writeFileSync(path, `${JSON.stringify({ areas }, null, 2)}\n`)
  audit({ ...event, project: projectName, backup })
}

/** Moves a goal into an area (or out of every area with `null`), keeping list order otherwise. */
export function setGoalArea(projectName: string, goal: string, areaId: string | null): string {
  const areas = editableAreas(loadOrg(projectName))
  const target = areaId ? areas.find((area) => area.id === areaId) : null
  if (areaId && !target) {
    throw new Error(`Area "${areaId}" does not exist.`)
  }
  for (const area of areas) {
    area.goals = area.goals.filter((name) => name !== goal)
    if (area.manager === goal && area !== target) {
      area.manager = ''
    }
  }
  target?.goals.push(goal)
  saveOrg(projectName, areas, { action: 'org.move_goal', goal, area: areaId })
  return target ? `Moved ${goal} to ${target.title}.` : `Removed ${goal} from its area.`
}

export function upsertArea(
  projectName: string,
  input: XosGoalArea,
  knownGoals: ReadonlySet<string>
): string {
  const id = input.id.trim()
  const title = input.title.trim()
  if (!AREA_ID.test(id)) {
    throw new Error('Area ids use lowercase letters, digits and dashes.')
  }
  if (!title) {
    throw new Error('The area needs a title.')
  }
  const manager = input.manager.trim()
  if (manager && !knownGoals.has(manager)) {
    throw new Error(`The manager "${manager}" is not a goal in this project.`)
  }
  const areas = editableAreas(loadOrg(projectName))
  const existing = areas.find((area) => area.id === id)
  const area: OrgArea = existing ?? { id, title, description: '', manager: '', goals: [] }
  area.title = title
  area.description = input.description.trim()
  area.manager = manager
  if (manager) {
    // A manager belongs to the area it manages, listed first.
    for (const other of areas) {
      other.goals = other.goals.filter((name) => name !== manager)
    }
    area.goals = [manager, ...area.goals.filter((name) => name !== manager)]
  }
  if (!existing) {
    areas.push(area)
  }
  saveOrg(projectName, areas, { action: existing ? 'org.edit_area' : 'org.create_area', area: id })
  return existing ? `Saved ${title}.` : `Created area ${title}.`
}

/**
 * Resolves a CLI --area value to an area id, creating the area when the project does not have it
 * yet (bots name areas by title, e.g. --area Engineering). An empty input means "no area".
 */
export function resolveOrCreateAreaId(
  project: XosProject,
  area: string
): { ok: true; areaId: string | null } | { ok: false; error: string } {
  const trimmed = area.trim()
  if (!trimmed) {
    return { ok: true, areaId: null }
  }
  const lower = trimmed.toLowerCase()
  const existing = project.areas.find(
    (candidate) => candidate.id.toLowerCase() === lower || candidate.title.toLowerCase() === lower
  )
  if (existing) {
    return { ok: true, areaId: existing.id }
  }
  const id = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!AREA_ID.test(id)) {
    return { ok: false, error: `Area "${trimmed}" is not a valid area name.` }
  }
  try {
    upsertArea(
      project.root,
      { id, title: trimmed, description: '', manager: '' },
      new Set(project.goals.map((goal) => goal.goal))
    )
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, areaId: id }
}

/** Deletes an area; its goals become unassigned (they are not touched otherwise). */
export function removeArea(projectName: string, areaId: string): string {
  const areas = editableAreas(loadOrg(projectName))
  const area = areas.find((candidate) => candidate.id === areaId)
  if (!area) {
    throw new Error(`Area "${areaId}" does not exist.`)
  }
  saveOrg(
    projectName,
    areas.filter((candidate) => candidate !== area),
    { action: 'org.remove_area', area: areaId, goals: area.goals }
  )
  return `Removed area ${area.title}; its ${area.goals.length} goals are now unassigned.`
}
