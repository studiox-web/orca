import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { electronViteConfig } from '../../../electron.vite.config'
import { MAIN_BUILD_ENTRY_POINTS } from '../../../config/build-plugins/main-build-entry-points'

export default defineConfig({
  ...electronViteConfig,
  main: {
    ...electronViteConfig.main,
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
