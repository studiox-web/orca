// XOS fork: renderer bridge for the Automations → Org chart board.
import { ipcRenderer } from 'electron'
import type { XosGoalsApi } from '../../shared/xos-goals-types'

export const xosGoalsApi: XosGoalsApi = {
  getBoard: () => ipcRenderer.invoke('xos:goals:getBoard'),
  mutateCron: (mutation) => ipcRenderer.invoke('xos:goals:mutateCron', mutation),
  runNow: (request) => ipcRenderer.invoke('xos:goals:runNow', request),
  cardArt: (args) => ipcRenderer.invoke('xos:goals:cardArt', args),
  openFile: (args) => ipcRenderer.invoke('xos:goals:openFile', args)
}
