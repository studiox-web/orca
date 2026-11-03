// XOS fork: IPC for stage A runtime settings: the model catalog, each automation's fallback chain,
// and the recorded attempts (which model each run used and how it ended).
import { ipcMain } from 'electron'
import type { XosAutomationRunConfig } from '../../shared/xos-runtime-types'
import { registerXosModelCatalogHandlers } from './xos-model-catalog'
import { readRunAttempts, readRunConfig, writeRunConfig } from './xos-runtime-store'

export function registerXosRuntimeHandlers(): void {
  registerXosModelCatalogHandlers()
  ipcMain.handle('xos:runtime:getRunConfig', (_event, args: { automationId: string }) =>
    readRunConfig(String(args?.automationId ?? ''))
  )
  ipcMain.handle(
    'xos:runtime:setRunConfig',
    (_event, args: { automationId: string; config: XosAutomationRunConfig }) => {
      if (typeof args?.automationId !== 'string' || !args.config) {
        return { ok: false, error: 'Missing automation or config.' }
      }
      try {
        writeRunConfig(args.automationId, args.config)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
  ipcMain.handle(
    'xos:runtime:getRunAttempts',
    (_event, args: { automationId: string; limit: number }) =>
      readRunAttempts(String(args?.automationId ?? ''), Number(args?.limit) || 20)
  )
}
