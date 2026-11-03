// XOS fork: "hire from blank". Creates automations/goals/<name>/ from the project's goal template
// (GOAL.md, STATUS.md, log/), files it under an area, then opens GOAL.md for editing.
import React, { useEffect, useState } from 'react'
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
import type { XosProject } from '../../../../shared/xos-goals-types'
import { areaIdFromTitle } from './XosAreaDialog'
import type { XosGoalActions } from './XosGoalViewerParts'

const NO_AREA = '__none__'
const AGENTS = ['codex', 'claude', 'gemini']

export function XosNewGoalDialog({
  open,
  project,
  actions,
  onClose,
  onCreated
}: {
  open: boolean
  project: XosProject
  actions: XosGoalActions
  onClose: () => void
  onCreated: (goal: string) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [agent, setAgent] = useState('codex')
  const [areaId, setAreaId] = useState(NO_AREA)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle('')
      setName('')
      setNameEdited(false)
      setAgent('codex')
      setAreaId(NO_AREA)
    }
  }, [open])

  const slug = nameEdited ? name : areaIdFromTitle(title)
  const taken =
    project.goals.some((goal) => goal.goal === slug) ||
    project.archived.some((goal) => goal.goal === slug)
  const valid = /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) && !taken

  const create = (): void => {
    setPending(true)
    void actions
      .goalOp({
        kind: 'create',
        projectKey: project.key,
        goal: slug,
        title: title.trim() || slug,
        agent,
        areaId: areaId === NO_AREA ? null : areaId
      })
      .then((ok) => {
        setPending(false)
        if (ok) {
          onClose()
          onCreated(slug)
        }
      })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New goal in {project.name}</DialogTitle>
          <DialogDescription>
            Creates the goal folder from automations/_template/goal.md and opens GOAL.md. It has no
            schedule until you add one.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Title</span>
          <Input
            id="xos-goal-title"
            name="xos-goal-title"
            placeholder="Festival Curator"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Folder name</span>
          <Input
            id="xos-goal-name"
            name="xos-goal-name"
            variant="code"
            value={slug}
            onChange={(event) => {
              setNameEdited(true)
              setName(event.target.value.toLowerCase())
            }}
          />
          {slug && !valid && (
            <span className="text-destructive">
              {taken
                ? 'A goal with this name already exists (or is archived).'
                : 'Use lowercase letters, digits and dashes.'}
            </span>
          )}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Agent</span>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="w-full" aria-label="Agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
                {AGENTS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Business area</span>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-full" aria-label="Business area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
                <SelectItem value={NO_AREA}>Unassigned</SelectItem>
                {project.areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || !valid} onClick={create}>
            Create goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
