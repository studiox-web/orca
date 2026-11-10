import { defineConfig } from '@stablyai/playwright-test'
import base from '../../playwright.config'

export default defineConfig({
  ...base,
  testDir: '.',
  globalSetup: undefined,
  globalTeardown: undefined,
  workers: 1,
  projects: [
    {
      name: 'electron-headless',
      testMatch: 'coordinated-app-lifecycle.spec.ts',
      metadata: { orcaHeadful: false }
    }
  ]
})
