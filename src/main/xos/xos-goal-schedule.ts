// XOS fork: C1/C2. Creates the Orca automation behind a goal or a migrated crontab job. It always
// starts disabled: enabling it is a separate, reviewed act, and dispatch still refuses while the
// legacy crontab line is active (PF7).
import type { Automation, AutomationCreateInput } from '../../shared/automations-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { XosAutomationRunConfig } from '../../shared/xos-runtime-types'
import { audit } from './xos-crontab'
import { buildMigrationPlan, type XosMigrationEntry } from './xos-cron-migration'
import { readCrontabText } from './xos-crontab'
import { frontmatterList, parseFrontmatter, readHead } from './xos-goal-files'
import { resolveGoalDir } from './xos-project-home'
import { listRunConfigs, readRunConfig, writeRunConfig } from './xos-runtime-store'

type ReplacementInput = Omit<AutomationCreateInput, 'projectId' | 'timezone'> & {
  workspace: string
  timezone?: string
}

export type XosScheduleHost = {
  createAutomation: (input: ReplacementInput) => Promise<Automation>
}

function existingBinding(match: (config: XosAutomationRunConfig) => boolean): string | null {
  return Object.entries(listRunConfigs()).find(([, config]) => match(config))?.[0] ?? null
}

async function createDisabled(
  host: XosScheduleHost,
  args: {
    repoRoot: string
    name: string
    prompt: string
    agent: TuiAgent
    schedule: string
    timezone?: string
    binding: Partial<Pick<XosAutomationRunConfig, 'goal' | 'script'>>
  }
): Promise<{ ok: true; automationId: string; message: string }> {
  const automation = await host.createAutomation({
    name: args.name,
    prompt: args.prompt,
    agentId: args.agent,
    workspace: `path:${args.repoRoot}`,
    workspaceMode: 'existing',
    rrule: args.schedule,
    dtstart: Date.now(),
    timezone: args.timezone,
    enabled: false
  })
  writeRunConfig(automation.id, { ...readRunConfig(automation.id), ...args.binding })
  audit({ action: 'automation.bound', automationId: automation.id, name: args.name })
  return {
    ok: true,
    automationId: automation.id,
    message: `Created "${args.name}" disabled. Review it, then enable it in Automations.`
  }
}

export async function scheduleGoal(
  host: XosScheduleHost,
  args: { repoRoot: string; goal: string; schedule: string; agent?: string; timezone?: string }
): Promise<{ ok: true; automationId: string; message: string } | { ok: false; error: string }> {
  const bound = existingBinding(
    (config) => config.goal?.goal === args.goal && config.goal.repoRoot === args.repoRoot
  )
  if (bound) {
    return { ok: false, error: `${args.goal} already has automation ${bound}.` }
  }
  const fm = parseFrontmatter(readHead(`${resolveGoalDir(args.repoRoot, args.goal)}/GOAL.md`))
  const agent = args.agent ?? frontmatterList(fm, 'agents')[0] ?? 'codex'
  return createDisabled(host, {
    repoRoot: args.repoRoot,
    name: `Goal: ${args.goal}`,
    // Replaced at dispatch by the assembled prompt; shown in the automation list.
    prompt: `Run the ${args.goal} goal. Orca assembles the real prompt at dispatch.`,
    agent: agent as TuiAgent,
    schedule: args.schedule,
    timezone: args.timezone,
    binding: { goal: { repoRoot: args.repoRoot, goal: args.goal } }
  })
}

function scheduleOf(entry: XosMigrationEntry): string | null {
  return entry.cronExpression
}

/** One crontab line → its replacement: a goal binding, or a script automation for the rest. */
export async function replaceCronJob(
  host: XosScheduleHost,
  args: { jobId: string; timezone?: string }
): Promise<{ ok: true; automationId: string; message: string } | { ok: false; error: string }> {
  const plan = buildMigrationPlan(await readCrontabText(), listRunConfigs())
  const entry = plan.entries.find((candidate) => candidate.id === args.jobId)
  if (!entry) {
    return { ok: false, error: `Crontab job ${args.jobId} was not found.` }
  }
  if (entry.replacementAutomationId) {
    return { ok: false, error: `Already replaced by ${entry.replacementAutomationId}.` }
  }
  const schedule = scheduleOf(entry)
  if (!schedule || !entry.workdir) {
    return { ok: false, error: 'This line has no schedule or working folder Orca can move.' }
  }
  const timezone = args.timezone ?? plan.timezone ?? undefined
  if (entry.goal) {
    return scheduleGoal(host, {
      repoRoot: entry.workdir,
      goal: entry.goal,
      schedule,
      agent: entry.runner ?? undefined,
      timezone
    })
  }
  return createDisabled(host, {
    repoRoot: entry.workdir,
    name: `Script: ${entry.command.slice(0, 60)}`,
    prompt: `Script automation: ${entry.command}`,
    agent: 'claude',
    schedule,
    timezone,
    binding: {
      script: { command: entry.command, cwd: entry.workdir, replacesCronCommand: entry.command }
    }
  })
}
