import React, { useState } from 'react'
import { Check, Copy, FileText, Hash, Shield, Layers, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentIcon } from '@/lib/agent-catalog'
import type { ResolvedAutomationRunSnapshot } from '../../../../shared/coordinated-automation-types'
import { translate } from '@/i18n/i18n'

type AutomationHistoricalSnapshotViewerProps = {
  snapshot: ResolvedAutomationRunSnapshot
  runId?: string | null
  className?: string
}

export function AutomationHistoricalSnapshotViewer({
  snapshot,
  runId = null,
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

  const createdAtStr =
    Number.isFinite(snapshot.createdAt) && snapshot.createdAt > 0
      ? new Date(snapshot.createdAt).toISOString()
      : translate('auto.components.automations.workers.unknownDate', 'Unknown date')

  return (
    <div
      role="region"
      aria-label={translate(
        'auto.components.automations.workers.historicalSnapshotTitle',
        'Historical run snapshot'
      )}
      className={`@container space-y-4 rounded-lg border border-border/70 bg-card p-4 shadow-sm ${className}`}
      data-testid="automation-historical-snapshot-viewer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Shield className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <h4 className="font-semibold text-sm truncate">
            {translate(
              'auto.components.automations.workers.historicalSnapshotHeader',
              'Frozen run snapshot (Revision {{revision}})',
              { revision: snapshot.definitionRevision }
            )}
          </h4>
          {runId ? (
            <Badge
              variant="secondary"
              className="font-mono text-3xs truncate max-w-[200px]"
              title={runId}
            >
              {translate('auto.components.automations.workers.runPrefix', 'Run: {{runId}}', {
                runId
              })}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="border-border/60 text-2xs text-muted-foreground shrink-0"
          >
            {translate('auto.components.automations.workers.readOnly', 'Read-only')}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-3xs text-muted-foreground shrink-0">
          <Clock className="size-3.5" aria-hidden="true" />
          <span>{createdAtStr}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-2xs min-w-0">
        <div className="flex min-w-0 items-center gap-2 flex-1">
          <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-muted-foreground shrink-0">
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
          className="h-6 gap-1 px-2 text-3xs text-muted-foreground hover:text-foreground shrink-0"
          onClick={handleCopyDigest}
          aria-label={translate(
            'auto.components.automations.workers.copyDigest',
            'Copy canonical digest'
          )}
        >
          {copied ? (
            <>
              <Check className="size-3 text-status-success" />
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
          <p className="mt-1 text-xs text-foreground break-words">
            {snapshot.outcomeContract.humanStatement}
          </p>
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
              className="rounded-md border border-border/50 bg-background/60 p-3 text-xs min-w-0"
              data-testid={`historical-child-${child.childDefinitionId}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="font-medium text-3xs">
                    {child.role}
                  </Badge>
                  <span className="font-semibold text-foreground truncate">{child.name}</span>
                  <span className="font-mono text-3xs text-muted-foreground truncate">
                    ({child.childDefinitionId})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 min-w-0">
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

              <div className="mt-2.5 rounded border border-border/40 bg-muted/30 p-2 text-2xs min-w-0">
                <div className="flex flex-col @sm:flex-row @sm:items-center justify-between gap-1 text-muted-foreground min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <FileText className="size-3 shrink-0" aria-hidden="true" />
                    <span className="font-medium truncate">
                      {child.prompt.kind === 'inline'
                        ? translate(
                            'auto.components.automations.workers.inlinePrompt',
                            'Inline prompt'
                          )
                        : translate(
                            'auto.components.automations.workers.sourceRefPrompt',
                            'Source reference: {{path}}',
                            { path: child.prompt.path }
                          )}
                    </span>
                  </div>
                  <span
                    className="font-mono text-3xs shrink-0 truncate max-w-[160px]"
                    title={child.prompt.digest}
                  >
                    {child.prompt.digest.slice(0, 19)}…
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-foreground/90 break-words">
                  {child.prompt.text}
                </p>
              </div>

              {child.dependencies.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                  <Layers className="size-3 shrink-0" aria-hidden="true" />
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
                  <span>
                    {translate('auto.components.automations.workers.artifactsLabel', 'Artifacts:')}
                  </span>
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
