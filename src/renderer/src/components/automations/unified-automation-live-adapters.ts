import {
  hostStableKey,
  ownerKey,
  toStableCatalogRef
} from '../../../../shared/automation-owner-key'
import type { StableAutomationCatalogRef } from '../../../../shared/automation-owner-ref'
import type {
  UnifiedAutomationRow,
  UnifiedRunOutcome
} from '../../../../shared/unified-automation-types'
import { encodeUnifiedAutomationKey } from '../../../../shared/unified-automation-identity'
import type { AutomationListRow } from './automation-list-row-identity'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import type { ExternalAutomationListEntry } from './external-automation-list-entries'
import { getAutomationRowLastRunSnapshot } from './automation-list-last-run'
import { translate } from '@/i18n/i18n'

function automationAuthority(row: AutomationListRow): StableAutomationCatalogRef {
  if (row.catalogRef) {
    return row.catalogRef
  }
  return row.automation.executionTargetType === 'ssh'
    ? {
        authority: { kind: 'desktop' },
        selector: { kind: 'ssh', targetId: row.automation.executionTargetId }
      }
    : { authority: { kind: 'desktop' }, selector: { kind: 'self' } }
}

function externalRunOutcome(status: string | null): UnifiedRunOutcome {
  const value = status?.toLowerCase() ?? ''
  if (value.includes('running') || value.includes('pending') || value.includes('dispatch')) {
    return 'running'
  }
  if (value.includes('limit')) {
    return 'limited'
  }
  if (value.includes('timeout')) {
    return 'timed-out'
  }
  if (value.includes('cancel')) {
    return 'cancelled'
  }
  if (value.includes('skip')) {
    return 'skipped'
  }
  if (value.includes('fail') || value.includes('error')) {
    return 'failed'
  }
  if (
    value.includes('success') ||
    value.includes('complete') ||
    value.includes('succeed') ||
    value === 'ok' ||
    value === 'done' ||
    value === 'healthy'
  ) {
    return 'succeeded'
  }
  return 'unknown'
}

export function adaptLiveAutomationRow(
  row: AutomationListRow,
  project: string | null,
  capturedOwnerKey: string | null = null
): UnifiedAutomationRow {
  const authority = automationAuthority(row)
  const identity = { kind: 'automation' as const, authority, automationId: row.automation.id }
  const lastRun = getAutomationRowLastRunSnapshot(row)
  const sourceRef = {
    kind: 'native-automation' as const,
    authority,
    sourceId: row.automation.id,
    revision: String(row.automation.updatedAt),
    ownerKey: capturedOwnerKey,
    label: translate('auto.components.automations.unified.orcaSource', 'Orca')
  }
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'automation',
    name: row.automation.name,
    project,
    projectKey: row.automation.runContext?.projectId ?? row.automation.projectId ?? null,
    host: row.hostLabel || 'This device',
    owner: 'Orca',
    lifecycle: { state: 'present', stage: 'Native definition' },
    scheduleState: row.automation.enabled ? 'enabled' : 'paused',
    scheduleChildren: [
      {
        key: `native:${hostStableKey(authority)}:${encodeURIComponent(row.automation.id)}`,
        owner: 'orca',
        format: 'rrule',
        expression: row.automation.rrule,
        timezone: row.automation.timezone,
        timezoneLabel: row.automation.timezone,
        enabled: row.automation.enabled,
        nextRunAt: Number.isFinite(row.automation.nextRunAt)
          ? new Date(row.automation.nextRunAt).toISOString()
          : null,
        sourceRef
      }
    ],
    runSummary:
      lastRun.at === null
        ? null
        : {
            source: 'native',
            sourceId: null,
            identity: 'legacy-without-run-id',
            outcome: lastRun.tone === 'never' ? 'unknown' : lastRun.tone,
            sourceStatus: lastRun.tone,
            at: new Date(lastRun.at).toISOString()
          },
    agentId: row.automation.agentId,
    migrationState: 'none',
    sourceRefs: [sourceRef],
    warnings: [],
    readOnly: true
  }
}

export function withUnifiedAutomationHostWarnings(
  row: UnifiedAutomationRow,
  host: Pick<
    AutomationHostCatalogEntry,
    'catalogState' | 'authorityHealth' | 'executionHealth'
  > | null
): UnifiedAutomationRow {
  if (!host) {
    return row
  }
  const warnings = [...row.warnings]
  if (
    host.catalogState !== 'authoritative' ||
    !['fresh', 'refreshing'].includes(host.authorityHealth)
  ) {
    const detail =
      host.catalogState === 'removed'
        ? 'The stored host identity is no longer present.'
        : host.catalogState === 'unhydrated'
          ? 'This row is cached while its host identity is still loading.'
          : host.authorityHealth === 'stale-error'
            ? 'This row is cached because the latest host refresh failed.'
            : host.authorityHealth === 'incompatible'
              ? 'This host cannot provide a current scoped automation snapshot.'
              : host.authorityHealth === 'unavailable'
                ? 'This host is unavailable; the row may be stale.'
                : 'This host source is still loading.'
    warnings.push({
      code: host.authorityHealth === 'stale-error' ? 'stale-source' : 'source-unavailable',
      message: detail
    })
  }
  if (host.executionHealth === 'disconnected' || host.executionHealth === 'unavailable') {
    warnings.push({
      code: 'source-unavailable',
      message:
        host.executionHealth === 'disconnected'
          ? 'The execution target is disconnected. Viewing this row does not reconnect it.'
          : 'The execution target is unavailable. Viewing this row does not reactivate it.'
    })
  }
  return warnings.length === row.warnings.length ? row : { ...row, warnings }
}

export function adaptLiveExternalRow(entry: ExternalAutomationListEntry): UnifiedAutomationRow {
  const authority = toStableCatalogRef(entry.scope.owner)
  const identity = {
    kind: 'external' as const,
    authority,
    managerId: entry.manager.id,
    jobId: entry.job.id
  }
  const sourceRef = {
    kind: 'external' as const,
    authority,
    sourceId: entry.job.id,
    revision: entry.job.lastRunAt,
    ownerKey: ownerKey(entry.scope.owner),
    label: entry.manager.label || entry.job.provider
  }
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'external',
    name: entry.job.name,
    project: entry.job.workdir,
    projectKey: entry.job.workdir,
    host: entry.manager.targetLabel || entry.manager.label,
    owner: entry.manager.label || entry.job.provider,
    lifecycle: { state: 'present', stage: entry.job.state || null },
    scheduleState: entry.job.enabled ? 'enabled' : 'paused',
    scheduleChildren: [
      {
        key: `external:${hostStableKey(authority)}:${encodeURIComponent(entry.manager.id)}:${encodeURIComponent(entry.job.id)}`,
        owner: 'external-manager',
        format: 'manager',
        expression: entry.job.rawSchedule || entry.job.schedule,
        timezone: null,
        timezoneLabel: 'Manager-defined timezone',
        enabled: entry.job.enabled,
        nextRunAt: entry.job.nextRunAt,
        sourceRef
      }
    ],
    runSummary: entry.job.lastRunAt
      ? {
          source: 'external',
          sourceId: entry.job.runs[0]?.id ?? null,
          identity: entry.job.runs[0]?.id ? 'stable' : 'legacy-without-run-id',
          outcome: externalRunOutcome(entry.job.lastStatus),
          sourceStatus: entry.job.lastStatus ?? 'unknown',
          at: entry.job.lastRunAt
        }
      : null,
    agentId: null,
    migrationState: 'none',
    sourceRefs: [sourceRef],
    warnings:
      entry.manager.status === 'unavailable' && entry.manager.error
        ? [{ code: 'source-unavailable', message: entry.manager.error }]
        : [],
    readOnly: true
  }
}

export function unifiedNativeSourceKey(
  authority: StableAutomationCatalogRef,
  automationId: string
): string {
  return `${hostStableKey(authority)}|${automationId}`
}
