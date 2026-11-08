import React from 'react'
import {
  Archive,
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  FileCode2,
  Plug,
  Target
} from 'lucide-react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { hostStableKey } from '../../../../shared/automation-owner-key'
import { readOnlyUnifiedCapabilities } from '../../../../shared/unified-automation-capabilities'
import {
  resolveUnifiedDetailTarget,
  type UnifiedDetailResolution,
  type UnifiedDetailSelection
} from '../../../../shared/unified-automation-detail'
import { encodeUnifiedAutomationKey } from '../../../../shared/unified-automation-identity'
import type {
  UnifiedAutomationKind,
  UnifiedAutomationRow
} from '../../../../shared/unified-automation-types'
import { UnifiedAutomationDetailSections } from './UnifiedAutomationDetailSections'
import { unifiedDenialLabel } from './unified-automation-detail-copy'

function typeIcon(kind: UnifiedAutomationKind): React.JSX.Element {
  if (kind === 'goal') {
    return <Target className="size-4" aria-hidden />
  }
  if (kind === 'automation') {
    return <CalendarClock className="size-4" aria-hidden />
  }
  if (kind === 'script') {
    return <FileCode2 className="size-4" aria-hidden />
  }
  return <Plug className="size-4" aria-hidden />
}

function typeLabel(kind: UnifiedAutomationKind): string {
  if (kind === 'goal') {
    return translate('auto.components.automations.unified.detail.goal', 'Goal')
  }
  if (kind === 'automation') {
    return translate(
      'auto.components.automations.unified.detail.agentAutomation',
      'Agent automation'
    )
  }
  if (kind === 'script') {
    return translate('auto.components.automations.unified.detail.script', 'Script')
  }
  return translate(
    'auto.components.automations.unified.detail.externalAutomation',
    'External automation'
  )
}

function exactCurrentRow(
  selection: UnifiedDetailSelection,
  rows: readonly UnifiedAutomationRow[],
  resolution: UnifiedDetailResolution
): UnifiedAutomationRow | null {
  if (resolution.status !== 'resolved') {
    return null
  }
  return (
    rows.find(
      (row) =>
        row.key === selection.key &&
        encodeUnifiedAutomationKey(row.identity) === encodeUnifiedAutomationKey(selection.identity)
    ) ?? null
  )
}

function latestRunLabel(row: UnifiedAutomationRow): string {
  if (!row.runSummary) {
    return translate(
      'auto.components.automations.unified.detail.noRunsRecorded',
      'No runs recorded'
    )
  }
  const at = row.runSummary.at
    ? new Date(row.runSummary.at).toLocaleString(getIntlLocale())
    : translate('auto.components.automations.unified.detail.timeUnavailable', 'Time unavailable')
  return `${row.runSummary.outcome} · ${at}`
}

export function UnifiedAutomationDetailShell({
  selection,
  rows,
  lastKnownRow,
  onBack,
  onOpenGoal,
  canOpenNative,
  onOpenNative,
  canOpenExternal,
  onOpenExternal
}: {
  selection: UnifiedDetailSelection
  rows: readonly UnifiedAutomationRow[]
  lastKnownRow: UnifiedAutomationRow
  onBack: () => void
  onOpenGoal: (projectKey: string, goal: string) => void
  canOpenNative: (row: UnifiedAutomationRow) => boolean
  onOpenNative: (row: UnifiedAutomationRow) => void
  canOpenExternal: (row: UnifiedAutomationRow) => boolean
  onOpenExternal: (row: UnifiedAutomationRow) => void
}): React.JSX.Element {
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const resolution = resolveUnifiedDetailTarget({ selection, rows })
  const currentRow = exactCurrentRow(selection, rows, resolution)
  const row = currentRow ?? lastKnownRow
  const conflict = row.warnings.some(
    (warning) => warning.code.includes('conflict') || warning.code === 'duplicate-native-identity'
  )
  const capabilities = readOnlyUnifiedCapabilities({
    kind: row.kind,
    lifecycle: row.lifecycle.state === 'archived' ? 'archived' : 'active',
    identity:
      row.kind === 'script' && row.scriptEvidence?.provenance === 'legacy-cron'
        ? 'legacy'
        : 'stable',
    conflict,
    manager: row.kind === 'external' ? 'unsupported' : undefined
  })
  const denialReason = capabilities.denied[0]?.reason ?? 'read-only-surface'
  const goalTarget =
    resolution.status === 'resolved' && resolution.target.kind === 'goal' ? resolution.target : null

  React.useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main
      className="scrollbar-sleek h-full overflow-y-auto bg-background px-3 pb-10 pt-5 text-foreground sm:px-4 md:px-6 md:pt-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onBack()
        }
      }}
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden />
          {translate(
            'auto.components.automations.unified.detail.back',
            'Back to unified automations'
          )}
        </Button>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {row.lifecycle.state === 'archived' ? (
              <Archive className="size-4" aria-hidden />
            ) : (
              typeIcon(row.kind)
            )}
            <Badge variant="outline">{typeLabel(row.kind)}</Badge>
            <Badge variant="secondary">
              {translate(
                'auto.components.automations.unified.detail.readOnlyDetail',
                'Read-only detail'
              )}
            </Badge>
            {row.agentId ? (
              <span className="inline-flex items-center gap-1 text-xs">
                <AgentIcon agent={row.agentId} size={14} />
                {getAgentLabel(row.agentId)}
              </span>
            ) : null}
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {row.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.automations.unified.detail.exactIdentity',
              'Exact identity'
            )}{' '}
            <span className="break-all font-mono">{row.key}</span>
          </p>
        </header>

        {resolution.status !== 'resolved' ? (
          <section
            role="alert"
            className="flex gap-2 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">
                {resolution.status === 'stale'
                  ? translate(
                      'auto.components.automations.unified.detail.staleSelection',
                      'This exact selection is stale.'
                    )
                  : translate(
                      'auto.components.automations.unified.detail.missingSource',
                      'The required authoritative source is missing.'
                    )}
              </p>
              <p className="mt-1 text-xs">
                {resolution.status === 'stale'
                  ? translate(
                      'auto.components.automations.unified.detail.staleSelectionDescription',
                      'The row disappeared or its exact identity changed after refresh.'
                    )
                  : translate(
                      'auto.components.automations.unified.detail.requiredSourceKinds',
                      'Required source kinds: {{kinds}}.',
                      { kinds: resolution.requiredSourceKinds.join(', ') }
                    )}
              </p>
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {[
            [
              translate('auto.components.automations.unified.detail.type', 'Type'),
              typeLabel(row.kind)
            ],
            [
              translate('auto.components.automations.unified.detail.authority', 'Authority'),
              hostStableKey(row.identity.authority)
            ],
            [translate('auto.components.automations.unified.detail.host', 'Host'), row.host],
            [
              translate('auto.components.automations.unified.detail.project', 'Project'),
              row.project ??
                translate('auto.components.automations.unified.detail.noProject', 'No project')
            ],
            [
              translate(
                'auto.components.automations.unified.detail.projectKey',
                'Project key / path'
              ),
              row.projectKey ??
                translate('auto.components.automations.unified.detail.unavailable', 'Unavailable')
            ],
            [
              translate('auto.components.automations.unified.detail.area', 'Area / department'),
              row.area?.title ??
                translate(
                  'auto.components.automations.unified.detail.noArea',
                  'Project-level / unassigned'
                )
            ],
            [
              translate('auto.components.automations.unified.detail.lifecycle', 'Lifecycle'),
              `${row.lifecycle.state}${row.lifecycle.stage ? ` · ${row.lifecycle.stage}` : ''}`
            ],
            [
              translate(
                'auto.components.automations.unified.detail.scheduleState',
                'Schedule state'
              ),
              row.scheduleState
            ],
            [
              translate('auto.components.automations.unified.detail.latestRun', 'Latest run'),
              latestRunLabel(row)
            ],
            [
              translate('auto.components.automations.unified.detail.capabilities', 'Capabilities'),
              `${translate(
                'auto.components.automations.unified.detail.detailOnly',
                'Detail only'
              )} · ${unifiedDenialLabel(denialReason)}`
            ]
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 break-words text-sm">{value}</p>
            </div>
          ))}
        </section>

        <UnifiedAutomationDetailSections
          row={row}
          currentRow={currentRow}
          resolution={resolution}
          conflict={conflict}
          goalTarget={goalTarget}
          onOpenGoal={onOpenGoal}
          canOpenNative={canOpenNative}
          onOpenNative={onOpenNative}
          canOpenExternal={canOpenExternal}
          onOpenExternal={onOpenExternal}
        />
      </div>
    </main>
  )
}
