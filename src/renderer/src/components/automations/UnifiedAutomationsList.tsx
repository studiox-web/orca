import React from 'react'
import { CalendarClock, CircleAlert, Network, Plus, RefreshCw, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  hostStableKey,
  ownerKey,
  toStableCatalogRef
} from '../../../../shared/automation-owner-key'
import type {
  UnifiedAutomationRow,
  UnifiedAutomationSnapshot
} from '../../../../shared/unified-automation-types'
import type { AutomationsPageController } from './use-automations-page-controller'
import {
  filterUnifiedAutomationRows,
  INITIAL_UNIFIED_AUTOMATION_FILTERS,
  UnifiedAutomationListFilters,
  type UnifiedAutomationFilterState
} from './UnifiedAutomationListFilters'
import {
  UnifiedAutomationListRows,
  UnifiedAutomationReadOnlyDetail
} from './UnifiedAutomationListRows'
import {
  adaptLiveAutomationRow,
  adaptLiveExternalRow,
  unifiedNativeSourceKey,
  withUnifiedAutomationHostWarnings
} from './unified-automation-live-adapters'
import {
  UnifiedAutomationCreateDialog,
  type UnifiedGoalProjectChoice
} from './UnifiedAutomationCreateDialog'

function liveAuthority(row: AutomationsPageController['list']['visibleRows'][number]) {
  return (
    row.catalogRef ??
    (row.automation.executionTargetType === 'ssh'
      ? {
          authority: { kind: 'desktop' as const },
          selector: { kind: 'ssh' as const, targetId: row.automation.executionTargetId }
        }
      : {
          authority: { kind: 'desktop' as const },
          selector: { kind: 'self' as const }
        })
  )
}

export function UnifiedAutomationsList({
  controller,
  onShowOrg,
  onShowNative,
  onOpenGoal,
  onOpenNative,
  editorsEnabled,
  onCreateAutomation,
  onCreateGoal,
  onOpenGoalAdvanced
}: {
  controller: AutomationsPageController
  onShowOrg: () => void
  onShowNative: () => void
  onOpenGoal: (projectKey: string, goal: string) => void
  onOpenNative: () => void
  editorsEnabled: boolean
  onCreateAutomation: () => void
  onCreateGoal: (projectKey: string) => void
  onOpenGoalAdvanced: (projectKey: string | null) => void
}): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<UnifiedAutomationSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [filters, setFilters] = React.useState<UnifiedAutomationFilterState>(
    INITIAL_UNIFIED_AUTOMATION_FILTERS
  )
  const [readOnlyDetail, setReadOnlyDetail] = React.useState<UnifiedAutomationRow | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [goalProjects, setGoalProjects] = React.useState<UnifiedGoalProjectChoice[]>([])
  const [goalProjectsLoading, setGoalProjectsLoading] = React.useState(false)
  const [goalProjectsError, setGoalProjectsError] = React.useState<string | null>(null)

  const openCreate = React.useCallback(() => {
    setCreateOpen(true)
    setGoalProjectsLoading(true)
    setGoalProjectsError(null)
    const api = window.api.xosGoals
    if (!api) {
      setGoalProjects([])
      setGoalProjectsLoading(false)
      setGoalProjectsError('Local Goal projects are unavailable in this build.')
      return
    }
    void api
      .getBoard()
      .then((board) => setGoalProjects(board.projects.map(({ key, name }) => ({ key, name }))))
      .catch((caught) => {
        setGoalProjects([])
        setGoalProjectsError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setGoalProjectsLoading(false))
  }, [])

  const refresh = React.useCallback(async () => {
    const api = window.api.xosGoals
    if (!api) {
      setError(
        translate(
          'auto.components.automations.unified.goalsUnavailable',
          'Goals are unavailable in this Orca build.'
        )
      )
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setSnapshot(await api.getUnifiedAutomations())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const rows = React.useMemo(() => {
    const derived = snapshot?.rows ?? []
    const nativeSources = new Set(
      derived.flatMap((row) =>
        row.sourceRefs
          .filter((source) => source.kind === 'native-automation')
          .map((source) => unifiedNativeSourceKey(source.authority, source.sourceId))
      )
    )
    const liveNative = controller.list.visibleRows.flatMap((row) => {
      const authority = liveAuthority(row)
      if (nativeSources.has(unifiedNativeSourceKey(authority, row.automation.id))) {
        return []
      }
      const host =
        controller.list.hostCatalog.entries.find(
          (entry) => entry.stableKey === hostStableKey(authority)
        ) ?? null
      const adapted = adaptLiveAutomationRow(
        row,
        controller.store.repoForRow(row)?.displayName ?? null,
        host?.owner ? ownerKey(host.owner) : null
      )
      return [withUnifiedAutomationHostWarnings(adapted, host)]
    })
    const external = controller.list.externalAutomationEntries.map(adaptLiveExternalRow)
    return [...derived, ...liveNative, ...external].sort(
      (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
    )
  }, [
    controller.list.externalAutomationEntries,
    controller.list.hostCatalog.entries,
    controller.list.visibleRows,
    controller.store,
    snapshot
  ])

  const visibleRows = React.useMemo(
    () => filterUnifiedAutomationRows(rows, query, filters),
    [filters, query, rows]
  )
  const snapshotWarnings = React.useMemo(
    () => [
      ...new Map(
        (snapshot?.warnings ?? []).map((warning) => [`${warning.code}:${warning.message}`, warning])
      ).values()
    ],
    [snapshot]
  )

  const openExternal = (row: UnifiedAutomationRow): boolean => {
    if (row.identity.kind !== 'external') {
      return false
    }
    const identity = row.identity
    const entry = controller.list.externalAutomationEntries.find(
      (candidate) =>
        candidate.manager.id === identity.managerId &&
        candidate.job.id === identity.jobId &&
        hostStableKey(toStableCatalogRef(candidate.scope.owner)) ===
          hostStableKey(identity.authority)
    )
    if (!entry) {
      return true
    }
    controller.list.selectAutomationRow(null)
    controller.local.selectExternalKey(entry.key)
    controller.local.setActivePaneTab('overview')
    controller.local.setIsDetailOpen(true)
    onOpenNative()
    return true
  }

  const openNative = (row: UnifiedAutomationRow): void => {
    if (row.identity.kind !== 'automation') {
      return
    }
    const identity = row.identity
    const candidate = controller.list.visibleRows.find(
      (live) =>
        live.automation.id === identity.automationId &&
        hostStableKey(liveAuthority(live)) === hostStableKey(identity.authority)
    )
    if (!candidate) {
      return
    }
    controller.local.selectExternalKey(null)
    controller.list.selectAutomationRow(candidate.key)
    controller.local.setIsDetailOpen(true)
    onOpenNative()
  }

  const openRow = (row: UnifiedAutomationRow): void => {
    if (row.kind === 'goal') {
      if (row.lifecycle.state === 'archived') {
        setReadOnlyDetail(row)
      } else if (row.identity.kind === 'goal') {
        onOpenGoal(row.identity.projectKey, row.identity.goal)
      }
      return
    }
    if (row.kind === 'script') {
      setReadOnlyDetail(row)
      return
    }
    if (!openExternal(row)) {
      openNative(row)
    }
  }

  if (readOnlyDetail) {
    return (
      <UnifiedAutomationReadOnlyDetail
        row={readOnlyDetail}
        onBack={() => setReadOnlyDetail(null)}
      />
    )
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background px-3 pb-4 pt-5 text-foreground md:px-5 md:pt-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target className="size-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">
              {translate('auto.components.automations.unified.goals', 'Goals')}
            </h1>
            <Badge variant="secondary">
              {translate(
                'auto.components.automations.unified.readOnlyPreview',
                'Read-only preview'
              )}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.automations.unified.description',
              'Derived from authoritative stores on refresh. Goals are local-only in this milestone.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editorsEnabled ? (
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              {translate('auto.components.automations.unified.create', 'Create')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onShowOrg}>
            <Network className="size-4" />
            {translate('auto.components.automations.unified.org', 'Org')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onShowNative}>
            <CalendarClock className="size-4" />
            {translate(
              'auto.components.automations.unified.nativeAutomations',
              'Native automations'
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            {translate('auto.components.automations.unified.refresh', 'Refresh')}
          </Button>
        </div>
      </header>
      <UnifiedAutomationListFilters
        rows={rows}
        query={query}
        filters={filters}
        onQueryChange={setQuery}
        onFiltersChange={setFilters}
      />
      {error ? (
        <p className="mb-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {snapshotWarnings.map((warning) => (
        <p
          key={`${warning.code}:${warning.message}`}
          className="mb-2 flex items-center gap-2 rounded-md border p-2 text-xs text-muted-foreground"
        >
          <CircleAlert className="size-4" /> {warning.message}
        </p>
      ))}
      {controller.list.externalManagersUncheckedNotice ? (
        <p className="mb-2 flex items-center gap-2 rounded-md border p-2 text-xs text-muted-foreground">
          <CircleAlert className="size-4" />
          {controller.list.externalManagersUncheckedNotice}
        </p>
      ) : null}
      <UnifiedAutomationListRows rows={visibleRows} loading={loading} onOpen={openRow} />
      <p className="mt-2 text-xs text-muted-foreground">
        {loading
          ? translate(
              'auto.components.automations.unified.refreshing',
              'Refreshing authoritative sources…'
            )
          : translate(
              'auto.components.automations.unified.itemCount',
              '{{visible}} of {{total}} items',
              { visible: visibleRows.length, total: rows.length }
            )}
      </p>
      <UnifiedAutomationCreateDialog
        open={createOpen}
        goalProjects={goalProjects}
        goalProjectsLoading={goalProjectsLoading}
        goalProjectsError={goalProjectsError}
        onOpenChange={setCreateOpen}
        onCreateAutomation={() => {
          setCreateOpen(false)
          onCreateAutomation()
        }}
        onCreateGoal={(projectKey) => {
          setCreateOpen(false)
          onCreateGoal(projectKey)
        }}
        onOpenGoalAdvanced={(projectKey) => {
          setCreateOpen(false)
          onOpenGoalAdvanced(projectKey)
        }}
      />
    </main>
  )
}
