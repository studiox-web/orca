import React from 'react'
import { Bot, ChevronDown, FileCode2, Plug, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export type UnifiedGoalProjectChoice = { key: string; name: string }

type CreateKind = 'automation' | 'goal'

function CreateOption({
  value,
  title,
  description,
  icon,
  disabled = false,
  reason
}: {
  value: 'automation' | 'goal' | 'script' | 'external'
  title: string
  description: string
  icon: React.ReactNode
  disabled?: boolean
  reason?: string
}): React.JSX.Element {
  const descriptionId = `unified-create-${value}-description`
  return (
    <label
      className={cn(
        'flex min-w-0 gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-xs',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-accent'
      )}
    >
      <RadioGroupItem
        value={value}
        disabled={disabled}
        aria-label={title}
        aria-describedby={descriptionId}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </span>
        <span id={descriptionId} className="mt-1 block text-xs text-muted-foreground">
          {description}
        </span>
        {reason ? <span className="mt-2 block text-xs font-medium">{reason}</span> : null}
      </span>
    </label>
  )
}

export function UnifiedAutomationCreateDialog({
  open,
  goalProjects,
  goalProjectsLoading,
  goalProjectsError,
  onOpenChange,
  onCreateAutomation,
  onCreateGoal,
  onOpenGoalAdvanced
}: {
  open: boolean
  goalProjects: readonly UnifiedGoalProjectChoice[]
  goalProjectsLoading: boolean
  goalProjectsError: string | null
  onOpenChange: (open: boolean) => void
  onCreateAutomation: () => void
  onCreateGoal: (projectKey: string) => void
  onOpenGoalAdvanced: (projectKey: string | null) => void
}): React.JSX.Element {
  const [kind, setKind] = React.useState<CreateKind>('automation')
  const [projectKey, setProjectKey] = React.useState('')

  React.useEffect(() => {
    if (!open) {
      return
    }
    setKind('automation')
    setProjectKey('')
  }, [open])

  React.useEffect(() => {
    if (!open) {
      return
    }
    setProjectKey(goalProjects.length === 1 ? goalProjects[0].key : '')
  }, [goalProjects, open])

  const continueCreate = (): void => {
    if (kind === 'automation') {
      onCreateAutomation()
      return
    }
    if (projectKey) {
      onCreateGoal(projectKey)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" scrollable>
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>
            Choose a supported type. Each choice opens its existing editor and keeps its current
            storage and behavior.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={kind}
          onValueChange={(value) => {
            if (value === 'automation' || value === 'goal') {
              setKind(value)
            }
          }}
          aria-label="Creation type"
          className="grid gap-3 sm:grid-cols-2"
        >
          <CreateOption
            value="automation"
            title="Agent automation"
            description="Use Orca's existing host-first automation editor, including agent, model, schedule, grace, precheck, and setup controls."
            icon={<Bot className="size-4" aria-hidden />}
          />
          <CreateOption
            value="goal"
            title="Goal"
            description="Create an unscheduled local Goal from the existing project template."
            icon={<Target className="size-4" aria-hidden />}
          />
          <CreateOption
            value="script"
            title="Script"
            description="Scripts are visible for review only."
            reason="Unavailable until validation, cancellation, timeout, and artifact contracts exist."
            icon={<FileCode2 className="size-4" aria-hidden />}
            disabled
          />
          <CreateOption
            value="external"
            title="External automation"
            description="External managers remain authoritative for creating their jobs."
            reason="Create this automation in its external manager."
            icon={<Plug className="size-4" aria-hidden />}
            disabled
          />
        </RadioGroup>
        {kind === 'goal' ? (
          <section
            className="space-y-3 rounded-xl border bg-muted/20 p-4"
            aria-label="Goal options"
          >
            <div className="space-y-1">
              <label htmlFor="unified-goal-project" className="text-sm font-medium">
                Project
              </label>
              {goalProjectsLoading ? (
                <p className="text-xs text-muted-foreground">Loading local Goal projects…</p>
              ) : goalProjectsError ? (
                <p className="text-xs text-destructive">{goalProjectsError}</p>
              ) : goalProjects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No local project with an automations/goals folder is available.
                </p>
              ) : (
                <Select value={projectKey} onValueChange={setProjectKey}>
                  <SelectTrigger id="unified-goal-project" className="w-full" aria-label="Project">
                    <SelectValue placeholder="Choose a local Goal project" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
                    {goalProjects.map((project) => (
                      <SelectItem key={project.key} value={project.key}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Collapsible>
              <CollapsibleTrigger variant="row" className="px-2">
                <span>Advanced Goal options</span>
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 px-2 pb-2 text-xs text-muted-foreground">
                <p>
                  Goal Viewer keeps the current file, scheduling, pause/resume, archive, and run
                  management controls. This chooser does not replace or change those actions.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenGoalAdvanced(projectKey || null)}
                >
                  Open Goal workspace
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </section>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={continueCreate}
            disabled={kind === 'goal' && (!projectKey || goalProjectsLoading)}
          >
            {kind === 'automation'
              ? translate(
                  'auto.components.automations.AutomationsPage.newAutomation',
                  'New Automation'
                )
              : 'Continue to Goal details'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
