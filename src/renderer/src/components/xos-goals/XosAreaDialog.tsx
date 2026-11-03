// XOS fork: create, edit or remove a business area (org.json). Removing an area leaves its goals
// unassigned; nothing else about them changes.
import React, { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { XosGoalArea, XosProject } from '../../../../shared/xos-goals-types'
import type { XosGoalActions } from './XosGoalViewerParts'

const NO_MANAGER = '__none__'

export function areaIdFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
}

/** `area` null = create a new area. */
export function XosAreaDialog({
  open,
  area,
  project,
  actions,
  onClose
}: {
  open: boolean
  area: XosGoalArea | null
  project: XosProject
  actions: XosGoalActions
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [manager, setManager] = useState(NO_MANAGER)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(area?.title ?? '')
      setDescription(area?.description ?? '')
      setManager(area?.manager || NO_MANAGER)
      setConfirmRemove(false)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, area?.id])

  const submit = (work: () => Promise<boolean>): void => {
    setPending(true)
    void work().then((ok) => {
      setPending(false)
      if (ok) {
        onClose()
      }
    })
  }
  const id = area?.id ?? areaIdFromTitle(title)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{area ? `Edit ${area.title}` : 'New area'}</DialogTitle>
          <DialogDescription>
            Areas group goals under a manager on the org chart. Saved in this project&apos;s
            org.json; the previous version is kept in org-history/.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Title</span>
          <Input
            id="xos-area-title"
            name="xos-area-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {!area && id && <span className="text-muted-foreground">id: {id}</span>}
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Description</span>
          <Input
            id="xos-area-description"
            name="xos-area-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Manager goal</span>
          <Select value={manager} onValueChange={setManager}>
            <SelectTrigger className="w-full" aria-label="Manager goal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
              <SelectItem value={NO_MANAGER}>No manager</SelectItem>
              {project.goals.map((goal) => (
                <SelectItem key={goal.goal} value={goal.goal}>
                  {goal.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="sm:justify-between">
          {area ? (
            <Button
              type="button"
              variant={confirmRemove ? 'destructive' : 'destructive-chip'}
              disabled={pending}
              onClick={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true)
                  return
                }
                submit(() =>
                  actions.areaOp({ kind: 'remove', projectKey: project.key, areaId: area.id })
                )
              }}
            >
              <Trash2 className="size-4" />
              {confirmRemove ? 'Click again: goals become unassigned' : 'Remove area'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !title.trim() || !id}
              onClick={() =>
                submit(() =>
                  actions.areaOp({
                    kind: 'upsert',
                    projectKey: project.key,
                    area: {
                      id,
                      title,
                      description,
                      manager: manager === NO_MANAGER ? '' : manager
                    }
                  })
                )
              }
            >
              {area ? 'Save' : 'Create area'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
