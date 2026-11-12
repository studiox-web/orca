import { defineConfig } from '@stablyai/playwright-test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  retries: 0,
  projects: [
    {
      name: 'electron-headless',
      testMatch: ['coordinated-native-article.spec.ts'],
      metadata: { orcaHeadful: false }
    }
  ]
})
