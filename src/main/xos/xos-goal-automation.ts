// XOS fork: C1. A goal runs unattended as an Orca automation bound to it: the upstream scheduler,
// run rows, terminals and chats stay, and each dispatch swaps in the goal's assembled prompt after
// the cutover, authority and queue gates. The stored automation is never changed, so upstream's
// "automation changed" fence is unaffected.
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { XosGoalBinding } from '../../shared/xos-runtime-types'
import { goalForCommand, parseCrontabWithPaused, readCrontabText } from './xos-crontab'
import { goalAuthority, isGoalAuthorityConfirmed } from './xos-goal-authority'
import { assembleGoalPrompt, markGoalInboxRead } from './xos-goal-prompt'
import { settleWorkItem } from './xos-item-outcome'
import type { XosRunLimitVerdict } from './xos-limit-classifier'
import { appendReceipt, goalRunsToday } from './xos-native-receipts'
import { goalRunTimeoutMinutes } from './xos-goal-run-timeout'
import { commitProjectHome, projectHomeDir, resolveGoalDir } from './xos-project-home'

export type XosGoalLaunch = {
  prompt: string
  lockLane: string
  lockWaitMinutes: number
  timeoutMinutes: number
  itemPath: string | null
  inboxPaths: string[]
}

/** PF7: an active crontab line for this goal means the legacy owner has not been cut over. */
export async function activeCronLineForGoal(binding: XosGoalBinding): Promise<string | null> {
  const lines = parseCrontabWithPaused(await readCrontabText())
  const known = new Set([binding.goal])
  const line = lines.find(
    (entry) =>
      !entry.paused &&
      entry.workdir?.startsWith(binding.repoRoot) &&
      goalForCommand(entry.command, known).goal === binding.goal
  )
  return line?.command ?? null
}

export async function prepareGoalLaunch(
  automation: Automation,
  run: AutomationRun,
  binding: XosGoalBinding
): Promise<{ skip: string } | XosGoalLaunch> {
  const legacy = await activeCronLineForGoal(binding)
  if (legacy) {
    return { skip: `${binding.goal} still has an active crontab line; cut it over first.` }
  }
  const scheduled = run.trigger === 'scheduled'
  const nowMs = Date.now()
  const assembled = assembleGoalPrompt({
    repoRoot: binding.repoRoot,
    goal: binding.goal,
    requestedAgent: automation.agentId,
    runsToday: goalRunsToday(binding.repoRoot, binding.goal, nowMs),
    bypassQueueGate: !scheduled,
    nowMs
  })
  if (assembled.status !== 'ready') {
    return { skip: assembled.reason }
  }
  const fm = assembled.frontmatter
  if (
    scheduled &&
    goalAuthority(fm).elevated &&
    !isGoalAuthorityConfirmed(binding.repoRoot, binding.goal, fm)
  ) {
    return { skip: `${binding.goal} has deploy or push authority that was never confirmed.` }
  }
  const homes = [
    `- ORCA_GOAL_HOME: ${resolveGoalDir(binding.repoRoot, binding.goal)}`,
    `- ORCA_PROJECT_HOME: ${projectHomeDir(binding.repoRoot)}`
  ].join('\n')
  return {
    prompt: `${assembled.prompt}\n\n## Run Environment\n\n${homes}`,
    lockLane: assembled.lockLane,
    lockWaitMinutes: Math.ceil(assembled.lockWaitSeconds / 60),
    timeoutMinutes: goalRunTimeoutMinutes(fm),
    itemPath: assembled.queueGate?.candidateItemPaths[0] ?? null,
    inboxPaths: assembled.inboxPaths
  }
}

/** The goal side of a finished bound automation: receipt, item, inbox, project home. */
export function settleGoalAutomationRun(args: {
  run: AutomationRun
  goal: { repoRoot: string; goal: string; itemPath: string | null; inboxPaths: string[] }
  startedAt: string
  verdict: XosRunLimitVerdict | null
  commit: { sha: string | null; failed: boolean } | null
}): void {
  const { run, goal, verdict } = args
  const launched = run.status === 'completed' || run.status === 'dispatch_failed'
  const success = run.status === 'completed' && !verdict && !args.commit?.failed
  if (launched) {
    markGoalInboxRead(goal.inboxPaths, goal.goal)
  }
  if (goal.itemPath) {
    settleWorkItem({
      repoRoot: goal.repoRoot,
      goal: goal.goal,
      itemPath: goal.itemPath,
      runId: run.id,
      success,
      error: verdict?.evidence ?? run.error,
      commit: args.commit?.sha
    })
  }
  const finishedAt = new Date().toISOString()
  appendReceipt(goal.repoRoot, {
    run_id: run.id,
    goal: goal.goal,
    runner: null,
    status: success ? 'success' : 'failed',
    started_at: args.startedAt,
    finished_at: finishedAt,
    duration_seconds: Math.max(
      0,
      Math.round((Date.parse(finishedAt) - Date.parse(args.startedAt)) / 1000)
    ),
    exit_code: null,
    log_path: '',
    failure_reason: success ? null : (verdict?.kind ?? 'run_failed'),
    trigger: run.trigger,
    mode: 'normal',
    item_path: goal.itemPath
  })
  void commitProjectHome(goal.repoRoot, `xos: automation run ${goal.goal} (${run.status})`)
}
