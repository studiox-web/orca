import type { Automation, AutomationRun } from './automations-types'
import { isTuiAgent } from './tui-agent-config'
import type { XosAutomationRunConfig } from './xos-runtime-types'
import type { XosCronJob, XosGoal, XosProject } from './xos-goals-types'
import { encodeUnifiedAutomationKey } from './unified-automation-identity'
import {
  automationAuthority,
  cronSchedule,
  goalRunSummary,
  LOCAL_UNIFIED_AUTHORITY,
  nativeRunSummary,
  nativeSchedule,
  unifiedMigrationState,
  unifiedScheduleState,
  unifiedSourceRef
} from './unified-automation-source-adapters'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationRow,
  UnifiedAutomationWarning
} from './unified-automation-types'

function goalStage(goal: XosGoal): string | null {
  return goal.status.status?.trim() || goal.status.result?.trim() || null
}

export function goalBaseRow(
  project: XosProject,
  goal: XosGoal,
  cronRevision: string
): UnifiedAutomationRow {
  const identity: UnifiedAutomationIdentity = {
    kind: 'goal',
    authority: LOCAL_UNIFIED_AUTHORITY,
    projectKey: project.key,
    goal: goal.goal
  }
  const schedules = goal.viewer.cron.jobs.map((job, index) =>
    cronSchedule(job, cronRevision, `goal:${project.key}:${goal.goal}`, index)
  )
  const runSummary = goalRunSummary(goal.viewer.latestRun)
  const warnings: UnifiedAutomationWarning[] = [
    ...(runSummary?.identity === 'legacy-without-run-id'
      ? [
          {
            code: 'legacy-run-without-id' as const,
            message: 'The latest Goal receipt has no stable run ID.'
          }
        ]
      : []),
    ...schedules.map(() => ({
      code: 'legacy-source-identity' as const,
      message:
        'This cron source is revision-scoped and read-only until occurrence-aware lineage exists.'
    }))
  ]
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'goal',
    name: goal.title,
    project: project.name,
    projectKey: project.key,
    host: 'This device (local-only Goals)',
    owner: schedules.length > 0 ? 'Goal files + legacy cron' : 'Goal files',
    lifecycle: { state: 'active', stage: goalStage(goal) },
    scheduleState: unifiedScheduleState(schedules),
    scheduleChildren: schedules,
    runSummary,
    agentId: goal.viewer.agents.find(isTuiAgent) ?? null,
    migrationState: unifiedMigrationState(schedules),
    sourceRefs: [
      unifiedSourceRef({
        kind: 'goal',
        sourceId: `${project.key}:${goal.goal}`,
        revision: goal.viewer.statusUpdatedAt,
        ownerKey: null,
        label: 'Goal files'
      }),
      ...schedules.map((child) => child.sourceRef)
    ],
    warnings,
    readOnly: true
  }
}

export function archivedGoalRow(
  project: XosProject,
  archived: XosProject['archived'][number]
): UnifiedAutomationRow {
  const identity: UnifiedAutomationIdentity = {
    kind: 'goal',
    authority: LOCAL_UNIFIED_AUTHORITY,
    projectKey: project.key,
    goal: archived.goal
  }
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'goal',
    name: archived.title,
    project: project.name,
    projectKey: project.key,
    host: 'This device (local-only Goals)',
    owner: 'Archived Goal files',
    lifecycle: { state: 'archived', stage: null },
    scheduleState: 'unscheduled',
    scheduleChildren: [],
    runSummary: null,
    agentId: null,
    migrationState: 'none',
    sourceRefs: [
      unifiedSourceRef({
        kind: 'goal',
        sourceId: archived.path,
        revision: archived.archivedAt,
        ownerKey: null,
        label: 'Archived Goal files'
      })
    ],
    warnings: [],
    readOnly: true
  }
}

export function cronScriptRow(
  project: XosProject | null,
  job: XosCronJob,
  revision: string,
  occurrence: number
): UnifiedAutomationRow {
  const scope = project?.key ?? 'unscoped'
  const identity: UnifiedAutomationIdentity = {
    kind: 'script',
    authority: LOCAL_UNIFIED_AUTHORITY,
    sourceId: `cron:${revision}:${scope}:${job.id}:${occurrence}`
  }
  const schedule = cronSchedule(job, revision, `script:${scope}`, occurrence)
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'script',
    name: job.name,
    project: project?.name ?? null,
    projectKey: project?.key ?? null,
    host: 'This device',
    owner: 'Legacy cron',
    lifecycle: { state: 'present', stage: 'Legacy definition' },
    scheduleState: unifiedScheduleState([schedule]),
    scheduleChildren: [schedule],
    runSummary: null,
    agentId: null,
    migrationState: 'legacy',
    sourceRefs: [schedule.sourceRef],
    warnings: [
      {
        code: 'legacy-source-identity',
        message:
          'This script is identified only within the current crontab revision and is read-only.'
      }
    ],
    readOnly: true
  }
}

export function nativeAutomationRow(
  automation: Automation,
  latest: AutomationRun | undefined,
  warnings: UnifiedAutomationWarning[] = []
): UnifiedAutomationRow {
  const authority = automationAuthority(automation)
  const identity: UnifiedAutomationIdentity = {
    kind: 'automation',
    authority: authority.stable,
    automationId: automation.id
  }
  const schedule = nativeSchedule(automation)
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'automation',
    name: automation.name,
    project: automation.runContext?.path ?? automation.projectId ?? null,
    projectKey: automation.runContext?.projectId ?? automation.projectId ?? null,
    host: authority.host,
    owner: 'Orca',
    lifecycle: { state: 'present', stage: 'Native definition' },
    scheduleState: unifiedScheduleState([schedule]),
    scheduleChildren: [schedule],
    runSummary: nativeRunSummary(latest),
    agentId: automation.agentId,
    migrationState: warnings.length > 0 ? 'conflict' : 'none',
    sourceRefs: [schedule.sourceRef],
    warnings,
    readOnly: true
  }
}

export function boundScriptRow(
  automation: Automation,
  latest: AutomationRun | undefined,
  config: XosAutomationRunConfig
): UnifiedAutomationRow {
  const authority = automationAuthority(automation)
  const identity: UnifiedAutomationIdentity = {
    kind: 'script',
    authority: authority.stable,
    sourceId: `native-binding:${automation.id}`
  }
  const schedule = nativeSchedule(automation)
  const binding = unifiedSourceRef({
    kind: 'runtime-binding',
    authority: authority.stable,
    sourceId: automation.id,
    revision: String(automation.updatedAt),
    ownerKey: authority.capturedOwner,
    label: 'XOS Script binding'
  })
  return {
    key: encodeUnifiedAutomationKey(identity),
    identity,
    kind: 'script',
    name: automation.name,
    project: config.script?.cwd ?? null,
    projectKey: config.script?.cwd ?? null,
    host: authority.host,
    owner: 'Orca Script binding',
    lifecycle: { state: 'present', stage: 'Bound definition' },
    scheduleState: unifiedScheduleState([schedule]),
    scheduleChildren: [schedule],
    runSummary: nativeRunSummary(latest),
    agentId: null,
    migrationState: 'none',
    sourceRefs: [binding, schedule.sourceRef],
    warnings: config.script?.replacesCronCommand
      ? [
          {
            code: 'legacy-source-identity',
            message:
              'A possible replaced cron command is recorded as evidence, not identity; no rows were folded by command text.'
          }
        ]
      : [],
    readOnly: true
  }
}
