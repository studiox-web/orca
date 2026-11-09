import React from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import type { AutomationWorkspaceMode } from '../../../../shared/automations-types'
import type { CoordinatedAutomationInheritedDefaults } from '../../../../shared/coordinated-automation-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { translate } from '@/i18n/i18n'

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | string

export type LaunchConfigFormState = {
  overrideAgent: boolean
  agentId: TuiAgent
  overrideModel: boolean
  modelExplicitNone: boolean
  model: string
  overrideEffort: boolean
  effortExplicitNone: boolean
  effort: ReasoningEffort
  overrideWorkspace: boolean
  workspaceMode: AutomationWorkspaceMode
  overrideTimeout: boolean
  timeoutExplicitNone: boolean
  timeoutMinutes: string
}

type AutomationWorkerLaunchConfigFieldsProps = {
  state: LaunchConfigFormState
  onChange: React.Dispatch<React.SetStateAction<LaunchConfigFormState>>
  parentDefaults?: CoordinatedAutomationInheritedDefaults
}

export function AutomationWorkerLaunchConfigFields({
  state,
  onChange,
  parentDefaults
}: AutomationWorkerLaunchConfigFieldsProps): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-border/50 p-3">
      <Label className="font-semibold text-xs">
        {translate('auto.components.automations.workers.launchConfigTitle', 'Launch Configuration')}
      </Label>

      {/* 1. Agent */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate('auto.components.automations.workers.overrideAgent', 'Override agent')}
          </span>
          <Switch
            checked={state.overrideAgent}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideAgent: val }))}
            aria-label="Override agent"
          />
        </div>
        {state.overrideAgent ? (
          <Select
            value={state.agentId}
            onValueChange={(val) => onChange((prev) => ({ ...prev, agentId: val as TuiAgent }))}
          >
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

      {/* 2. Model */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate('auto.components.automations.workers.overrideModel', 'Override model')}
          </span>
          <Switch
            checked={state.overrideModel}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideModel: val }))}
            aria-label="Override model"
          />
        </div>
        {state.overrideModel ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={state.model}
                disabled={state.modelExplicitNone}
                onChange={(e) => {
                  const val = e.target.value
                  onChange((prev) => ({ ...prev, model: val }))
                }}
                placeholder="e.g. claude-3-5-sonnet, gpt-5.6-sol"
                className="font-mono text-xs"
              />
              <button
                type="button"
                className={`text-2xs px-2 py-1 rounded border ${
                  state.modelExplicitNone
                    ? 'bg-muted border-primary text-primary font-medium'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() =>
                  onChange((prev) => ({ ...prev, modelExplicitNone: !prev.modelExplicitNone }))
                }
              >
                None
              </button>
            </div>
          </div>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            Inheriting parent default model ({parentDefaults?.model ?? 'Default'})
          </div>
        )}
      </div>

      {/* 3. Reasoning Effort */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate(
              'auto.components.automations.workers.overrideEffort',
              'Override reasoning effort'
            )}
          </span>
          <Switch
            checked={state.overrideEffort}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideEffort: val }))}
            aria-label="Override reasoning effort"
          />
        </div>
        {state.overrideEffort ? (
          <Select
            value={state.effortExplicitNone ? 'none' : state.effort}
            onValueChange={(val) => {
              if (val === 'none') {
                onChange((prev) => ({ ...prev, effortExplicitNone: true }))
              } else {
                onChange((prev) => ({
                  ...prev,
                  effortExplicitNone: false,
                  effort: val as ReasoningEffort
                }))
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Explicit None (disabled)</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            Inheriting parent default effort ({parentDefaults?.reasoningEffort ?? 'Default'})
          </div>
        )}
      </div>

      {/* 4. Workspace Mode */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate(
              'auto.components.automations.workers.overrideWorkspace',
              'Override workspace policy'
            )}
          </span>
          <Switch
            checked={state.overrideWorkspace}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideWorkspace: val }))}
            aria-label="Override workspace policy"
          />
        </div>
        {state.overrideWorkspace ? (
          <Select
            value={state.workspaceMode}
            onValueChange={(val) => {
              onChange((prev) => ({
                ...prev,
                workspaceMode: val as AutomationWorkspaceMode
              }))
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="existing">
                {translate('auto.components.automations.workspace.existing', 'Existing workspace')}
              </SelectItem>
              <SelectItem value="new_per_run">
                {translate(
                  'auto.components.automations.workspace.newPerRun',
                  'New worktree per run'
                )}
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            Inheriting parent default ({parentDefaults?.workspaceMode ?? 'existing'})
          </div>
        )}
      </div>

      {/* 5. Timeout */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate('auto.components.automations.workers.overrideTimeout', 'Override timeout')}
          </span>
          <Switch
            checked={state.overrideTimeout}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideTimeout: val }))}
            aria-label="Override timeout"
          />
        </div>
        {state.overrideTimeout ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="1"
              disabled={state.timeoutExplicitNone}
              value={state.timeoutMinutes}
              onChange={(e) => {
                const val = e.target.value
                onChange((prev) => ({ ...prev, timeoutMinutes: val }))
              }}
              placeholder="30"
              className="text-xs"
            />
            <span className="text-2xs text-muted-foreground">min</span>
            <button
              type="button"
              className={`text-2xs px-2 py-1 rounded border ${
                state.timeoutExplicitNone
                  ? 'bg-muted border-primary text-primary font-medium'
                  : 'border-border text-muted-foreground'
              }`}
              onClick={() =>
                onChange((prev) => ({ ...prev, timeoutExplicitNone: !prev.timeoutExplicitNone }))
              }
            >
              None
            </button>
          </div>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            Inheriting parent default timeout (
            {parentDefaults?.timeoutSeconds
              ? `${Math.round(parentDefaults.timeoutSeconds / 60)}m`
              : 'None'}
            )
          </div>
        )}
      </div>
    </div>
  )
}
