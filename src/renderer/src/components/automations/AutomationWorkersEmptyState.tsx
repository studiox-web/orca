import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
export function AutomationWorkersEmptyState({
  isEditing,
  onAddWorker: handleAddWorker
}: {
  isEditing: boolean
  onAddWorker: () => void
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground"
      data-testid="automation-workers-empty"
    >
      <p>
        {translate(
          'auto.components.automations.workers.emptyState',
          'No specialist workers defined yet.'
        )}
      </p>
      {isEditing ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={handleAddWorker}
        >
          <Plus className="size-3.5" />
          <span>
            {translate(
              'auto.components.automations.AutomationWorkersSection.77136392ed',
              'Add first worker'
            )}
          </span>
        </Button>
      ) : null}
    </div>
  )
}
