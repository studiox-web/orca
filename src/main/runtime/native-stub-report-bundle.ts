import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import pin from './native-stub-report-bundle-pin.json'

const digest = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex')

export function requireNativeStubReportBundle(appPath: string): string {
  const fixture = join(appPath, 'out-coordinated/native-stub/entry.cjs')
  if (
    realpathSync(fixture) !== resolve(fixture) ||
    digest(fixture) !== pin.bundleDigest ||
    pin.inputs.some(
      ({ path, digest: expected }) =>
        isAbsolute(path) ||
        path.split(/[\\/]/).includes('..') ||
        digest(join(appPath, path)) !== expected
    )
  ) {
    throw new Error('native_stub_fixture_changed')
  }
  return fixture
}
