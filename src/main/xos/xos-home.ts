// XOS fork: the root of all fork-owned state, ~/.orca-xos.
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export function xosHome(): string {
  if (process.env.ORCA_XOS_HOME) {
    return process.env.ORCA_XOS_HOME
  }
  // Upstream tests drive the dispatch hooks too; they must never write to the real ~/.orca-xos.
  if (process.env.VITEST) {
    return join(tmpdir(), `orca-xos-vitest-${process.pid}`)
  }
  return join(homedir(), '.orca-xos')
}
