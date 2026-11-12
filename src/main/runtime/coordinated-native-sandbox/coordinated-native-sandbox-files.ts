import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export function canonicalSandboxPath(path: string): string {
  if (!isAbsolute(path) || realpathSync(path) !== path) {
    throw new Error('coordinated_native_sandbox_canonical_path_required')
  }
  return path
}

export function sandboxDescendant(root: string, path: string): boolean {
  const child = relative(root, path)
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

export function sandboxFileDigest(path: string): string {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.nlink !== 1) {
    throw new Error('coordinated_native_sandbox_regular_file_required')
  }
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function sandboxInputDigest(root: string): string {
  const hash = createHash('sha256')
  let bytes = 0
  let entries = 0
  const visit = (path: string): void => {
    entries += 1
    if (entries > 2048) {
      throw new Error('coordinated_native_sandbox_input_too_large')
    }
    const stat = lstatSync(path)
    hash.update(
      JSON.stringify([
        relative(root, path),
        stat.isDirectory() ? 'directory' : 'file',
        stat.isFile() ? stat.size : 0
      ])
    )
    hash.update('\0')
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (['.codex', '.agents', '.git', 'AGENTS.md'].includes(name)) {
          throw new Error('coordinated_native_sandbox_configuration_in_input')
        }
        visit(join(path, name))
      }
    } else if (stat.isFile() && stat.nlink === 1) {
      bytes += stat.size
      if (bytes > 8 * 1024 * 1024) {
        throw new Error('coordinated_native_sandbox_input_too_large')
      }
      hash.update(readFileSync(path))
    } else {
      throw new Error('coordinated_native_sandbox_input_link_or_device')
    }
  }
  visit(root)
  return hash.digest('hex')
}
