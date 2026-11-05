import type { Automation, AutomationRun } from './automations-types'
import { hostStableKey } from './automation-owner-key'
import type { XosAutomationRunConfig } from './xos-runtime-types'
import type { XosGoalBoard } from './xos-goals-types'
import { encodeUnifiedAutomationKey } from './unified-automation-identity'
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
  UnifiedAutomationIdentity,
  UnifiedAutomationRow,
  UnifiedAutomationSnapshot,
  UnifiedAutomationWarning
} from './unified-automation-types'

type BuildUnifiedAutomationSnapshotInput = {
  board: XosGoalBoard
  automations: readonly Automation[]
  runs: readonly AutomationRun[]
  runConfigs: Readonly<Record<string, XosAutomationRunConfig>>
  generatedAt?: string
}

function latestRunByAutomation(runs: readonly AutomationRun[]): Map<string, AutomationRun> {
  const latest = new Map<string, AutomationRun>()
  for (const run of runs) {
    const current = latest.get(run.automationId)
    const at = run.startedAt ?? run.createdAt
    const currentAt = current ? (current.startedAt ?? current.createdAt) : Number.NEGATIVE_INFINITY
    if (!current || at > currentAt || (at === currentAt && run.id.localeCompare(current.id) > 0)) {
      latest.set(run.automationId, run)
    }
  }
  return latest
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

function groupedAutomations(automations: readonly Automation[]): Automation[][] {
  const groups = new Map<string, Automation[]>()
  for (const automation of automations) {
    const authority = automationAuthority(automation).stable
    const key = `${hostStableKey(authority)}:${automation.id}`
    groups.set(key, [...(groups.get(key) ?? []), automation])
  }
  return [...groups.values()].sort((a, b) =>
    `${hostStableKey(automationAuthority(a[0]).stable)}:${a[0].id}`.localeCompare(
      `${hostStableKey(automationAuthority(b[0]).stable)}:${b[0].id}`
    )
  )
}

function foldGoalBinding(
  rows: Map<string, UnifiedAutomationRow>,
  automation: Automation,
  latest: AutomationRun | undefined,
  config: XosAutomationRunConfig,
  duplicateWarnings: UnifiedAutomationWarning[]
): boolean {
  if (!config.goal) {
    return false
  }
  const identity: UnifiedAutomationIdentity = {
    kind: 'goal',
    authority: LOCAL_UNIFIED_AUTHORITY,
    projectKey: config.goal.repoRoot,
    goal: config.goal.goal
  }
  const key = encodeUnifiedAutomationKey(identity)
  const target = rows.get(key)
  if (target?.kind !== 'goal' || target.lifecycle.state !== 'active') {
    return false
  }
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
  latestRuns: ReadonlyMap<string, AutomationRun>
): void {
  const groups = groupedAutomations(input.automations)
  const authoritiesById = new Map<string, Set<string>>()
  for (const group of groups) {
    const automation = group[0]
    const authorities = authoritiesById.get(automation.id) ?? new Set<string>()
    authorities.add(hostStableKey(automationAuthority(automation).stable))
    authoritiesById.set(automation.id, authorities)
  }
  for (const group of groups) {
    const automation = [...group].sort((a, b) =>
      `${a.updatedAt}:${a.name}`.localeCompare(`${b.updatedAt}:${b.name}`)
    )[0]
    const config = input.runConfigs[automation.id]
    const duplicateWarnings: UnifiedAutomationWarning[] =
      group.length > 1
        ? [
            {
              code: 'duplicate-native-identity',
              message: `Multiple native definitions claim ${automation.id} on the same authority.`
            }
          ]
        : []
    const latest = latestRuns.get(automation.id)
    if ((config?.goal || config?.script) && (authoritiesById.get(automation.id)?.size ?? 0) > 1) {
      const conflict = {
        code: 'binding-conflict' as const,
        message: `Runtime binding ${automation.id} is ambiguous across multiple authorities and was not folded.`
      }
      warnings.push(conflict)
      const row = nativeAutomationRow(automation, undefined, [...duplicateWarnings, conflict])
      rows.set(row.key, row)
      continue
    }
    if (config?.goal && config?.script) {
      const conflict = {
        code: 'binding-conflict' as const,
        message: `Native automation ${automation.id} is bound to both a Goal and a Script.`
      }
      warnings.push(conflict)
      const row = nativeAutomationRow(automation, latest, [...duplicateWarnings, conflict])
      rows.set(row.key, row)
      continue
    }
    if (foldGoalBinding(rows, automation, latest, config ?? {}, duplicateWarnings)) {
      continue
    }
    if (config?.goal) {
      const missing = {
        code: 'binding-target-missing' as const,
        message: `Goal binding ${config.goal.repoRoot}:${config.goal.goal} has no active exact target.`
      }
      warnings.push(missing)
      const row = nativeAutomationRow(automation, latest, [...duplicateWarnings, missing])
      rows.set(row.key, row)
      continue
    }
    const row = config?.script
      ? boundScriptRow(automation, latest, config)
      : nativeAutomationRow(automation, latest, duplicateWarnings)
    rows.set(row.key, {
      ...row,
      warnings: config?.script ? [...row.warnings, ...duplicateWarnings] : row.warnings
    })
  }
}

function addStaleBindingWarnings(
  rows: Map<string, UnifiedAutomationRow>,
  warnings: UnifiedAutomationWarning[],
  input: BuildUnifiedAutomationSnapshotInput
): void {
  const automationIds = new Set(input.automations.map((automation) => automation.id))
  for (const [automationId, config] of Object.entries(input.runConfigs)) {
    if ((!config.goal && !config.script) || automationIds.has(automationId)) {
      continue
    }
    const warning: UnifiedAutomationWarning = {
      code: 'stale-source',
      message: `Runtime binding ${automationId} has no native automation definition.`
    }
    warnings.push(warning)
    if (config.goal) {
      const key = encodeUnifiedAutomationKey({
        kind: 'goal',
        authority: LOCAL_UNIFIED_AUTHORITY,
        projectKey: config.goal.repoRoot,
        goal: config.goal.goal
      })
      const target = rows.get(key)
      if (target) {
        rows.set(key, { ...target, warnings: [...target.warnings, warning] })
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
  addBoardRows(rows, input.board)
  addNativeRows(rows, warnings, input, latestRunByAutomation(input.runs))
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
        input.automations.map((automation) => `${automation.id}:${automation.updatedAt}`)
      ),
      runtimeBindings: sourceRevision(
        Object.entries(input.runConfigs).map(
          ([id, config]) =>
            `${id}:${config.goal?.repoRoot ?? ''}:${config.goal?.goal ?? ''}:${config.script ? 'script' : ''}`
        )
      )
    },
    rows: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
    warnings
  }
}
