import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { electronViteConfig } from '../../../electron.vite.config'
import { MAIN_BUILD_ENTRY_POINTS } from '../../../config/build-plugins/main-build-entry-points'

const { name, version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

export default defineConfig({
  ...electronViteConfig,
  main: {
    ...electronViteConfig.main,
    plugins: [
      ...(electronViteConfig.main?.plugins ?? []),
      {
        name: 'coordinated-fixture-package',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'package.json',
            source: JSON.stringify({ name, version, main: 'index.js' })
          })
        }
      }
    ],
    build: {
      ...electronViteConfig.main?.build,
      outDir: 'out-coordinated/main',
      rollupOptions: {
        ...electronViteConfig.main?.build?.rollupOptions,
        input: {
          ...MAIN_BUILD_ENTRY_POINTS,
          index: resolve('tests/e2e/coordinated-automation-harness/coordinated-app-entry.ts')
        }
      }
    }
  },
  preload: {
    ...electronViteConfig.preload,
    build: { ...electronViteConfig.preload?.build, outDir: 'out-coordinated/preload' }
  },
  renderer: {
    ...electronViteConfig.renderer,
    build: { ...electronViteConfig.renderer?.build, outDir: 'out-coordinated/renderer' }
  }
})
