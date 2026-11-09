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
            <span>Confirm Remove Worker</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-xs pt-2 text-muted-foreground">
              <p>
                Are you sure you want to remove worker <strong>{worker?.name}</strong>?
              </p>
              {dependentWorkers.length > 0 ? (
                <p className="rounded border border-warning/40 bg-warning/10 p-2 text-warning-foreground">
                  This worker is configured as a dependency for:{' '}
                  <strong>{dependentWorkers.map((w) => w.name).join(', ')}</strong>. Removing it
                  will also remove those dependency references.
                </p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" data-testid="confirm-delete-worker" onClick={onConfirm}>
            Confirm Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
