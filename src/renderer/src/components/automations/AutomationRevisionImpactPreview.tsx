import React from 'react'
import { Info, Lock, ArrowRight, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'

type AutomationRevisionImpactPreviewProps = {
  currentRevision: number
  hasModifications?: boolean
  activeRunId?: string | null
  activeRunRevision?: number | null
  className?: string
}

export function AutomationRevisionImpactPreview({
  currentRevision,
  hasModifications = false,
  activeRunId = null,
  activeRunRevision = null,
  className = ''
}: AutomationRevisionImpactPreviewProps): React.JSX.Element {
  const nextRevision = hasModifications ? currentRevision + 1 : currentRevision

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
          <Badge variant="secondary" className="font-mono text-3xs">
            Rev {currentRevision}
          </Badge>
          {hasModifications ? (
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
        {hasModifications
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
        <div className="mt-2.5 flex items-center gap-2 rounded border border-border/40 bg-card/60 px-2.5 py-1.5 text-2xs">
          <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">
            {translate(
              'auto.components.automations.workers.activeRunFrozen',
              'Active run {{runId}} is executing against frozen snapshot (Rev {{runRevision}})',
              { runId: activeRunId, runRevision: activeRunRevision ?? currentRevision }
            )}
          </span>
          <Badge variant="outline" className="ml-auto text-3xs text-muted-foreground">
            <ShieldCheck className="mr-1 size-3 text-green-500" aria-hidden="true" />
            {translate('auto.components.automations.workers.frozen', 'Frozen')}
          </Badge>
        </div>
      ) : null}
    </div>
  )
}
