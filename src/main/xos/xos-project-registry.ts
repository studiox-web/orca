// XOS fork: every project Orca has shown, so the CLI can answer without a cwd or a live runtime (M12).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { xosHome } from './xos-home'

export type XosKnownProject = { root: string; name: string }

const registryPath = (): string => join(xosHome(), 'projects.json')

export function readKnownProjects(): XosKnownProject[] {
  try {
    const rows: XosKnownProject[] = JSON.parse(readFileSync(registryPath(), 'utf8'))
    return Array.isArray(rows) ? rows.filter((row) => typeof row?.root === 'string') : []
  } catch {
    return []
  }
}

/** Written only when something changed: the board rebuilds often. */
export function rememberProjects(projects: readonly { root: string; name?: string }[]): void {
  const known = new Map(readKnownProjects().map((row) => [row.root, row]))
  let changed = false
  for (const project of projects) {
    const name = project.name || basename(project.root)
    if (known.get(project.root)?.name !== name) {
      known.set(project.root, { root: project.root, name })
      changed = true
    }
  }
  if (changed) {
    mkdirSync(xosHome(), { recursive: true })
    writeFileSync(registryPath(), `${JSON.stringify([...known.values()], null, 2)}\n`, 'utf8')
  }
}
