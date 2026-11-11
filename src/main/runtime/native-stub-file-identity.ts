import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

export function canonicalNativeStubPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('native_stub_absolute_path_required')
  }
  return realpathSync(path)
}
export function isWithinNativeStubPath(root: string, path: string): boolean {
  const child = relative(root, path)
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}
export function nativeStubFileDigest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
