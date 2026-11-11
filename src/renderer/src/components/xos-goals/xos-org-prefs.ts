// XOS fork: persisted Org chart preferences (project, card theme, layout).
import type { CardThemeSelection } from './xos-goal-card-logic'

export const ALL = 'all'
export const PREFS_KEY = 'orca.xos.orgChart.prefs'

export type Layout = 'chart' | 'areas' | 'pipeline' | 'analytics'

const isLayout = (value: unknown): value is Layout =>
  value === 'chart' || value === 'areas' || value === 'pipeline' || value === 'analytics'
export type Prefs = {
  projectKey: string
  cardTheme: CardThemeSelection
  layout: Layout
}

export function readPrefs(): Prefs {
  const fallback: Prefs = {
    projectKey: ALL,
    cardTheme: { theme: 'noir', imageMode: 'dark' },
    layout: 'chart'
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      projectKey: typeof stored.projectKey === 'string' ? stored.projectKey : fallback.projectKey,
      cardTheme: {
        theme: ['noir', 'corporate', 'retreat', 'festival'].includes(stored.cardTheme?.theme ?? '')
          ? stored.cardTheme!.theme
          : 'noir',
        imageMode: stored.cardTheme?.imageMode === 'light' ? 'light' : 'dark'
      },
      layout: isLayout(stored.layout) ? stored.layout : 'chart'
    }
  } catch {
    return fallback
  }
}
