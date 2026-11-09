import React from 'react'
import {
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Layers,
  FileText,
  AlertTriangle,
  CheckCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  ChildLaunchConfigField,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults
} from '../../../../shared/coordinated-automation-types'
import type { CoordinatedAutomationValidationError } from '../../../../shared/coordinated-automation-validation'
import { computePromptDigest } from './automation-workers-state'
import { WorkerConfigGrid } from './automation-worker-card-parts'
import { translate } from '@/i18n/i18n'

const EMPTY_CHILDREN: readonly CoordinatedAutomationChildDefinition[] = []
const EMPTY_ERRORS: readonly CoordinatedAutomationValidationError[] = []

type AutomationWorkerCardProps = {
  child: CoordinatedAutomationChildDefinition
  index: number
  totalCount: number
  parentDefaults?: CoordinatedAutomationInheritedDefaults
  isEditing?: boolean
  isSelected?: boolean
  allChildren?: readonly CoordinatedAutomationChildDefinition[]
  errors?: readonly CoordinatedAutomationValidationError[]
  onUpdate?: (childId: string, patch: Partial<CoordinatedAutomationChildDefinition>) => void
  onRemove?: (childId: string) => void
  onMoveUp?: (index: number) => void
  onMoveDown?: (index: number) => void
  onResetField?: (childId: string, field: ChildLaunchConfigField) => void
  onEditWorker?: (child: CoordinatedAutomationChildDefinition) => void
  className?: string
}

export function AutomationWorkerCard({
  child,
  index,
  totalCount,
  parentDefaults,
  isEditing = false,
  isSelected = false,
  allChildren = EMPTY_CHILDREN,
  errors = EMPTY_ERRORS,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onResetField,
  onEditWorker,
  className = ''
}: AutomationWorkerCardProps): React.JSX.Element {
  const childErrors = errors.filter((e) => e.childId === child.id)
  const hasErrors = childErrors.length > 0
  const promptDigest = computePromptDigest(child.promptSource)
  const childMap = new Map(allChildren.map((c) => [c.id, c]))

  return (
    <div
      role="listitem"
      id={`worker-card-${child.id}`}
      tabIndex={-1}
      aria-label={`Worker: ${child.name}`}
      data-testid={`worker-card-${child.id}`}
      data-child-id={child.id}
      className={`@container relative rounded-lg border transition-all ${
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      } ${
        hasErrors
          ? 'border-destructive/60 bg-destructive/5'
          : child.enabled
            ? 'border-border/70 bg-card'
            : 'border-border/40 bg-muted/20 opacity-70'
      } p-4 text-xs shadow-xs ${className}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant={child.enabled ? 'secondary' : 'outline'}
            className="font-semibold text-2xs uppercase tracking-wider"
          >
            {child.role}
          </Badge>
          <span
            className="truncate font-semibold text-sm text-foreground max-w-[200px]"
            title={child.name}
          >
            {child.name}
          </span>
          <span className="font-mono text-3xs text-muted-foreground truncate" title={child.id}>
            ({child.id})
          </span>
          {!child.enabled ? (
            <Badge variant="outline" className="text-3xs text-muted-foreground">
              {translate('auto.components.automations.workers.disabled', 'Disabled')}
            </Badge>
          ) : null}
        </div>

        {/* Action buttons in edit mode */}
        {isEditing ? (
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate(
                    'auto.components.automations.workers.moveUp',
                    'Move worker up'
                  )}
                  disabled={index === 0}
                  onClick={() => onMoveUp?.(index)}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('auto.components.automations.workers.moveUp', 'Move up')}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate(
                    'auto.components.automations.workers.moveDown',
                    'Move worker down'
                  )}
                  disabled={index === totalCount - 1}
                  onClick={() => onMoveDown?.(index)}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('auto.components.automations.workers.moveDown', 'Move down')}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-pressed={child.enabled}
                  aria-label={
                    child.enabled
                      ? translate(
                          'auto.components.automations.workers.disableWorker',
                          'Disable worker'
                        )
                      : translate(
                          'auto.components.automations.workers.enableWorker',
                          'Enable worker'
                        )
                  }
                  onClick={() => onUpdate?.(child.id, { enabled: !child.enabled })}
                >
                  <span
                    className={`size-2 rounded-full ${
                      child.enabled ? 'bg-status-success' : 'bg-muted-foreground'
                    }`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {child.enabled
                  ? translate('auto.components.automations.workers.disable', 'Disable')
                  : translate('auto.components.automations.workers.enable', 'Enable')}
              </TooltipContent>
            </Tooltip>

            {onEditWorker ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate(
                      'auto.components.automations.workers.editWorker',
                      'Edit worker {{name}}',
                      { name: child.name }
                    )}
                    onClick={() => onEditWorker(child)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {translate('auto.components.automations.workers.edit', 'Edit')}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {onRemove ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10"
                    aria-label={translate(
                      'auto.components.automations.workers.removeWorker',
                      'Remove worker {{name}}',
                      { name: child.name }
                    )}
                    onClick={() => onRemove(child.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {translate('auto.components.automations.workers.remove', 'Remove')}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>

      {child.description ? (
        <p className="mt-1 text-2xs text-muted-foreground">{child.description}</p>
      ) : null}

      {/* Errors for this worker */}
      {hasErrors ? (
        <div className="mt-2 space-y-1 rounded border border-destructive/40 bg-destructive/10 p-2 text-2xs text-destructive">
          {childErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              <span>{err.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Prompt source / digest */}
      <div className="mt-3 rounded border border-border/50 bg-muted/30 p-2.5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-1 text-2xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium min-w-0">
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {child.promptSource.kind === 'inline'
                ? translate('auto.components.automations.workers.inlinePrompt', 'Inline prompt')
                : translate(
                    'auto.components.automations.workers.sourceRefPrompt',
                    'Source reference: {{path}}',
                    { path: child.promptSource.path }
                  )}
            </span>
          </div>
          <span className="font-mono text-3xs shrink-0" title={promptDigest}>
            {promptDigest.slice(0, 20)}…
          </span>
        </div>

        <p className="mt-1.5 line-clamp-3 break-words text-xs text-foreground/90">
          {child.promptSource.kind === 'inline'
            ? child.promptSource.text || (
                <span className="italic text-muted-foreground">
                  {translate(
                    'auto.components.automations.workers.noPrompt',
                    '(No prompt provided)'
                  )}
                </span>
              )
            : child.promptSource.path}
        </p>
      </div>

      {/* Agent, Model, Effort, Workspace & Provenance */}
      <WorkerConfigGrid
        child={child}
        parentDefaults={parentDefaults}
        isEditing={isEditing}
        onResetField={onResetField}
      />

      {/* Dependencies */}
      {child.dependencies.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-2xs">
          <div className="flex items-center gap-1 font-medium text-muted-foreground">
            <Layers className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {translate('auto.components.automations.workers.dependencies', 'Dependencies:')}
            </span>
          </div>
          {child.dependencies.map((dep) => {
            const depChild = childMap.get(dep.childId)
            const depName = depChild ? depChild.name : dep.childId
            return (
              <Badge key={dep.childId} variant="outline" className="font-mono text-3xs">
                {depName} ({dep.condition ?? 'accepted'})
              </Badge>
            )
          })}
        </div>
      ) : null}

      {/* Stage acceptance */}
      {child.stageAcceptance &&
      (child.stageAcceptance.requiredArtifacts?.length ||
        child.stageAcceptance.requiredChecks?.length ||
        child.stageAcceptance.requiredApprovals?.length ||
        child.stageAcceptance.criteria?.length) ? (
        <div className="mt-2.5 rounded border border-border/40 bg-muted/15 p-2 text-2xs min-w-0">
          <div className="font-semibold text-3xs uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.automations.workers.stageAcceptance', 'Stage Acceptance')}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2 text-muted-foreground">
            {child.stageAcceptance.criteria?.map((crit, idx) => (
              <div
                key={crit.id ?? `crit-${idx}`}
                className="flex items-center gap-1 text-foreground"
              >
                <CheckCircle className="size-3 shrink-0 text-status-success" aria-hidden="true" />
                <span className="font-medium text-xs">{crit.description}</span>
              </div>
            ))}
            {child.stageAcceptance.requiredChecks?.map((chk, idx) => (
              <div
                key={chk.id ?? `chk-${idx}`}
                className="flex items-center gap-1 font-mono text-3xs"
              >
                <span className="text-muted-foreground">
                  {translate('auto.components.automations.workers.checkPrefix', 'check:')}
                </span>
                <span className="text-foreground">{chk.description || chk.id}</span>
              </div>
            ))}
            {child.stageAcceptance.requiredArtifacts?.map((art, idx) => (
              <div key={`art-${idx}`} className="flex items-center gap-1">
                <span className="font-medium text-foreground">
                  {translate('auto.components.automations.workers.artifactLabel', 'Artifact:')}
                </span>
                <span className="font-mono text-3xs">{art.kind}</span>
              </div>
            ))}
            {child.stageAcceptance.requiredApprovals?.map((app, idx) => (
              <div key={`app-${idx}`} className="flex items-center gap-1">
                <span className="font-medium text-foreground">
                  {translate('auto.components.automations.workers.approvalLabel', 'Approval:')}
                </span>
                <span className="font-mono text-3xs">{app.role}</span>
                {app.disallowAuthorApproval ? (
                  <Badge
                    variant="outline"
                    className="text-3xs text-status-warning border-status-warning-border"
                  >
                    {translate('auto.components.automations.workers.nonAuthor', 'non-author')}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
