import React from 'react'
import { Info, Lock, ArrowRight, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'

type AutomationRevisionImpactPreviewProps = {
  currentRevision?: number | null
  hasModifications?: boolean
  activeRunId?: string | null
  activeRunRevision?: number | null
  className?: string
}

export function AutomationRevisionImpactPreview({
  currentRevision = null,
  hasModifications = false,
  activeRunId = null,
  activeRunRevision = null,
  className = ''
}: AutomationRevisionImpactPreviewProps): React.JSX.Element {
  const isExistingRevision = typeof currentRevision === 'number' && currentRevision > 0
  const nextRevision =
    isExistingRevision && hasModifications ? currentRevision + 1 : currentRevision

  return (
    <div
      role="region"
      aria-label={translate(
        'auto.components.automations.workers.revisionImpactTitle',
        'Revision impact preview'
      )}
      className={`rounded-lg border border-border/60 bg-muted/30 p-3 text-foreground ${className}`}
      data-testid="automation-revision-impact-preview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-xs">
            {translate(
              'auto.components.automations.workers.revisionLifecycle',
              'Immutable definition revisions'
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {isExistingRevision ? (
            <Badge variant="secondary" className="font-mono text-3xs">
              Rev {currentRevision}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-3xs text-muted-foreground">
              {translate('auto.components.automations.workers.draftBadge', 'Draft')}
            </Badge>
          )}

          {isExistingRevision && hasModifications ? (
            <>
              <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
              <Badge
                variant="outline"
                className="border-primary/50 font-mono text-3xs text-primary"
              >
                Next: Rev {nextRevision}
              </Badge>
            </>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
        {!isExistingRevision
          ? translate(
              'auto.components.automations.workers.revisionDraftCopy',
              'This is an unsaved definition draft. Revisions start at 1 upon initial persistence and increment immutably with future saved changes.'
            )
          : hasModifications
            ? translate(
                'auto.components.automations.workers.revisionModifiedCopy',
                'Edits will be saved as Revision {{nextRevision}} and will only apply to future runs. Current and historical runs remain pinned to their immutable snapshots.',
                { nextRevision }
              )
            : translate(
                'auto.components.automations.workers.revisionUnmodifiedCopy',
                'This definition is at Revision {{currentRevision}}. Every run materializes an immutable snapshot so active and past runs are never mutated by definition edits.',
                { currentRevision }
              )}
      </p>

      {activeRunId ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-card/60 px-2.5 py-1.5 text-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground truncate">
              {typeof activeRunRevision === 'number'
                ? translate(
                    'auto.components.automations.workers.activeRunFrozenWithRev',
                    'Active run {{runId}} is executing against frozen snapshot (Rev {{runRevision}})',
                    { runId: activeRunId, runRevision: activeRunRevision }
                  )
                : translate(
                    'auto.components.automations.workers.activeRunFrozen',
                    'Active run {{runId}} is executing against frozen snapshot',
                    { runId: activeRunId }
                  )}
            </span>
          </div>
          <Badge variant="outline" className="text-3xs text-muted-foreground shrink-0">
            <ShieldCheck
              className="mr-1 size-3 text-emerald-500 dark:text-emerald-400"
              aria-hidden="true"
            />
            {translate('auto.components.automations.workers.frozen', 'Frozen')}
          </Badge>
        </div>
      ) : null}
    </div>
  )
}
