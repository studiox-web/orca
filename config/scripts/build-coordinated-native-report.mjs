import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'out-coordinated/native-report/entry.cjs')
const result = await build({
  absWorkingDir: root,
  entryPoints: [
    'src/main/runtime/coordinated-native-sandbox/coordinated-native-report-helper-entry.ts'
  ],
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
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, bytes, { mode: 0o600 })
writeFileSync(`${output}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}\n`)
console.log('Built isolated report-only helper; no provider was started.')
