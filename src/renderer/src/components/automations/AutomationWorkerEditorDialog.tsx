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
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import type {
  ChildDependency,
  ChildPromptSource,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults,
  MutationClass
} from '../../../../shared/coordinated-automation-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
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

  const [overrideAgent, setOverrideAgent] = useState(
    worker.launchConfig.provenance?.agentId === 'overridden'
  )
  const [agentId, setAgentId] = useState<TuiAgent>(
    worker.launchConfig.agentId ?? parentDefaults?.agentId ?? 'claude'
  )

  const [overrideModel, setOverrideModel] = useState(
    worker.launchConfig.provenance?.model === 'overridden'
  )
  const [model, setModel] = useState(worker.launchConfig.model ?? '')

  const [mutationClass, setMutationClass] = useState<MutationClass>(worker.mutationClass)
  const [mutationLane, setMutationLane] = useState(worker.mutationLane ?? '')

  const [dependencies, setDependencies] = useState<ChildDependency[]>(worker.dependencies)

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
      launchConfig: {
        ...worker.launchConfig,
        agentId: overrideAgent ? agentId : undefined,
        model: overrideModel ? model.trim() || null : undefined,
        provenance: {
          ...worker.launchConfig.provenance,
          agentId: overrideAgent ? 'overridden' : 'inherited',
          model: overrideModel ? 'overridden' : 'inherited'
        }
      }
    }

    onSave(saved)
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto scrollbar-sleek">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.automations.workers.editWorkerTitle', 'Configure Worker')}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2 text-xs">
        {/* Name & Role */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="worker-name">Name</Label>
            <Input
              id="worker-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Article Writer"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="worker-role">Role identifier</Label>
            <Input
              id="worker-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="content-writer"
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label htmlFor="worker-desc">Description</Label>
          <Input
            id="worker-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Produces editorial markdown drafts from research briefs"
          />
        </div>

        {/* Enabled switch */}
        <div className="flex items-center justify-between rounded-md border border-border/50 p-2.5">
          <div>
            <div className="font-medium text-foreground">Worker enabled</div>
            <div className="text-2xs text-muted-foreground">
              Disabled workers are skipped during workflow execution
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Toggle worker enabled"
          />
        </div>

        {/* Prompt Source */}
        <div className="space-y-2 rounded-md border border-border/50 p-3">
          <div className="flex items-center justify-between">
            <Label className="font-semibold">Prompt source</Label>
            <div className="flex rounded-md border border-border p-0.5 text-2xs">
              <button
                type="button"
                className={`rounded px-2 py-0.5 ${
                  promptKind === 'inline'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setPromptKind('inline')}
              >
                Inline
              </button>
              <button
                type="button"
                className={`rounded px-2 py-0.5 ${
                  promptKind === 'source_reference'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setPromptKind('source_reference')}
              >
                Source file
              </button>
            </div>
          </div>

          {promptKind === 'inline' ? (
            <div className="space-y-1">
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Enter the specialist instructions for this worker..."
                rows={4}
                className="font-mono text-xs"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="prompt-path">File path</Label>
                <Input
                  id="prompt-path"
                  value={promptPath}
                  onChange={(e) => setPromptPath(e.target.value)}
                  placeholder="automations/goals/writer/GOAL.md"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="prompt-digest">Pinned sha256 digest (optional)</Label>
                <Input
                  id="prompt-digest"
                  value={promptDigest}
                  onChange={(e) => setPromptDigest(e.target.value)}
                  placeholder="sha256:..."
                  className="font-mono text-3xs"
                />
              </div>
            </div>
          )}
        </div>

        {/* Agent & Model overrides */}
        <div className="space-y-3 rounded-md border border-border/50 p-3">
          <Label className="font-semibold">Execution provider</Label>

          {/* Agent */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">Override agent</span>
              <Switch
                checked={overrideAgent}
                onCheckedChange={setOverrideAgent}
                aria-label="Override agent"
              />
            </div>
            {overrideAgent ? (
              <Select value={agentId} onValueChange={(val) => setAgentId(val as TuiAgent)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAgentCatalog().map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center gap-2">
                        <AgentIcon agent={agent.id} size={14} />
                        <span>{agent.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-2xs text-muted-foreground italic">
                Inheriting parent default ({parentDefaults?.agentId ?? 'claude'})
              </div>
            )}
          </div>

          {/* Model */}
          <div className="space-y-1.5 border-t border-border/40 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">Override model</span>
              <Switch
                checked={overrideModel}
                onCheckedChange={setOverrideModel}
                aria-label="Override model"
              />
            </div>
            {overrideModel ? (
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-3-5-sonnet, gpt-5.6-sol"
                className="font-mono"
              />
            ) : (
              <div className="text-2xs text-muted-foreground italic">
                Inheriting parent default model ({parentDefaults?.model ?? 'Default'})
              </div>
            )}
          </div>
        </div>

        {/* Mutation Class & Lane */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Mutation class</Label>
            <Select
              value={mutationClass}
              onValueChange={(val) => setMutationClass(val as MutationClass)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only">Read-only</SelectItem>
                <SelectItem value="exclusive_writer">Exclusive writer</SelectItem>
                <SelectItem value="shared_writer">Shared writer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="worker-lane">Mutation lane</Label>
            <Input
              id="worker-lane"
              value={mutationLane}
              onChange={(e) => setMutationLane(e.target.value)}
              placeholder="content"
            />
          </div>
        </div>

        {/* Dependencies */}
        {otherWorkers.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border/50 p-3">
            <Label className="font-semibold">Dependencies</Label>
            <div className="max-h-36 space-y-1.5 overflow-y-auto scrollbar-sleek">
              {otherWorkers.map((other) => {
                const isDep = dependencies.some((d) => d.childId === other.id)
                return (
                  <label
                    key={other.id}
                    className="flex cursor-pointer items-center justify-between rounded p-1.5 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isDep}
                        onChange={() => handleToggleDependency(other.id)}
                        className="size-3.5 rounded border-border"
                      />
                      <span className="font-medium">{other.name}</span>
                      <span className="font-mono text-3xs text-muted-foreground">
                        ({other.role})
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
          Cancel
        </Button>
        <Button onClick={handleSave}>Save worker</Button>
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
