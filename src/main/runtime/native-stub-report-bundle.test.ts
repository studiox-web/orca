import { cpSync, mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { buildCoordinatedNativeStub } from '../../../config/scripts/build-coordinated-native-stub.mjs'
import { requireNativeStubReportBundle } from './native-stub-report-bundle'
import pin from './native-stub-report-bundle-pin.json'

beforeAll(() => buildCoordinatedNativeStub())
let root = ''
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each(['bundle', 'dependency'])(
  'refuses changed %s bytes even when its path is unchanged',
  (changed) => {
    root = mkdtempSync(join(tmpdir(), 'orca-stub-pin-'))
    const bundle = 'out-coordinated/native-stub/entry.cjs'
    for (const path of [bundle, ...pin.inputs.map((input) => input.path)]) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      cpSync(join(process.cwd(), path), join(root, path))
    }
    expect(requireNativeStubReportBundle(root)).toBe(join(root, bundle))
    appendFileSync(join(root, changed === 'bundle' ? bundle : pin.inputs[0].path), '\n// changed\n')
    expect(() => requireNativeStubReportBundle(root)).toThrow('native_stub_fixture_changed')
  }
)
