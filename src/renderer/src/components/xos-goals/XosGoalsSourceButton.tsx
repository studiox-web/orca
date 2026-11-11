// XOS fork: the "Goals" button in the Tasks source bar, next to GitHub/GitLab/Linear/Jira.
import React from 'react'
import { Workflow } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { setXosItemsView, useXosItemsView } from './xos-items-source'

export function XosGoalsSourceButton(): React.JSX.Element | null {
  const { active } = useXosItemsView()
  if (!window.api.xosGoals) {
    return null
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setXosItemsView({ active: true, focusStageId: null })}
          data-task-source="xos-goals"
          aria-label="Goals: work items from your automation queues"
          aria-pressed={active}
          className={cn(
            'group flex h-8 w-8 items-center justify-center rounded-md border transition',
            active
              ? 'border-foreground/40 bg-muted/70 text-foreground shadow-sm'
              : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
          )}
        >
          <Workflow className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Goals: work items from your automation queues
      </TooltipContent>
    </Tooltip>
  )
}
