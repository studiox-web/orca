// XOS fork: state for the "Goals" source on the Tasks page (§3h). Kept outside Orca's TaskProvider
// union so upstream task code stays untouched: the Tasks page only asks "is Goals active?".
// The project choice is shared with Automations → Org chart (one switcher state, §3b menu map).
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { ALL, PREFS_KEY } from './xos-org-prefs'

const KEY = 'orca.xos.tasks.goals'

export type XosItemsLayout = 'board' | 'list'

export type XosItemsView = {
  active: boolean
  typeId: string | null
  /** Stage to highlight/scroll to when opened from a queue (e.g. a goal's "Open in Tasks"). */
  focusStageId: string | null
  layout: XosItemsLayout
}

function read(): XosItemsView {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<XosItemsView>
    return {
      active: stored.active === true,
      typeId: typeof stored.typeId === 'string' ? stored.typeId : null,
      focusStageId: null,
      layout: stored.layout === 'list' ? 'list' : 'board'
    }
  } catch {
    return { active: false, typeId: null, focusStageId: null, layout: 'board' }
  }
}

let state: XosItemsView = read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useXosItemsView(): XosItemsView {
  return useSyncExternalStore(subscribe, () => state)
}

export function setXosItemsView(patch: Partial<XosItemsView>): void {
  state = { ...state, ...patch }
  const { focusStageId: _focus, ...persisted } = state
  window.localStorage.setItem(KEY, JSON.stringify(persisted))
  listeners.forEach((listener) => listener())
}

export function readSharedProjectKey(): string {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as {
      projectKey?: unknown
    }
    return typeof stored.projectKey === 'string' ? stored.projectKey : ALL
  } catch {
    return ALL
  }
}

export function writeSharedProjectKey(projectKey: string): void {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as object
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...stored, projectKey }))
  } catch {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ projectKey }))
  }
}

/** Opens Tasks → Goals on one queue, e.g. from a goal's viewer. */
export function openXosItemsInTasks(target: {
  projectKey: string
  typeId: string
  stageId: string
}): void {
  writeSharedProjectKey(target.projectKey)
  setXosItemsView({ active: true, typeId: target.typeId, focusStageId: target.stageId })
  useAppStore.getState().openTaskPage()
}
