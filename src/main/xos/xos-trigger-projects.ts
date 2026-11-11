// XOS fork: which projects opted in to queue and inbox triggers. Off by default, so a fresh install
// starts nothing by itself. Electron-free: the CLI toggles it, and the runtime re-reads it each sweep.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit } from './xos-crontab'
import { xosHome } from './xos-home'

const triggersPath = (): string => join(xosHome(), 'queue-triggers.json')

export function readTriggerProjects(): string[] {
  try {
    const rows: unknown = JSON.parse(readFileSync(triggersPath(), 'utf8'))
    return Array.isArray(rows) ? rows.filter((row) => typeof row === 'string') : []
  } catch {
    return []
  }
}

export function setProjectTriggers(repoRoot: string, enabled: boolean): string[] {
  const roots = new Set(readTriggerProjects())
  if (enabled) {
    roots.add(repoRoot)
  } else {
    roots.delete(repoRoot)
  }
  mkdirSync(xosHome(), { recursive: true })
  writeFileSync(triggersPath(), `${JSON.stringify([...roots], null, 2)}\n`, 'utf8')
  audit({ action: enabled ? 'queue.triggers_on' : 'queue.triggers_off', repoRoot })
  return [...roots]
}
