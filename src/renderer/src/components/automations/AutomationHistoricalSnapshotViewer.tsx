import React, { useState } from 'react'
import { Check, Copy, FileText, Hash, Shield, Layers, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentIcon } from '@/lib/agent-catalog'
import type { ResolvedAutomationRunSnapshot } from '../../../../shared/coordinated-automation-types'
import { translate } from '@/i18n/i18n'

type AutomationHistoricalSnapshotViewerProps = {
  snapshot: ResolvedAutomationRunSnapshot
  className?: string
}

export function AutomationHistoricalSnapshotViewer({
  snapshot,
  className = ''
}: AutomationHistoricalSnapshotViewerProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopyDigest = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snapshot.canonicalDigest)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard copy fallback
    }
  }

  return (
    <div
      role="region"
      aria-label={translate(
        'auto.components.automations.workers.historicalSnapshotTitle',
        'Historical run snapshot'
      )}
      className={`space-y-4 rounded-lg border border-border/70 bg-card p-4 shadow-sm ${className}`}
      data-testid="automation-historical-snapshot-viewer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary" aria-hidden="true" />
          <h4 className="font-semibold text-sm">
            {translate(
              'auto.components.automations.workers.historicalSnapshotHeader',
              'Frozen run snapshot (Revision {{revision}})',
              { revision: snapshot.definitionRevision }
            )}
          </h4>
          <Badge variant="outline" className="border-border/60 text-2xs text-muted-foreground">
            {translate('auto.components.automations.workers.readOnly', 'Read-only')}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-3xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          <span>{new Date(snapshot.createdAt).toISOString()}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-2xs">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-muted-foreground">
            {translate('auto.components.automations.workers.canonicalDigest', 'Canonical digest:')}
          </span>
          <span
            className="truncate font-mono text-3xs text-foreground"
            title={snapshot.canonicalDigest}
          >
            {snapshot.canonicalDigest}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-3xs text-muted-foreground hover:text-foreground"
          onClick={handleCopyDigest}
          aria-label={translate(
            'auto.components.automations.workers.copyDigest',
            'Copy canonical digest'
          )}
        >
          {copied ? (
            <>
              <Check className="size-3 text-green-500" />
              <span>{translate('auto.components.automations.workers.copied', 'Copied')}</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>{translate('auto.components.automations.workers.copy', 'Copy')}</span>
            </>
          )}
        </Button>
      </div>

      {snapshot.outcomeContract.humanStatement ? (
        <div className="rounded-md border border-border/40 bg-muted/20 p-3">
          <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.automations.workers.outcomeStatement', 'Outcome statement')}
          </div>
          <p className="mt-1 text-xs text-foreground">{snapshot.outcomeContract.humanStatement}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {translate(
              'auto.components.automations.workers.frozenChildren',
              'Frozen specialist workers ({{count}})',
              { count: snapshot.resolvedChildren.length }
            )}
          </span>
        </div>

        <div className="space-y-2">
          {snapshot.resolvedChildren.map((child) => (
            <div
              key={child.childDefinitionId}
              className="rounded-md border border-border/50 bg-background/60 p-3 text-xs"
              data-testid={`historical-child-${child.childDefinitionId}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-medium text-3xs">
                    {child.role}
                  </Badge>
                  <span className="font-semibold text-foreground">{child.name}</span>
                  <span className="font-mono text-3xs text-muted-foreground">
                    ({child.childDefinitionId})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-0.5">
                    <AgentIcon agent={child.launchConfig.agentId} size={14} />
                    <span className="text-3xs font-medium text-foreground">
                      {child.launchConfig.agentId}
                    </span>
                    {child.launchConfig.model ? (
                      <span className="font-mono text-3xs text-muted-foreground">
                        /{child.launchConfig.model}
                      </span>
                    ) : null}
                  </div>
                  <Badge
                    variant="outline"
                    className="border-border/50 text-3xs uppercase tracking-wider text-muted-foreground"
                  >
                    {child.mutationClass}
                  </Badge>
                </div>
              </div>

              <div className="mt-2.5 rounded border border-border/40 bg-muted/30 p-2 text-2xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <FileText className="size-3" aria-hidden="true" />
                    <span className="font-medium">
                      {child.prompt.kind === 'inline'
                        ? 'Inline prompt'
                        : `Source: ${child.prompt.path}`}
                    </span>
                  </div>
                  <span className="font-mono text-3xs" title={child.prompt.digest}>
                    {child.prompt.digest.slice(0, 19)}…
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-foreground/90">{child.prompt.text}</p>
              </div>

              {child.dependencies.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                  <Layers className="size-3" aria-hidden="true" />
                  <span>
                    {translate('auto.components.automations.workers.dependsOn', 'Depends on:')}
                  </span>
                  {child.dependencies.map((dep) => (
                    <Badge key={dep.childId} variant="outline" className="font-mono text-3xs">
                      {dep.childId} ({dep.condition ?? 'accepted'})
                    </Badge>
                  ))}
                </div>
              ) : null}

              {child.stageAcceptance?.requiredArtifacts?.length ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                  <span>Artifacts:</span>
                  {child.stageAcceptance.requiredArtifacts.map((art, idx) => (
                    <span key={idx} className="font-mono text-3xs text-foreground">
                      {art.kind} ({art.pathPattern ?? '*'})
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
