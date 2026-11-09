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
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults
} from '../../../../shared/coordinated-automation-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { translate } from '@/i18n/i18n'
import { AutomationWorkerExecutionPolicyFields } from './AutomationWorkerExecutionPolicyFields'

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
  overrideRetries: boolean
  maxRetries: string
  overrideReviewIterations: boolean
  maxReviewIterations: string
}

export function createInitialLaunchConfigFormState(
  worker: CoordinatedAutomationChildDefinition,
  parentDefaults?: CoordinatedAutomationInheritedDefaults
): LaunchConfigFormState {
  const cfg = worker.launchConfig
  const prov = cfg.provenance
  return {
    overrideAgent: prov?.agentId === 'overridden',
    agentId: cfg.agentId ?? parentDefaults?.agentId ?? 'claude',
    overrideModel: prov?.model === 'overridden',
    modelExplicitNone: cfg.model === null,
    model: cfg.model ?? '',
    overrideEffort: prov?.reasoningEffort === 'overridden',
    effortExplicitNone: cfg.reasoningEffort === null,
    effort: cfg.reasoningEffort ?? 'medium',
    overrideWorkspace: prov?.workspaceMode === 'overridden',
    workspaceMode: cfg.workspaceMode ?? parentDefaults?.workspaceMode ?? 'existing',
    overrideTimeout: prov?.timeoutSeconds === 'overridden',
    timeoutExplicitNone: cfg.timeoutSeconds === null,
    timeoutMinutes:
      typeof cfg.timeoutSeconds === 'number' && cfg.timeoutSeconds > 0
        ? String(Math.round(cfg.timeoutSeconds / 60))
        : '',
    overrideRetries: prov?.maxRetries === 'overridden',
    maxRetries: typeof cfg.maxRetries === 'number' ? String(cfg.maxRetries) : '',
    overrideReviewIterations: prov?.maxReviewIterations === 'overridden',
    maxReviewIterations:
      typeof cfg.maxReviewIterations === 'number' ? String(cfg.maxReviewIterations) : ''
  }
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
            aria-label={translate(
              'auto.components.automations.workers.overrideAgent',
              'Override agent'
            )}
          />
        </div>
        {state.overrideAgent ? (
          <Select
            value={state.agentId}
            onValueChange={(val) => onChange((prev) => ({ ...prev, agentId: val as TuiAgent }))}
          >
            <SelectTrigger
              className="w-full"
              aria-label={translate(
                'auto.components.automations.workers.agentSelectLabel',
                'Agent override'
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getAgentCatalog().map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  <div className="flex items-center gap-2">
                    <AgentIcon agent={entry.id} size={14} />
                    <span>{entry.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            {parentDefaults?.agentId
              ? translate(
                  'auto.components.automations.workers.inheritingAgent',
                  'Inheriting parent default agent ({{agent}})',
                  { agent: parentDefaults.agentId }
                )
              : translate(
                  'auto.components.automations.workers.inheritingAgentNone',
                  'Inherited (no agent specified)'
                )}
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
            aria-label={translate(
              'auto.components.automations.workers.overrideModel',
              'Override model'
            )}
          />
        </div>
        {state.overrideModel ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                id="worker-model-override-input"
                value={state.model}
                disabled={state.modelExplicitNone}
                onChange={(e) => {
                  const val = e.target.value
                  onChange((prev) => ({ ...prev, model: val }))
                }}
                placeholder="e.g. claude-3-7-sonnet, gpt-5.6-sol"
                aria-label={translate(
                  'auto.components.automations.workers.modelInputLabel',
                  'Worker model override'
                )}
                className="font-mono text-xs"
              />
              <button
                type="button"
                aria-pressed={state.modelExplicitNone}
                aria-label={translate(
                  'auto.components.automations.workers.modelExplicitNoneLabel',
                  'Set model to none'
                )}
                className={`text-2xs px-2 py-1 rounded border transition-colors ${
                  state.modelExplicitNone
                    ? 'bg-status-warning-background border-status-warning-border text-status-warning-text font-medium'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
                onClick={() =>
                  onChange((prev) => ({ ...prev, modelExplicitNone: !prev.modelExplicitNone }))
                }
              >
                {translate('auto.components.automations.workers.none', 'None')}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            {parentDefaults?.model
              ? translate(
                  'auto.components.automations.workers.inheritingModel',
                  'Inheriting parent default model ({{model}})',
                  { model: parentDefaults.model }
                )
              : translate(
                  'auto.components.automations.workers.inheritingModelNone',
                  'Inherited (no model specified)'
                )}
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
            aria-label={translate(
              'auto.components.automations.workers.overrideEffort',
              'Override reasoning effort'
            )}
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
            <SelectTrigger
              className="w-full"
              aria-label={translate(
                'auto.components.automations.workers.effortSelectLabel',
                'Reasoning effort override'
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {translate(
                  'auto.components.automations.workers.effortExplicitNone',
                  'Explicit None (disabled)'
                )}
              </SelectItem>
              <SelectItem value="low">
                {translate('auto.components.automations.workers.effortLow', 'Low')}
              </SelectItem>
              <SelectItem value="medium">
                {translate('auto.components.automations.workers.effortMedium', 'Medium')}
              </SelectItem>
              <SelectItem value="high">
                {translate('auto.components.automations.workers.effortHigh', 'High')}
              </SelectItem>
              <SelectItem value="xhigh">
                {translate('auto.components.automations.workers.effortXHigh', 'Extra High')}
              </SelectItem>
              <SelectItem value="max">
                {translate('auto.components.automations.workers.effortMax', 'Max')}
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            {parentDefaults?.reasoningEffort
              ? translate(
                  'auto.components.automations.workers.inheritingEffort',
                  'Inheriting parent default effort ({{effort}})',
                  { effort: parentDefaults.reasoningEffort }
                )
              : translate(
                  'auto.components.automations.workers.inheritingEffortNone',
                  'Inherited (no effort specified)'
                )}
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
            aria-label={translate(
              'auto.components.automations.workers.overrideWorkspace',
              'Override workspace policy'
            )}
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
            <SelectTrigger
              className="w-full"
              aria-label={translate(
                'auto.components.automations.workers.workspaceSelectLabel',
                'Workspace mode override'
              )}
            >
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
            {parentDefaults?.workspaceMode
              ? translate(
                  'auto.components.automations.workers.inheritingWorkspace',
                  'Inheriting parent default workspace ({{mode}})',
                  { mode: parentDefaults.workspaceMode }
                )
              : translate(
                  'auto.components.automations.workers.inheritingWorkspaceNone',
                  'Inherited (no workspace policy specified)'
                )}
          </div>
        )}
      </div>

      {/* 5. Execution Policies (Timeout, Retries, Review Iterations) */}
      <AutomationWorkerExecutionPolicyFields
        state={state}
        onChange={onChange}
        parentDefaults={parentDefaults}
      />
    </div>
  )
}
