import type { Automation, AutomationRun } from './automations-types'
import { hostStableKey } from './automation-owner-key'
import type { StableAutomationCatalogRef } from './automation-owner-ref'
import { normalizeRuntimePathForComparison } from './cross-platform-path'
import type { XosAutomationRunConfig } from './xos-runtime-types'
import type { XosGoalBoard } from './xos-goals-types'
import {
  groupedAutomations,
  latestRunsByAutomationAuthority,
  qualifiedAutomationKey
} from './unified-automation-attribution'
import {
  archivedGoalRow,
  boundScriptRow,
  cronScriptRow,
  goalBaseRow,
  nativeAutomationRow
} from './unified-automation-row-adapters'
import {
  automationAuthority,
  LOCAL_UNIFIED_AUTHORITY,
  nativeRunSummary,
  nativeSchedule,
  newestRun,
  unifiedMigrationState,
  unifiedScheduleState,
  unifiedSourceRef
} from './unified-automation-source-adapters'
import type {
  UnifiedAttributedAutomationRun,
  UnifiedAutomationRow,
  UnifiedAutomationSnapshot,
  UnifiedAutomationWarning
} from './unified-automation-types'

type BuildUnifiedAutomationSnapshotInput = {
  board: XosGoalBoard
  automations: readonly Automation[]
  runs: readonly AutomationRun[]
  runConfigs: Readonly<Record<string, XosAutomationRunConfig>>
  runConfigAuthority: StableAutomationCatalogRef
  generatedAt?: string
}

function sourceRevision(values: readonly string[]): string {
  return [...values].sort().join('|') || 'empty'
}

function addBoardRows(rows: Map<string, UnifiedAutomationRow>, board: XosGoalBoard): void {
  for (const project of board.projects) {
    for (const goal of project.goals) {
      const row = goalBaseRow(project, goal, board.crontabHash)
      rows.set(row.key, row)
    }
    for (const archived of project.archived) {
      const row = archivedGoalRow(project, archived)
      rows.set(row.key, row)
    }
    const occurrences = new Map<string, number>()
    for (const job of project.scripts) {
      const occurrence = occurrences.get(job.id) ?? 0
      occurrences.set(job.id, occurrence + 1)
      const row = cronScriptRow(project, job, board.crontabHash, occurrence)
      rows.set(row.key, row)
    }
  }
  const otherOccurrences = new Map<string, number>()
  for (const job of board.otherJobs) {
    const occurrence = otherOccurrences.get(job.id) ?? 0
    otherOccurrences.set(job.id, occurrence + 1)
    const row = cronScriptRow(null, job, board.crontabHash, occurrence)
    rows.set(row.key, row)
  }
}

function activeGoalBindingTarget(
  rows: ReadonlyMap<string, UnifiedAutomationRow>,
  binding: NonNullable<XosAutomationRunConfig['goal']>
): [string, UnifiedAutomationRow] | null {
  const projectKey = normalizeRuntimePathForComparison(binding.repoRoot)
  const matches = [...rows.entries()].filter(([, row]) => {
    const identity = row.identity
    return (
      identity.kind === 'goal' &&
      hostStableKey(identity.authority) === hostStableKey(LOCAL_UNIFIED_AUTHORITY) &&
      normalizeRuntimePathForComparison(identity.projectKey) === projectKey &&
      identity.goal === binding.goal &&
      row.lifecycle.state === 'active'
    )
  })
  return matches.length === 1 ? matches[0] : null
}

function foldGoalBinding(
  rows: Map<string, UnifiedAutomationRow>,
  automation: Automation,
  latest: UnifiedAttributedAutomationRun | undefined,
  config: XosAutomationRunConfig | undefined,
  duplicateWarnings: UnifiedAutomationWarning[]
): boolean {
  if (!config?.goal) {
    return false
  }
  const bindingTarget = activeGoalBindingTarget(rows, config.goal)
  if (!bindingTarget) {
    return false
  }
  const [key, target] = bindingTarget
  const schedule = nativeSchedule(automation)
  const schedules = [...target.scheduleChildren, schedule]
  rows.set(key, {
    ...target,
    owner: target.scheduleChildren.some((child) => child.owner === 'legacy-cron')
      ? 'Goal files + legacy cron + Orca'
      : 'Goal files + Orca',
    scheduleChildren: schedules,
    scheduleState: unifiedScheduleState(schedules),
    runSummary: newestRun(target.runSummary, nativeRunSummary(latest)),
    sourceRefs: [
      ...target.sourceRefs,
      unifiedSourceRef({
        kind: 'runtime-binding',
        authority: schedule.sourceRef.authority,
        sourceId: automation.id,
        revision: String(automation.updatedAt),
        ownerKey: schedule.sourceRef.ownerKey,
        label: 'XOS Goal binding'
      }),
      schedule.sourceRef
    ],
    migrationState: unifiedMigrationState(schedules, duplicateWarnings.length > 0),
    warnings: [...target.warnings, ...duplicateWarnings]
  })
  return true
}

function addNativeRows(
  rows: Map<string, UnifiedAutomationRow>,
  warnings: UnifiedAutomationWarning[],
  input: BuildUnifiedAutomationSnapshotInput,
  latestRuns: ReadonlyMap<string, UnifiedAttributedAutomationRun>
): void {
  const groups = groupedAutomations(input.automations)
  const configAuthorityKey = hostStableKey(input.runConfigAuthority)
  for (const group of groups) {
    const automation = [...group].sort((a, b) =>
      `${a.updatedAt}:${a.name}`.localeCompare(`${b.updatedAt}:${b.name}`)
    )[0]
    const authority = automationAuthority(automation).stable
    const authorityKey = hostStableKey(authority)
    const rawConfig = input.runConfigs[automation.id]
    const config = authorityKey === configAuthorityKey ? rawConfig : undefined
    const attributionWarnings: UnifiedAutomationWarning[] =
      rawConfig && !config
        ? [
            {
              code: 'config-attribution-conflict',
              message: `Runtime config ${automation.id} belongs to ${configAuthorityKey} and was not attributed to ${authorityKey}.`
            }
          ]
        : []
    warnings.push(...attributionWarnings)
    const duplicateWarnings: UnifiedAutomationWarning[] =
      group.length > 1
        ? [
            {
              code: 'duplicate-native-identity',
              message: `Multiple native definitions claim ${automation.id} on the same authority.`
            }
          ]
        : []
    const sourceWarnings = [...duplicateWarnings, ...attributionWarnings]
    const latest = latestRuns.get(qualifiedAutomationKey(authority, automation.id))
    if (config?.goal && config?.script) {
      const conflict = {
        code: 'binding-conflict' as const,
        message: `Native automation ${automation.id} is bound to both a Goal and a Script.`
      }
      warnings.push(conflict)
      const row = nativeAutomationRow(automation, latest, [...sourceWarnings, conflict])
      rows.set(row.key, row)
      continue
    }
    if (
      config?.goal &&
      hostStableKey(automationAuthority(automation).stable) !==
        hostStableKey(LOCAL_UNIFIED_AUTHORITY)
    ) {
      const conflict = {
        code: 'binding-conflict' as const,
        message: `Native automation ${automation.id} cannot bind a non-local execution authority to local-only Goal ${config.goal.repoRoot}:${config.goal.goal}.`
      }
      warnings.push(conflict)
      const target = activeGoalBindingTarget(rows, config.goal)
      if (target) {
        rows.set(target[0], {
          ...target[1],
          migrationState: 'conflict',
          warnings: [...target[1].warnings, conflict]
        })
      }
      const row = nativeAutomationRow(automation, latest, [...sourceWarnings, conflict])
      rows.set(row.key, row)
      continue
    }
    if (foldGoalBinding(rows, automation, latest, config, sourceWarnings)) {
      continue
    }
    if (config?.goal) {
      const missing = {
        code: 'binding-target-missing' as const,
        message: `Goal binding ${config.goal.repoRoot}:${config.goal.goal} has no active exact target.`
      }
      warnings.push(missing)
      const row = nativeAutomationRow(automation, latest, [...sourceWarnings, missing])
      rows.set(row.key, row)
      continue
    }
    const row = config?.script
      ? boundScriptRow(automation, latest, config)
      : nativeAutomationRow(automation, latest, sourceWarnings)
    rows.set(row.key, {
      ...row,
      warnings: config?.script ? [...row.warnings, ...sourceWarnings] : row.warnings
    })
  }
}

function addStaleBindingWarnings(
  rows: Map<string, UnifiedAutomationRow>,
  warnings: UnifiedAutomationWarning[],
  input: BuildUnifiedAutomationSnapshotInput
): void {
  const automationKeys = new Set(
    input.automations.map((automation) =>
      qualifiedAutomationKey(automationAuthority(automation).stable, automation.id)
    )
  )
  for (const [automationId, config] of Object.entries(input.runConfigs)) {
    if (
      (!config.goal && !config.script) ||
      automationKeys.has(qualifiedAutomationKey(input.runConfigAuthority, automationId))
    ) {
      continue
    }
    const warning: UnifiedAutomationWarning = {
      code: 'stale-source',
      message: `Runtime binding ${automationId} has no native automation definition.`
    }
    warnings.push(warning)
    if (config.goal) {
      const target = activeGoalBindingTarget(rows, config.goal)
      if (target) {
        rows.set(target[0], { ...target[1], warnings: [...target[1].warnings, warning] })
      }
    }
  }
}

export function buildUnifiedAutomationSnapshot(
  input: BuildUnifiedAutomationSnapshotInput
): UnifiedAutomationSnapshot {
  const rows = new Map<string, UnifiedAutomationRow>()
  const warnings: UnifiedAutomationWarning[] = input.board.warnings.map((message) => ({
    code: 'source-unavailable',
    message
  }))
  const latestRuns = latestRunsByAutomationAuthority(input.automations, input.runs)
  warnings.push(...latestRuns.warnings)
  addBoardRows(rows, input.board)
  addNativeRows(rows, warnings, input, latestRuns.latest)
  addStaleBindingWarnings(rows, warnings, input)
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    revisions: {
      goals: sourceRevision(
        input.board.projects.flatMap((project) => [
          project.key,
          ...project.goals.map((goal) => `${goal.goal}:${goal.viewer.statusUpdatedAt ?? ''}`),
          ...project.archived.map((goal) => `${goal.goal}:${goal.archivedAt ?? ''}`)
        ])
      ),
      legacyCron: input.board.crontabHash,
      nativeAutomations: sourceRevision(
        input.automations.map(
          (automation) =>
            `${qualifiedAutomationKey(automationAuthority(automation).stable, automation.id)}:${automation.updatedAt}`
        )
      ),
      runtimeBindings: sourceRevision([
        hostStableKey(input.runConfigAuthority),
        ...Object.entries(input.runConfigs).map(
          ([id, config]) =>
            `${id}:${config.goal ? normalizeRuntimePathForComparison(config.goal.repoRoot) : ''}:${config.goal?.goal ?? ''}:${config.script ? 'script' : ''}`
        )
      ])
    },
    rows: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
    warnings
  }
}
