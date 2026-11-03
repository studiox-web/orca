// XOS fork: IPC for stage A runtime settings: the model catalog, each automation's fallback chain,
// and the recorded attempts (which model each run used and how it ended).
import { ipcMain } from 'electron'
import type {
  XosAutoModeConfig,
  XosAutomationRunConfig,
  XosModelTier
} from '../../shared/xos-runtime-types'
import { readLegacyCommitPolicies } from './xos-auto-commit'
import { tierKey, xosPreviewAuto, xosTierModels } from './xos-auto-mode'
import { registerXosModelCatalogHandlers } from './xos-model-catalog'
import {
  cleanRunConfig,
  readRunAttempts,
  readRunConfig,
  writeRunConfig,
  writeTierEdit
} from './xos-runtime-store'

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

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
  ipcMain.handle('xos:runtime:legacyCommitPolicies', (_event, args: { repoPath: string }) =>
    typeof args?.repoPath === 'string' && args.repoPath
      ? readLegacyCommitPolicies(args.repoPath)
      : []
  )
  ipcMain.handle('xos:runtime:tierModels', (_event, args: { agents: string[] }) =>
    xosTierModels(strings(args?.agents).slice(0, 8))
  )
  ipcMain.handle(
    'xos:runtime:setModelTier',
    (_event, args: { agent: string; model: string; tier: XosModelTier | null }) => {
      if (typeof args?.agent === 'string' && typeof args.model === 'string') {
        writeTierEdit(tierKey(args.agent, args.model), args.tier)
      }
    }
  )
  ipcMain.handle('xos:runtime:previewAuto', (_event, args: { auto: XosAutoModeConfig }) => {
    const auto = cleanRunConfig({ auto: args?.auto }).auto
    return auto ? xosPreviewAuto(auto) : { candidates: [], reason: 'Auto mode is not set up.' }
  })
}
