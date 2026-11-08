import { useEffect, useState } from 'react'
import { Network, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { XosOrgChartPage } from '../xos-goals/XosOrgChartPage'
import { AutomationsPageSurface } from './AutomationsPageSurface'
import { useAutomationsPageController } from './use-automations-page-controller'
import { UnifiedAutomationsList } from './UnifiedAutomationsList'

// XOS fork: Org chart is the default Automations view; the upstream list stays one click away.
export const XOS_VIEW_KEY = 'orca.xos.automationsView'
type XosAutomationView = 'goals' | 'org' | 'native'

export default function AutomationsPage(): React.JSX.Element {
  const controller = useAutomationsPageController()
  const unifiedEnabled = controller.store.settings?.unifiedAutomationSurface === true
  const [xosView, setXosView] = useState<XosAutomationView>(() => {
    const stored = window.localStorage.getItem(XOS_VIEW_KEY)
    if (stored === 'list' || stored === 'native') {
      return 'native'
    }
    if (stored === 'goals') {
      return unifiedEnabled ? 'goals' : 'org'
    }
    return unifiedEnabled ? 'goals' : 'org'
  })
  const [goalTarget, setGoalTarget] = useState<{
    projectKey: string
    goal: string | null
    create?: boolean
  } | null>(null)
  useEffect(() => window.localStorage.setItem(XOS_VIEW_KEY, xosView), [xosView])
  useEffect(() => {
    const openGoals = (): void => setXosView(unifiedEnabled ? 'goals' : 'org')
    window.addEventListener('orca:xos-open-goals', openGoals)
    return () => window.removeEventListener('orca:xos-open-goals', openGoals)
  }, [unifiedEnabled])
  useEffect(() => {
    if (!unifiedEnabled && xosView === 'goals') {
      setXosView('org')
    }
  }, [unifiedEnabled, xosView])
  if (xosView === 'org' && window.api.xosGoals) {
    return (
      <XosOrgChartPage
        initialTarget={goalTarget}
        onInitialTargetConsumed={() => setGoalTarget(null)}
        onShowList={() => setXosView(unifiedEnabled ? 'goals' : 'native')}
      />
    )
  }
  if (xosView === 'goals' && unifiedEnabled && window.api.xosGoals) {
    return (
      <UnifiedAutomationsList
        controller={controller}
        onShowOrg={() => {
          setGoalTarget(null)
          setXosView('org')
        }}
        onShowNative={() => setXosView('native')}
        onOpenGoal={(projectKey, goal) => {
          setGoalTarget({ projectKey, goal })
          setXosView('org')
        }}
        onOpenNative={() => setXosView('native')}
        editorsEnabled={controller.store.settings?.unifiedAutomationEditors === true}
        onCreateAutomation={() => {
          controller.editorActions.openCreateDialog()
          setXosView('native')
        }}
        onCreateGoal={(projectKey) => {
          setGoalTarget({ projectKey, goal: null, create: true })
          setXosView('org')
        }}
        onOpenGoalAdvanced={(projectKey) => {
          setGoalTarget(projectKey ? { projectKey, goal: null } : null)
          setXosView('org')
        }}
      />
    )
  }
  return (
    <div className="relative h-full min-h-0">
      {window.api.xosGoals ? (
        <div
          className="absolute top-5 z-10 flex gap-2 md:top-6"
          style={{ right: 'max(1.25rem, calc(var(--window-controls-width, 0px) + 0.75rem))' }}
        >
          {unifiedEnabled ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setXosView('goals')}>
              <Target className="size-4" />
              {translate('auto.components.automations.unified.goals', 'Goals')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setXosView('org')}>
            <Network className="size-4" />
            {translate('auto.components.automations.unified.orgChart', 'Org chart')}
          </Button>
        </div>
      ) : null}
      <AutomationsPageSurface controller={controller} />
    </div>
  )
}
