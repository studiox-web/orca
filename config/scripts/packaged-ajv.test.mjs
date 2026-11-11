import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import { expect, it } from 'vitest'
import { removeTree } from '../../src/shared/windows-transient-lock-removal.ts'

const require = createRequire(import.meta.url)
const requireFromBuilder = createRequire(require.resolve('electron-builder/package.json'))
const { copyFiles, FileMatcher } = requireFromBuilder('app-builder-lib/out/fileMatcher')
const { createPackagedRuntimeNodeModuleResources } = require('../packaged-runtime-node-modules.cjs')

it('validates worker result schemas using copied runtime packages without checkout dependencies', async () => {
  const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-ajv-'))
  try {
    const resources = createPackagedRuntimeNodeModuleResources()
    const copyPackage = async (name) => {
      const destination = join('node_modules', name)
      const resource = resources.find((entry) => entry.to === destination)
      expect(resource, `Packaged runtime resource for ${name}`).toBeDefined()
      await copyFiles([
        new FileMatcher(
          resource.from,
          join(resourcesDir, destination),
          (value) => value,
          resource.filter
        )
      ])
    }
    await copyPackage('ajv')
    const manifest = JSON.parse(
      await readFile(join(resourcesDir, 'node_modules', 'ajv', 'package.json'), 'utf8')
    )
    for (const dependency of Object.keys(manifest.dependencies)) {
      await copyPackage(dependency)
    }
    const consumerDir = join(resourcesDir, 'app.asar.unpacked', 'out', 'main')
    await mkdir(consumerDir, { recursive: true })
    const entry = join(consumerDir, 'validate.cjs')
    await writeFile(
      entry,
      [
        "const assert = require('node:assert/strict')",
        "const Ajv = require('ajv')",
        'const validate = new Ajv({ allErrors: true }).compile({',
        "  type: 'object', required: ['sources'], additionalProperties: false,",
        "  properties: { sources: { type: 'array', uniqueItems: true, items: { $ref: '#/$defs/source' } } },",
        "  $defs: { source: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } }",
        '})',
        "assert.equal(validate({ sources: [{ url: 'https://example.com' }] }), true)",
        "assert.equal(validate({ sources: [{ url: 'same' }, { url: 'same' }] }), false)",
        'assert.equal(validate({ sources: [{ url: 42 }] }), false)',
        'assert.equal(validate({}), false)',
        "process.stdout.write('copied-ajv-validates')"
      ].join('\n')
    )
    const result = runProcessSync({
      program: process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
      args: ['--no-global-search-paths', entry],
      cwd: resourcesDir,
      timeoutMs: 15_000,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ORCA_BACKGROUND_LAUNCH: '1' }
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe('copied-ajv-validates')
  } finally {
    await removeTree(resourcesDir)
  }
})
