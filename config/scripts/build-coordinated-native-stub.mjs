import { build } from 'esbuild'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'out-coordinated/native-stub/entry.cjs')
const pinPath = resolve(root, 'src/main/runtime/native-stub-report-bundle-pin.json')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export async function buildCoordinatedNativeStub({ writePin = false } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['tests/e2e/fixtures/golden-stub-agent/coordinated-report-entry.ts'],
    outfile: output,
    bundle: true,
    write: false,
    metafile: true,
    preserveSymlinks: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24'
  })
  const bytes = result.outputFiles[0].contents
  const pin = {
    bundleDigest: digest(bytes),
    inputs: Object.keys(result.metafile.inputs)
      .sort()
      .map((path) => ({
        path,
        digest: digest(readFileSync(resolve(root, path)))
      }))
  }
  const serialized = `${JSON.stringify(pin, null, 2)}\n`
  if (writePin) {
    writeFileSync(pinPath, serialized)
  } else if (readFileSync(pinPath, 'utf8') !== serialized) {
    throw new Error('Native stub source changed; review and regenerate its pin explicitly.')
  }
  mkdirSync(dirname(output), { recursive: true })
  const draft = `${output}.${randomUUID()}.tmp`
  writeFileSync(draft, bytes)
  renameSync(draft, output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildCoordinatedNativeStub({ writePin: process.argv.includes('--write-pin') })
  console.log('Built and verified the isolated native stub bundle (not executed).')
}
