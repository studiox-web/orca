import React from 'react'
import { RotateCcw, HardDrive, Clock } from 'lucide-react'
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

export function WorkerConfigGrid({
  child,
  parentDefaults,
  isEditing = false,
  onResetField
}: WorkerConfigGridProps): React.JSX.Element {
  const effectiveAgent = child.launchConfig.agentId ?? parentDefaults?.agentId ?? 'claude'
  const isAgentOverridden = child.launchConfig.provenance?.agentId === 'overridden'

  const effectiveModel = child.launchConfig.model ?? parentDefaults?.model ?? null
  const isModelOverridden = child.launchConfig.provenance?.model === 'overridden'

  const effectiveEffort =
    child.launchConfig.reasoningEffort ?? parentDefaults?.reasoningEffort ?? null
  const isEffortOverridden = child.launchConfig.provenance?.reasoningEffort === 'overridden'

  const effectiveWorkspaceMode =
    child.launchConfig.workspaceMode ?? parentDefaults?.workspaceMode ?? 'existing'
  const isWorkspaceModeOverridden = child.launchConfig.provenance?.workspaceMode === 'overridden'

  const effectiveTimeout =
    child.launchConfig.timeoutSeconds ?? parentDefaults?.timeoutSeconds ?? 1800
  const isTimeoutOverridden = child.launchConfig.provenance?.timeoutSeconds === 'overridden'

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
      {/* Agent & Model */}
      <div className="rounded border border-border/40 bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.automations.workers.agentAndModel', 'Agent / Model')}
          </span>
          {isEditing && isAgentOverridden && onResetField ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1 text-3xs text-muted-foreground hover:text-foreground"
              aria-label={translate(
                'auto.components.automations.workers.resetAgent',
                'Reset agent to inherited'
              )}
              onClick={() => onResetField(child.id, 'agentId')}
            >
              <RotateCcw className="size-2.5" />
              <span>Reset</span>
            </Button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-medium">
          <AgentIcon agent={effectiveAgent} size={14} />
          <span className="truncate">{effectiveAgent}</span>
          {effectiveModel ? (
            <span
              className="truncate font-mono text-3xs text-muted-foreground"
              title={effectiveModel}
            >
              /{effectiveModel}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <Badge
            variant="outline"
            className={`text-3xs ${
              isAgentOverridden || isModelOverridden || isEffortOverridden
                ? 'border-primary/40 text-primary'
                : 'text-muted-foreground'
            }`}
          >
            {isAgentOverridden || isModelOverridden || isEffortOverridden
              ? translate('auto.components.automations.workers.explicitOverride', 'Overridden')
              : translate('auto.components.automations.workers.inherited', 'Inherited')}
          </Badge>
          {effectiveEffort ? (
            <Badge variant="outline" className="font-mono text-3xs text-muted-foreground">
              effort:{effectiveEffort}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Destination / Workspace */}
      <div className="rounded border border-border/40 bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.automations.workers.workspacePolicy', 'Workspace policy')}
          </span>
          {isEditing && isWorkspaceModeOverridden && onResetField ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1 text-3xs text-muted-foreground hover:text-foreground"
              aria-label={translate(
                'auto.components.automations.workers.resetWorkspace',
                'Reset workspace to inherited'
              )}
              onClick={() => onResetField(child.id, 'workspaceMode')}
            >
              <RotateCcw className="size-2.5" />
              <span>Reset</span>
            </Button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-medium text-xs">
          <HardDrive className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="capitalize">{effectiveWorkspaceMode.replace('_', ' ')}</span>
        </div>
        <div className="mt-1">
          <Badge
            variant="outline"
            className={`text-3xs ${
              isWorkspaceModeOverridden ? 'border-primary/40 text-primary' : 'text-muted-foreground'
            }`}
          >
            {isWorkspaceModeOverridden
              ? translate('auto.components.automations.workers.explicitOverride', 'Overridden')
              : translate('auto.components.automations.workers.inherited', 'Inherited')}
          </Badge>
        </div>
      </div>

      {/* Mutation lane & Timeout */}
      <div className="rounded border border-border/40 bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.automations.workers.laneAndLimits', 'Lane & limits')}
          </span>
          {isEditing && isTimeoutOverridden && onResetField ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1 text-3xs text-muted-foreground hover:text-foreground"
              aria-label={translate(
                'auto.components.automations.workers.resetTimeout',
                'Reset timeout to inherited'
              )}
              onClick={() => onResetField(child.id, 'timeoutSeconds')}
            >
              <RotateCcw className="size-2.5" />
              <span>Reset</span>
            </Button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-medium text-xs">
          <Badge
            variant="outline"
            className="text-3xs uppercase tracking-wider text-muted-foreground"
          >
            {child.mutationClass}
          </Badge>
          {child.mutationLane ? (
            <span className="font-mono text-3xs text-muted-foreground">
              lane:{child.mutationLane}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
          <Clock className="size-3" />
          <span>{Math.round(effectiveTimeout / 60)}m timeout</span>
        </div>
      </div>
    </div>
  )
}
