import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { TaskPageListChrome } from './ListChrome'
import { TaskPageContent } from './Content'
// XOS fork: Tasks → Goals replaces the provider list while active.
import { TaskPageSourceBar } from './SourceBar'
import { XosItemsPage } from '../xos-goals/XosItemsPage'
import { useXosItemsView } from '../xos-goals/xos-items-source'
export function TaskPageFrame({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const xosGoalsActive = useXosItemsView().active && !!window.api.xosGoals
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Why: pt-1.5 (6px) aligns this 32px icon cluster's center with the sidebar Tasks row, 22px below the titlebar. */}
      <div className="mx-auto flex min-h-0 min-w-0 w-full flex-1 flex-col px-5 pt-1.5 pb-4 md:px-8 md:pt-1.5 md:pb-5">
        {xosGoalsActive ? (
          <>
            <TaskPageSourceBar model={model} />
            <XosItemsPage />
          </>
        ) : (
          <>
            <TaskPageListChrome model={model} />

            <TaskPageContent model={model} />
          </>
        )}
      </div>
    </div>
  )
}
