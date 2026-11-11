// XOS fork: §3d. Orca writes only its own `# orca-xos managed` lines or lines the operator adopted.
// Adoption is one explicit act per line, remembered by the line's stable id.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { XOS_NOT_ADOPTED_PREFIX } from '../../shared/xos-goals-types'
import { xosHome } from './xos-home'

export const MANAGED_COMMENT = '# orca-xos managed'

const adoptedPath = (): string => join(xosHome(), 'crontab-adopted.json')

function readAdopted(): Set<string> {
  try {
    const ids: unknown = JSON.parse(readFileSync(adoptedPath(), 'utf8'))
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Null when every line may be written, adopting them first if the operator said so. */
export function guardCronWrite(args: {
  lines: readonly string[]
  targets: readonly { id: string; lineIndex: number; command: string }[]
  adopt: boolean
}): string | null {
  const adopted = readAdopted()
  const unowned = args.targets.filter(
    (entry) =>
      !adopted.has(entry.id) && !args.lines[entry.lineIndex - 1]?.startsWith(MANAGED_COMMENT)
  )
  if (unowned.length === 0) {
    return null
  }
  if (!args.adopt) {
    const count = unowned.length
    return `${XOS_NOT_ADOPTED_PREFIX} ${count} crontab line${count === 1 ? '' : 's'} not managed by Orca. Adopt ${count === 1 ? 'it' : 'them'} to change ${count === 1 ? 'it' : 'them'} from here.`
  }
  unowned.forEach((entry) => adopted.add(entry.id))
  mkdirSync(xosHome(), { recursive: true })
  writeFileSync(adoptedPath(), `${JSON.stringify([...adopted], null, 2)}\n`, 'utf8')
  return null
}
