import React from 'react'
import { ArrowRight, Layers, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AgentIcon } from '@/lib/agent-catalog'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults
} from '../../../../shared/coordinated-automation-types'
import { computeWorkerGraphLayout } from './automation-workers-graph-layout'
import { translate } from '@/i18n/i18n'

type AutomationWorkersGraphProps = {
  workers: readonly CoordinatedAutomationChildDefinition[]
  parentDefaults?: CoordinatedAutomationInheritedDefaults
  selectedChildId?: string | null
  onSelectChild?: (childId: string) => void
  className?: string
}

export function AutomationWorkersGraph({
  workers,
  parentDefaults,
  selectedChildId,
  onSelectChild,
  className = ''
}: AutomationWorkersGraphProps): React.JSX.Element {
  const { layers, hasCycle } = computeWorkerGraphLayout(workers)

  if (workers.length === 0) {
    return (
      <div
        className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground"
        data-testid="automation-workers-graph-empty"
      >
        {translate(
          'auto.components.automations.workers.graphEmpty',
          'No workers configured in graph.'
        )}
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={translate(
        'auto.components.automations.workers.graphAriaLabel',
        'Worker dependency graph'
      )}
      className={`space-y-3 ${className}`}
      data-testid="automation-workers-graph"
    >
      {hasCycle ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-2xs text-destructive">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {translate(
              'auto.components.automations.workers.cycleWarning',
              'Dependency cycle detected. Unsequenced workers are grouped in fallback stage.'
            )}
          </span>
        </div>
      ) : null}

      <div className="scrollbar-sleek flex gap-4 overflow-x-auto pb-3 pt-1">
        {layers.map((layer) => (
          <div
            key={layer.layerIndex}
            className="flex min-w-[240px] max-w-[280px] shrink-0 flex-col gap-2.5 rounded-lg border border-border/50 bg-muted/20 p-3"
            data-testid={`graph-layer-${layer.layerIndex}`}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Layers className="size-3.5" aria-hidden="true" />
                <span>
                  {translate('auto.components.automations.workers.stageTitle', 'Stage {{stage}}', {
                    stage: layer.layerIndex + 1
                  })}
                </span>
              </div>
              <Badge variant="outline" className="text-3xs">
                {layer.nodes.length}
              </Badge>
            </div>

            <div className="space-y-2">
              {layer.nodes.map((node) => {
                const isSelected = selectedChildId === node.child.id
                const effectiveAgent =
                  node.child.launchConfig.agentId ?? parentDefaults?.agentId ?? 'claude'
                const effectiveModel =
                  node.child.launchConfig.model === null
                    ? null
                    : (node.child.launchConfig.model ?? parentDefaults?.model ?? null)

                return (
                  <button
                    key={node.child.id}
                    type="button"
                    tabIndex={0}
                    onClick={() => onSelectChild?.(node.child.id)}
                    aria-label={`Select worker ${node.child.name}`}
                    className={`group w-full rounded-md border text-left transition-all p-2.5 ${
                      isSelected
                        ? 'border-ring bg-accent/80 shadow-xs ring-1 ring-ring'
                        : 'border-border/60 bg-card hover:border-border hover:bg-accent/40'
                    } ${!node.child.enabled ? 'opacity-60' : ''}`}
                    data-testid={`graph-node-${node.child.id}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <Badge variant="secondary" className="font-semibold text-3xs uppercase">
                        {node.child.role}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-border/50 text-3xs uppercase tracking-wider text-muted-foreground"
                      >
                        {node.child.mutationClass.replace('_writer', '')}
                      </Badge>
                    </div>

                    <div
                      className="mt-1.5 font-medium text-xs text-foreground truncate"
                      title={node.child.name}
                    >
                      {node.child.name}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
                      <div className="flex items-center gap-1 min-w-0">
                        <AgentIcon agent={effectiveAgent} size={12} />
                        <span
                          className="truncate max-w-[120px] font-mono text-3xs"
                          title={
                            effectiveModel
                              ? `${effectiveAgent} (${effectiveModel})`
                              : effectiveAgent
                          }
                        >
                          {effectiveAgent}
                          {effectiveModel ? `/${effectiveModel}` : ''}
                        </span>
                      </div>

                      {node.upstreamIds.length > 0 ? (
                        <div className="flex items-center gap-0.5 text-3xs text-muted-foreground shrink-0">
                          <span>in:{node.upstreamIds.length}</span>
                        </div>
                      ) : null}
                    </div>

                    {node.downstreamIds.length > 0 ? (
                      <div className="mt-1 flex items-center gap-1 border-t border-border/30 pt-1 text-3xs text-muted-foreground">
                        <ArrowRight className="size-2.5" />
                        <span className="truncate">
                          {translate(
                            'auto.components.automations.workers.feedsCount',
                            'feeds {{count}} worker(s)',
                            { count: node.downstreamIds.length }
                          )}
                        </span>
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
