import { useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { XosOrgChartPage } from '../xos-goals/XosOrgChartPage'
import { AutomationsPageSurface } from './AutomationsPageSurface'
import { useAutomationsPageController } from './use-automations-page-controller'

// XOS fork: Org chart is the default Automations view; the upstream list stays one click away.
const XOS_VIEW_KEY = 'orca.xos.automationsView'

export default function AutomationsPage(): React.JSX.Element {
  const controller = useAutomationsPageController()
  const [xosView, setXosView] = useState<'org' | 'list'>(() =>
    window.localStorage.getItem(XOS_VIEW_KEY) === 'list' ? 'list' : 'org'
  )
  useEffect(() => window.localStorage.setItem(XOS_VIEW_KEY, xosView), [xosView])
  if (xosView === 'org' && window.api.xosGoals) {
    return <XosOrgChartPage onShowList={() => setXosView('list')} />
  }
  return (
    <div className="relative h-full min-h-0">
      {window.api.xosGoals && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute top-5 z-10 md:top-6"
          style={{
            right: 'max(1.25rem, calc(var(--window-controls-width, 0px) + 0.75rem))'
          }}
          onClick={() => setXosView('org')}
        >
          <Network className="size-4" />
          Org chart
        </Button>
      )}
      <AutomationsPageSurface controller={controller} />
    </div>
  )
}
