import React from 'react'
import { RotateCcw, HardDrive, Clock, Brain, Bot } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentIcon } from '@/lib/agent-catalog'
import type {
  ChildLaunchConfigField,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults
} from '../../../../shared/coordinated-automation-types'
import { translate } from '@/i18n/i18n'

type WorkerConfigGridProps = {
  child: CoordinatedAutomationChildDefinition
  parentDefaults?: CoordinatedAutomationInheritedDefaults
  isEditing?: boolean
  onResetField?: (childId: string, field: ChildLaunchConfigField) => void
}

function ProvenanceBadge({
  isOverridden,
  isExplicitNone
}: {
  isOverridden: boolean
  isExplicitNone: boolean
}): React.JSX.Element {
  if (isOverridden && isExplicitNone) {
    return (
      <Badge
        variant="outline"
        className="border-status-warning-border bg-status-warning-background text-status-warning-text text-3xs"
      >
        {translate('auto.components.automations.workers.overriddenNone', 'Overridden (None)')}
      </Badge>
    )
  }
  if (isOverridden) {
    return (
      <Badge variant="outline" className="border-primary/50 text-primary text-3xs">
        {translate('auto.components.automations.workers.explicitOverride', 'Overridden')}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-3xs">
      {translate('auto.components.automations.workers.inherited', 'Inherited')}
    </Badge>
  )
}

function ResetFieldButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-5 gap-1 px-1 text-3xs text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={onClick}
    >
      <RotateCcw className="size-2.5" />
      <span>{translate('auto.components.automations.workers.reset', 'Reset')}</span>
    </Button>
  )
}

export function WorkerConfigGrid({
  child,
  parentDefaults,
  isEditing = false,
  onResetField
}: WorkerConfigGridProps): React.JSX.Element {
  // Agent
  const isAgentOverridden = child.launchConfig.provenance?.agentId === 'overridden'
  const isAgentExplicitNone = child.launchConfig.agentId === null
  const effectiveAgent = isAgentExplicitNone
    ? null
    : (child.launchConfig.agentId ?? parentDefaults?.agentId ?? null)

  // Model
  const isModelOverridden = child.launchConfig.provenance?.model === 'overridden'
  const isModelExplicitNone = child.launchConfig.model === null
  const effectiveModel = isModelExplicitNone
    ? null
    : (child.launchConfig.model ?? parentDefaults?.model ?? null)

  // Reasoning Effort
  const isEffortOverridden = child.launchConfig.provenance?.reasoningEffort === 'overridden'
  const isEffortExplicitNone = child.launchConfig.reasoningEffort === null
  const effectiveEffort = isEffortExplicitNone
    ? null
    : (child.launchConfig.reasoningEffort ?? parentDefaults?.reasoningEffort ?? null)

  // Workspace Mode
  const isWorkspaceOverridden = child.launchConfig.provenance?.workspaceMode === 'overridden'
  const isWorkspaceExplicitNone = child.launchConfig.workspaceMode === null
  const effectiveWorkspace = isWorkspaceExplicitNone
    ? null
    : (child.launchConfig.workspaceMode ?? parentDefaults?.workspaceMode ?? null)

  // Timeout Seconds
  const isTimeoutOverridden = child.launchConfig.provenance?.timeoutSeconds === 'overridden'
  const effectiveTimeout =
    child.launchConfig.timeoutSeconds ?? parentDefaults?.timeoutSeconds ?? null

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
      {/* 1. Agent & Model */}
      <div className="rounded border border-border/40 bg-muted/20 p-2 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground truncate">
            {translate('auto.components.automations.workers.agentAndModel', 'Agent / Model')}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {isEditing && isAgentOverridden && onResetField ? (
              <ResetFieldButton
                label={translate(
                  'auto.components.automations.workers.resetAgent',
                  'Reset agent to inherited'
                )}
                onClick={() => onResetField(child.id, 'agentId')}
              />
            ) : null}
            {isEditing && isModelOverridden && onResetField ? (
              <ResetFieldButton
                label={translate(
                  'auto.components.automations.workers.resetModel',
                  'Reset model to inherited'
                )}
                onClick={() => onResetField(child.id, 'model')}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-medium text-xs min-w-0">
          {effectiveAgent ? (
            <>
              <AgentIcon agent={effectiveAgent} size={14} />
              <span className="truncate">{effectiveAgent}</span>
            </>
          ) : (
            <div className="flex items-center gap-1 text-muted-foreground italic">
              <Bot className="size-3.5" />
              <span>
                {isAgentExplicitNone
                  ? translate('auto.components.automations.workers.noAgent', 'No agent')
                  : translate('auto.components.automations.workers.defaultAgent', 'Default agent')}
              </span>
            </div>
          )}

          {effectiveModel ? (
            <span
              className="truncate font-mono text-3xs text-muted-foreground max-w-[140px]"
              title={effectiveModel}
            >
              /{effectiveModel}
            </span>
          ) : isModelExplicitNone ? (
            <span className="font-mono text-3xs text-muted-foreground italic">/(none)</span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <ProvenanceBadge isOverridden={isAgentOverridden} isExplicitNone={isAgentExplicitNone} />
          {isModelOverridden ? (
            <ProvenanceBadge isOverridden={true} isExplicitNone={isModelExplicitNone} />
          ) : null}
        </div>
      </div>

      {/* 2. Reasoning Effort & Lane */}
      <div className="rounded border border-border/40 bg-muted/20 p-2 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground truncate">
            {translate('auto.components.automations.workers.effortAndLane', 'Effort & Lane')}
          </span>
          {isEditing && isEffortOverridden && onResetField ? (
            <ResetFieldButton
              label={translate(
                'auto.components.automations.workers.resetEffort',
                'Reset reasoning effort to inherited'
              )}
              onClick={() => onResetField(child.id, 'reasoningEffort')}
            />
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium min-w-0">
          <Brain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="capitalize">
            {effectiveEffort
              ? `effort: ${effectiveEffort}`
              : translate('auto.components.automations.workers.defaultEffort', 'effort: default')}
          </span>
          <Badge
            variant="outline"
            className="text-3xs uppercase tracking-wider text-muted-foreground"
          >
            {child.mutationClass}
          </Badge>
          {child.mutationLane ? (
            <span className="font-mono text-3xs text-muted-foreground truncate max-w-[100px]">
              lane:{child.mutationLane}
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex items-center gap-1">
          <ProvenanceBadge
            isOverridden={isEffortOverridden}
            isExplicitNone={isEffortExplicitNone}
          />
        </div>
      </div>

      {/* 3. Destination & Limits */}
      <div className="rounded border border-border/40 bg-muted/20 p-2 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground truncate">
            {translate(
              'auto.components.automations.workers.workspaceAndTimeout',
              'Workspace & Timeout'
            )}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {isEditing && isWorkspaceOverridden && onResetField ? (
              <ResetFieldButton
                label={translate(
                  'auto.components.automations.workers.resetWorkspace',
                  'Reset workspace to inherited'
                )}
                onClick={() => onResetField(child.id, 'workspaceMode')}
              />
            ) : null}
            {isEditing && isTimeoutOverridden && onResetField ? (
              <ResetFieldButton
                label={translate(
                  'auto.components.automations.workers.resetTimeout',
                  'Reset timeout to inherited'
                )}
                onClick={() => onResetField(child.id, 'timeoutSeconds')}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <HardDrive className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="capitalize truncate">
              {effectiveWorkspace
                ? effectiveWorkspace.replace('_', ' ')
                : translate(
                    'auto.components.automations.workers.defaultWorkspace',
                    'default workspace'
                  )}
            </span>
          </div>

          <div className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Clock className="size-3 shrink-0" aria-hidden="true" />
            <span>
              {effectiveTimeout != null
                ? `${Math.round(effectiveTimeout / 60)}m`
                : translate(
                    'auto.components.automations.workers.defaultTimeout',
                    'default timeout'
                  )}
            </span>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <ProvenanceBadge
            isOverridden={isWorkspaceOverridden}
            isExplicitNone={isWorkspaceExplicitNone}
          />
          {isTimeoutOverridden ? (
            <ProvenanceBadge isOverridden={true} isExplicitNone={false} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
