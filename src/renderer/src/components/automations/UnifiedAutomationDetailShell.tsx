import React from 'react'
import {
  Archive,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  FileCode2,
  Plug,
  Target
} from 'lucide-react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { getIntlLocale } from '@/i18n/i18n'
import { hostStableKey } from '../../../../shared/automation-owner-key'
import {
  readOnlyUnifiedCapabilities,
  readOnlyUnifiedScheduleChildCapabilities,
  type UnifiedDenialReason
} from '../../../../shared/unified-automation-capabilities'
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
import { UnifiedAutomationDetailScriptEvidence } from './UnifiedAutomationDetailScriptEvidence'

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
    return 'Goal'
  }
  if (kind === 'automation') {
    return 'Agent automation'
  }
  if (kind === 'script') {
    return 'Script'
  }
  return 'External automation'
}

function denialLabel(reason: UnifiedDenialReason): string {
  return reason.replaceAll('-', ' ')
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
    return 'No runs recorded'
  }
  const at = row.runSummary.at
    ? new Date(row.runSummary.at).toLocaleString(getIntlLocale())
    : 'Time unavailable'
  return `${row.runSummary.outcome} · ${at}`
}

export function UnifiedAutomationDetailShell({
  selection,
  rows,
  lastKnownRow,
  onBack,
  onOpenGoal,
  canOpenNative,
  onOpenNative
}: {
  selection: UnifiedDetailSelection
  rows: readonly UnifiedAutomationRow[]
  lastKnownRow: UnifiedAutomationRow
  onBack: () => void
  onOpenGoal: (projectKey: string, goal: string) => void
  canOpenNative: (row: UnifiedAutomationRow) => boolean
  onOpenNative: (row: UnifiedAutomationRow) => void
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

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  return (
    <main className="scrollbar-sleek h-full overflow-y-auto bg-background px-3 pb-10 pt-5 text-foreground sm:px-4 md:px-6 md:pt-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden />
          Back to unified automations
        </Button>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {row.lifecycle.state === 'archived' ? (
              <Archive className="size-4" aria-hidden />
            ) : (
              typeIcon(row.kind)
            )}
            <Badge variant="outline">{typeLabel(row.kind)}</Badge>
            <Badge variant="secondary">Read-only detail</Badge>
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
            Exact identity <span className="break-all font-mono">{row.key}</span>
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
                  ? 'This exact selection is stale.'
                  : 'The required authoritative source is missing.'}
              </p>
              <p className="mt-1 text-xs">
                {resolution.status === 'stale'
                  ? 'The row disappeared or its exact identity changed after refresh.'
                  : `Required source kinds: ${resolution.requiredSourceKinds.join(', ')}.`}
              </p>
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {[
            ['Type', typeLabel(row.kind)],
            ['Authority', hostStableKey(row.identity.authority)],
            ['Host', row.host],
            ['Project', row.project ?? row.projectKey ?? 'No project'],
            [
              'Lifecycle',
              `${row.lifecycle.state}${row.lifecycle.stage ? ` · ${row.lifecycle.stage}` : ''}`
            ],
            ['Schedule state', row.scheduleState],
            ['Latest run', latestRunLabel(row)],
            ['Capabilities', `Detail only · ${denialLabel(denialReason)}`]
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 break-words text-sm">{value}</p>
            </div>
          ))}
        </section>

        {row.warnings.length > 0 ? (
          <section className="space-y-2" aria-label="Warnings and conflicts">
            <h2 className="text-sm font-semibold">Warnings and conflicts</h2>
            {row.warnings.map((warning, index) => (
              <div
                key={`${warning.code}:${index}`}
                className="flex gap-2 rounded-md border p-3 text-sm"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div>
                  <p className="font-medium">{warning.code}</p>
                  <p className="text-xs text-muted-foreground">{warning.message}</p>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">Schedule children</h2>
          {row.scheduleChildren.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No schedule is attached.</p>
          ) : (
            <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
              {row.scheduleChildren.map((schedule) => {
                const scheduleCapabilities = readOnlyUnifiedScheduleChildCapabilities({
                  owner: schedule.owner,
                  conflict
                })
                const scheduleReason = scheduleCapabilities.denied[0]?.reason
                return (
                  <article key={schedule.key} className="min-w-0 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{schedule.owner}</Badge>
                      <Badge variant="secondary">{schedule.format}</Badge>
                      <Badge variant={schedule.enabled ? 'secondary' : 'outline'}>
                        {schedule.enabled ? 'Enabled' : 'Paused'}
                      </Badge>
                    </div>
                    <p className="mt-2 break-all font-mono text-xs">{schedule.expression}</p>
                    <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
                      <div>
                        <dt className="inline font-medium">Timezone: </dt>
                        <dd className="inline">{schedule.timezoneLabel}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Next run: </dt>
                        <dd className="inline">{schedule.nextRunAt ?? 'Unavailable'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Editing: </dt>
                        <dd className="inline">
                          Read-only{scheduleReason ? ` · ${denialLabel(scheduleReason)}` : ''}
                        </dd>
                      </div>
                    </dl>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">Authoritative sources</h2>
          <div className="mt-3 space-y-3">
            {row.sourceRefs.map((source, index) => (
              <article
                key={`${source.kind}:${hostStableKey(source.authority)}:${source.sourceId}:${source.revision ?? ''}:${source.ownerKey ?? ''}:${index}`}
                className="rounded-md border p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{source.kind}</Badge>
                  <span>{source.label}</span>
                </div>
                <dl className="mt-2 grid gap-1 text-muted-foreground [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
                  <div>
                    <dt className="font-medium">Source ID</dt>
                    <dd className="break-all font-mono">{source.sourceId}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Authority</dt>
                    <dd className="break-all font-mono">{hostStableKey(source.authority)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Revision</dt>
                    <dd className="break-all font-mono">{source.revision ?? 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Owner key</dt>
                    <dd className="break-all font-mono">{source.ownerKey ?? 'Not recorded'}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        {resolution.status === 'resolved' && resolution.target.kind === 'script' ? (
          <UnifiedAutomationDetailScriptEvidence
            evidence={resolution.target.evidence}
            host={row.host}
          />
        ) : null}

        {goalTarget ? (
          row.lifecycle.state === 'archived' ? (
            <section className="rounded-xl border bg-card p-4 text-sm shadow-xs">
              <h2 className="font-semibold">Archived Goal</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Archived Goal metadata remains view-only here and does not expose manage actions.
              </p>
            </section>
          ) : (
            <Collapsible className="rounded-xl border bg-card px-4 shadow-xs">
              <CollapsibleTrigger variant="row">
                <span>Advanced Goal workspace</span>
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pb-4 text-xs text-muted-foreground">
                <p>
                  Open the existing Goal Viewer for files, scheduling, pause/resume, archive, run,
                  and other established manage capabilities. This shell does not duplicate them.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenGoal(goalTarget.projectKey, goalTarget.goal)}
                >
                  Open Goal workspace
                </Button>
              </CollapsibleContent>
            </Collapsible>
          )
        ) : null}

        {resolution.status === 'resolved' && resolution.target.kind === 'automation' ? (
          <section className="rounded-xl border bg-card p-4 shadow-xs">
            <h2 className="text-sm font-semibold">Native automation editor</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Continue to the existing native detail and editor for provider, model, destination,
              schedule, precheck, and setup controls.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={!currentRow || !canOpenNative(currentRow)}
              onClick={() => currentRow && onOpenNative(currentRow)}
            >
              {row.agentId ? <AgentIcon agent={row.agentId} size={14} /> : null}
              Open native automation
            </Button>
            {!currentRow || !canOpenNative(currentRow) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                The exact native row is not available in the current host catalog.
              </p>
            ) : null}
          </section>
        ) : null}

        {resolution.status === 'resolved' && resolution.target.kind === 'external' ? (
          <section className="rounded-xl border bg-card p-4 text-sm shadow-xs">
            <h2 className="font-semibold">External manager detail</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Capability-driven read-only view. Manage this job in its authoritative external
              manager.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  )
}
