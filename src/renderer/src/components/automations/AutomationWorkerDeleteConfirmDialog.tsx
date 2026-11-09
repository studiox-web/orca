import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { CoordinatedAutomationChildDefinition } from '../../../../shared/coordinated-automation-types'
import { translate } from '@/i18n/i18n'

type AutomationWorkerDeleteConfirmDialogProps = {
  worker: CoordinatedAutomationChildDefinition | null
  dependentWorkers: readonly CoordinatedAutomationChildDefinition[]
  onCancel: () => void
  onConfirm: () => void
}

export function AutomationWorkerDeleteConfirmDialog({
  worker,
  dependentWorkers,
  onCancel,
  onConfirm
}: AutomationWorkerDeleteConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open={worker !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {translate(
                'auto.components.automations.workers.deleteConfirmTitle',
                'Confirm Remove Worker'
              )}
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-xs pt-2 text-muted-foreground">
              <p>
                {translate(
                  'auto.components.automations.workers.deleteConfirmQuestion',
                  'Are you sure you want to remove worker {{name}}?',
                  { name: worker?.name ?? '' }
                )}
              </p>
              {dependentWorkers.length > 0 ? (
                <p className="rounded border border-status-warning-border bg-status-warning-background p-2 text-status-warning-text">
                  {translate(
                    'auto.components.automations.workers.deleteDependentsWarning',
                    'This worker is configured as a dependency for: {{dependents}}. Removing it will also remove those dependency references.',
                    { dependents: dependentWorkers.map((w) => w.name).join(', ') }
                  )}
                </p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {translate('auto.components.automations.workers.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" data-testid="confirm-delete-worker" onClick={onConfirm}>
            {translate('auto.components.automations.workers.confirmRemove', 'Confirm Remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
