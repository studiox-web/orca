import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  ChildDependency,
  ChildPromptSource,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults,
  MutationClass,
  StageAcceptanceContract
} from '../../../../shared/coordinated-automation-types'
import { AutomationWorkerPromptSourceFields } from './AutomationWorkerPromptSourceFields'
import {
  AutomationWorkerLaunchConfigFields,
  createInitialLaunchConfigFormState,
  type LaunchConfigFormState
} from './AutomationWorkerLaunchConfigFields'
import { AutomationWorkerStageAcceptanceFields } from './AutomationWorkerStageAcceptanceFields'
import { translate } from '@/i18n/i18n'

type AutomationWorkerEditorDialogProps = {
  open: boolean
  worker: CoordinatedAutomationChildDefinition | null
  allWorkers: readonly CoordinatedAutomationChildDefinition[]
  parentDefaults?: CoordinatedAutomationInheritedDefaults
  onOpenChange: (open: boolean) => void
  onSave: (saved: CoordinatedAutomationChildDefinition) => void
}

type AutomationWorkerEditorFormProps = {
  worker: CoordinatedAutomationChildDefinition
  allWorkers: readonly CoordinatedAutomationChildDefinition[]
  parentDefaults?: CoordinatedAutomationInheritedDefaults
  onCancel: () => void
  onSave: (saved: CoordinatedAutomationChildDefinition) => void
}

function AutomationWorkerEditorForm({
  worker,
  allWorkers,
  parentDefaults,
  onCancel,
  onSave
}: AutomationWorkerEditorFormProps): React.JSX.Element {
  const [name, setName] = useState(worker.name)
  const [role, setRole] = useState(worker.role)
  const [description, setDescription] = useState(worker.description ?? '')
  const [enabled, setEnabled] = useState(worker.enabled)

  const [promptKind, setPromptKind] = useState<'inline' | 'source_reference'>(
    worker.promptSource.kind
  )
  const [promptText, setPromptText] = useState(
    worker.promptSource.kind === 'inline' ? worker.promptSource.text : ''
  )
  const [promptPath, setPromptPath] = useState(
    worker.promptSource.kind === 'source_reference' ? worker.promptSource.path : ''
  )
  const [promptDigest, setPromptDigest] = useState(
    worker.promptSource.kind === 'source_reference' ? (worker.promptSource.digest ?? '') : ''
  )

  const [mutationClass, setMutationClass] = useState<MutationClass>(worker.mutationClass)
  const [mutationLane, setMutationLane] = useState(worker.mutationLane ?? '')
  const [dependencies, setDependencies] = useState<ChildDependency[]>(worker.dependencies)
  const [stageAcceptance, setStageAcceptance] = useState<StageAcceptanceContract>(
    worker.stageAcceptance ?? {}
  )

  const [launchConfigState, setLaunchConfigState] = useState<LaunchConfigFormState>(() =>
    createInitialLaunchConfigFormState(worker, parentDefaults)
  )

  const otherWorkers = allWorkers.filter((w) => w.id !== worker.id)

  const handleToggleDependency = (depId: string): void => {
    setDependencies((prev) => {
      const exists = prev.some((d) => d.childId === depId)
      if (exists) {
        return prev.filter((d) => d.childId !== depId)
      }
      return [...prev, { childId: depId, condition: 'accepted' }]
    })
  }

  const handleSave = (): void => {
    const nextPromptSource: ChildPromptSource =
      promptKind === 'inline'
        ? { kind: 'inline', text: promptText }
        : {
            kind: 'source_reference',
            path: promptPath,
            digest: promptDigest.trim() || undefined
          }

    const nextTimeoutSeconds = launchConfigState.overrideTimeout
      ? Number(launchConfigState.timeoutMinutes) > 0
        ? Number(launchConfigState.timeoutMinutes) * 60
        : undefined
      : undefined

    const nextRetries = launchConfigState.overrideRetries
      ? Number(launchConfigState.maxRetries) >= 0 && launchConfigState.maxRetries.trim() !== ''
        ? Number(launchConfigState.maxRetries)
        : undefined
      : undefined

    const nextReviewIterations = launchConfigState.overrideReviewIterations
      ? Number(launchConfigState.maxReviewIterations) >= 0 &&
        launchConfigState.maxReviewIterations.trim() !== ''
        ? Number(launchConfigState.maxReviewIterations)
        : undefined
      : undefined

    const saved: CoordinatedAutomationChildDefinition = {
      ...worker,
      name: name.trim() || worker.name,
      role: role.trim() || worker.role,
      description: description.trim() || undefined,
      enabled,
      promptSource: nextPromptSource,
      mutationClass,
      mutationLane: mutationLane.trim() || undefined,
      dependencies,
      stageAcceptance,
      launchConfig: {
        ...worker.launchConfig,
        agentId: launchConfigState.overrideAgent ? launchConfigState.agentId : undefined,
        model: launchConfigState.overrideModel
          ? launchConfigState.modelExplicitNone
            ? null
            : launchConfigState.model.trim() || null
          : undefined,
        reasoningEffort: launchConfigState.overrideEffort
          ? launchConfigState.effortExplicitNone
            ? null
            : launchConfigState.effort
          : undefined,
        workspaceMode: launchConfigState.overrideWorkspace
          ? launchConfigState.workspaceMode
          : undefined,
        timeoutSeconds: nextTimeoutSeconds,
        maxRetries: nextRetries,
        maxReviewIterations: nextReviewIterations,
        provenance: {
          ...worker.launchConfig.provenance,
          agentId: launchConfigState.overrideAgent ? 'overridden' : 'inherited',
          model: launchConfigState.overrideModel ? 'overridden' : 'inherited',
          reasoningEffort: launchConfigState.overrideEffort ? 'overridden' : 'inherited',
          workspaceMode: launchConfigState.overrideWorkspace ? 'overridden' : 'inherited',
          timeoutSeconds:
            launchConfigState.overrideTimeout && typeof nextTimeoutSeconds === 'number'
              ? 'overridden'
              : 'inherited',
          maxRetries: launchConfigState.overrideRetries ? 'overridden' : 'inherited',
          maxReviewIterations: launchConfigState.overrideReviewIterations
            ? 'overridden'
            : 'inherited'
        }
      }
    }

    onSave(saved)
  }

  return (
    <DialogContent scrollable className="max-h-[90vh] max-w-lg ">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.automations.workers.editWorkerTitle', 'Configure Worker')}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2 text-xs">
        {/* Name & Role */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="worker-name">
              {translate('auto.components.automations.workers.name', 'Name')}
            </Label>
            <Input
              id="worker-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={translate(
                'auto.components.automations.AutomationWorkerEditorDialog.2df734111e',
                'Article Writer'
              )}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="worker-role">
              {translate('auto.components.automations.workers.roleIdentifier', 'Role identifier')}
            </Label>
            <Input
              id="worker-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={translate(
                'auto.components.automations.AutomationWorkerEditorDialog.972c3e3f31',
                'content-writer'
              )}
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label htmlFor="worker-desc">
            {translate('auto.components.automations.workers.description', 'Description')}
          </Label>
          <Input
            id="worker-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={translate(
              'auto.components.automations.AutomationWorkerEditorDialog.f85c54dc3f',
              'Produces editorial markdown drafts from research briefs'
            )}
          />
        </div>

        {/* Enabled switch */}
        <div className="flex items-center justify-between rounded-md border border-border/50 p-2.5">
          <div>
            <div className="font-medium text-foreground">
              {translate('auto.components.automations.workers.workerEnabled', 'Worker enabled')}
            </div>
            <div className="text-2xs text-muted-foreground">
              {translate(
                'auto.components.automations.workers.workerEnabledHint',
                'Disabled workers are skipped during workflow execution'
              )}
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={translate(
              'auto.components.automations.workers.toggleWorkerEnabled',
              'Toggle worker enabled'
            )}
          />
        </div>

        {/* Prompt Source */}
        <AutomationWorkerPromptSourceFields
          promptKind={promptKind}
          promptText={promptText}
          promptPath={promptPath}
          promptDigest={promptDigest}
          onPromptKindChange={setPromptKind}
          onPromptTextChange={setPromptText}
          onPromptPathChange={setPromptPath}
          onPromptDigestChange={setPromptDigest}
        />

        {/* Launch Config: Agent, Model, Effort, Workspace, Timeout */}
        <AutomationWorkerLaunchConfigFields
          state={launchConfigState}
          onChange={setLaunchConfigState}
          parentDefaults={parentDefaults}
        />

        {/* Stage Acceptance */}
        <AutomationWorkerStageAcceptanceFields
          stageAcceptance={stageAcceptance}
          onChange={setStageAcceptance}
        />

        {/* Mutation Class & Lane */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="mutation-class-select">
              {translate('auto.components.automations.workers.mutationClass', 'Mutation class')}
            </Label>
            <Select
              value={mutationClass}
              onValueChange={(val) => {
                if (val === 'read_only' || val === 'exclusive_writer' || val === 'shared_writer') {
                  setMutationClass(val)
                }
              }}
            >
              <SelectTrigger id="mutation-class-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only">
                  {translate('auto.components.automations.workers.readOnly', 'Read-only')}
                </SelectItem>
                <SelectItem value="exclusive_writer">
                  {translate(
                    'auto.components.automations.workers.exclusiveWriter',
                    'Exclusive writer'
                  )}
                </SelectItem>
                <SelectItem value="shared_writer">
                  {translate('auto.components.automations.workers.sharedWriter', 'Shared writer')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="worker-lane">
              {translate('auto.components.automations.workers.mutationLane', 'Mutation lane')}
            </Label>
            <Input
              id="worker-lane"
              value={mutationLane}
              onChange={(e) => setMutationLane(e.target.value)}
              placeholder={translate(
                'auto.components.automations.AutomationWorkerEditorDialog.4152a632e4',
                'content'
              )}
            />
          </div>
        </div>

        {/* Dependencies with disambiguated labels */}
        {otherWorkers.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border/50 p-3">
            <Label>
              {translate('auto.components.automations.workers.dependencies', 'Dependencies')}
            </Label>
            <div className="max-h-36 space-y-1.5 overflow-y-auto scrollbar-sleek">
              {otherWorkers.map((other) => {
                const isDep = dependencies.some((d) => d.childId === other.id)
                return (
                  <label
                    key={other.id}
                    className="flex cursor-pointer items-center justify-between rounded p-1.5 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isDep}
                        onChange={() => handleToggleDependency(other.id)}
                        className="size-3.5 rounded border-border"
                      />
                      <span className="font-medium truncate">{other.name}</span>
                      <span className="font-mono text-3xs text-muted-foreground truncate">
                        ({other.role}) [{other.id}]
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {translate('auto.components.automations.workers.cancel', 'Cancel')}
        </Button>
        <Button onClick={handleSave}>
          {translate('auto.components.automations.workers.saveWorker', 'Save worker')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function AutomationWorkerEditorDialog({
  open,
  worker,
  allWorkers,
  parentDefaults,
  onOpenChange,
  onSave
}: AutomationWorkerEditorDialogProps): React.JSX.Element | null {
  if (!worker) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AutomationWorkerEditorForm
        key={worker.id}
        worker={worker}
        allWorkers={allWorkers}
        parentDefaults={parentDefaults}
        onCancel={() => onOpenChange(false)}
        onSave={(saved) => {
          onSave(saved)
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}
