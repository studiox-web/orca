// XOS fork: renderer bridge for the Automations → Org chart board.
import { ipcRenderer } from 'electron'
import type { XosGoalsApi } from '../../shared/xos-goals-types'

export const xosGoalsApi: XosGoalsApi = {
  getBoard: () => ipcRenderer.invoke('xos:goals:getBoard'),
  mutateCron: (mutation) => ipcRenderer.invoke('xos:goals:mutateCron', mutation),
  runNow: (request) => ipcRenderer.invoke('xos:goals:runNow', request),
  cardArt: (args) => ipcRenderer.invoke('xos:goals:cardArt', args),
  openFile: (args) => ipcRenderer.invoke('xos:goals:openFile', args),
  mutateGoal: (mutation) => ipcRenderer.invoke('xos:goals:mutateGoal', mutation),
  mutateArea: (mutation) => ipcRenderer.invoke('xos:goals:mutateArea', mutation),
  getAudit: (args) => ipcRenderer.invoke('xos:goals:getAudit', args),
  getItems: (args) => ipcRenderer.invoke('xos:items:list', args),
  getItem: (args) => ipcRenderer.invoke('xos:items:get', args),
  mutateItem: (mutation) => ipcRenderer.invoke('xos:items:mutate', mutation),
  listModels: (args) => ipcRenderer.invoke('xos:models:list', args),
  getRunConfig: (args) => ipcRenderer.invoke('xos:runtime:getRunConfig', args),
  setRunConfig: (args) => ipcRenderer.invoke('xos:runtime:setRunConfig', args),
  getRunAttempts: (args) => ipcRenderer.invoke('xos:runtime:getRunAttempts', args),
  getLegacyCommitPolicies: (args) => ipcRenderer.invoke('xos:runtime:legacyCommitPolicies', args),
  getTierModels: (args) => ipcRenderer.invoke('xos:runtime:tierModels', args),
  setModelTier: (args) => ipcRenderer.invoke('xos:runtime:setModelTier', args),
  previewAuto: (args) => ipcRenderer.invoke('xos:runtime:previewAuto', args),
  liveTail: (args) => ipcRenderer.invoke('xos:goals:liveTail', args),
  continueOn: (args) => ipcRenderer.invoke('xos:goals:continueOn', args),
  nextItem: (args) => ipcRenderer.invoke('xos:goals:nextItem', args),
  getPersonaStudio: (args) => ipcRenderer.invoke('xos:persona:studio', args),
  mutatePersona: (args) => ipcRenderer.invoke('xos:persona:mutate', args),
  personaImage: (args) => ipcRenderer.invoke('xos:persona:image', args),
  getRollup: () => ipcRenderer.invoke('xos:portfolio:rollup'),
  mutatePortfolio: (mutation) => ipcRenderer.invoke('xos:portfolio:mutate', mutation)
}
