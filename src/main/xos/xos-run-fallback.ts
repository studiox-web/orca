// XOS fork: RT5 fallback chain for terminal automation runs (plan §3.4). Two thin hooks call in:
// - xosLaunchAutomation (automation-dispatch-request): records which model a run uses and, for a
//   fallback retry, launches with the next model instead of the stored one. The stored automation is
//   never changed, so upstream's "automation changed" fence is unaffected.
// - xosObserveFinishedRun (service.markDispatchResult): classifies the final screen; on a usage
//   limit it queues the next model in the chain and starts a linked manual run.
import { Notification } from 'electron'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { XosModelChoice } from '../../shared/xos-runtime-types'
import { readXosModelArgs, writeXosModelArgs } from '../../shared/xos-model-args'
import type { XosAutomationRunConfig } from '../../shared/xos-runtime-types'
import { xosPreviewAuto } from './xos-auto-mode'
import { classifyRunScreen, describeLimit, type XosRunLimitVerdict } from './xos-limit-classifier'
import { assessQuota } from './xos-quota'
import { appendLedger, readRunConfig } from './xos-runtime-store'

/** A queued retry must be picked up by the run it starts, not by a much later manual run. */
const PENDING_TTL_MS = 2 * 60_000
const MAX_ATTEMPTS = 6

type Chain = {
  rootRunId: string
  rootTrigger: AutomationRun['trigger']
  attempt: number
  choice: XosModelChoice
  /** The chain this root run walks: Auto's ranking, or the primary plus the fallbacks. */
  options: XosModelChoice[]
}

type Pending = Chain & { parentRunId: string; reason: string; expiresAt: number }

const pending = new Map<string, Pending>()
const chains = new Map<string, Chain>()
/** Automations started from a lane queue: their run counts as scheduled (it replaces one). */
const queuedStarts = new Map<string, number>()
/** Upstream may report one completion twice; only the first may start a fallback. */
const handled = new Set<string>()
const HANDLED_LIMIT = 500

export function markQueuedStart(automationId: string): void {
  queuedStarts.set(automationId, Date.now() + PENDING_TTL_MS)
}

function rootTrigger(automationId: string, run: AutomationRun): AutomationRun['trigger'] {
  const until = queuedStarts.get(automationId)
  queuedStarts.delete(automationId)
  return run.trigger === 'manual' && until !== undefined && until > Date.now()
    ? 'scheduled'
    : run.trigger
}

export function primaryChoice(automation: Automation): XosModelChoice {
  const { model, effort } = readXosModelArgs(automation.agentId, automation.extraAgentArgs ?? '')
  return { agent: automation.agentId, model, effort }
}

export function choiceLabel(choice: XosModelChoice): string {
  return [choice.agent, choice.model ?? 'default model', choice.effort].filter(Boolean).join(' · ')
}

function withChoice(automation: Automation, choice: XosModelChoice): Automation | null {
  const agent = choice.agent as TuiAgent
  const base = agent === automation.agentId ? (automation.extraAgentArgs ?? '') : ''
  const args = writeXosModelArgs(agent, base, { model: choice.model, effort: choice.effort })
  if (args === null) {
    return null
  }
  return { ...automation, agentId: agent, extraAgentArgs: args || undefined }
}

function sameChoice(a: XosModelChoice, b: XosModelChoice): boolean {
  return a.agent === b.agent && a.model === b.model && a.effort === b.effort
}

function fallsBack(trigger: AutomationRun['trigger'], config: XosAutomationRunConfig): boolean {
  return trigger !== 'manual' || config.fallbackOnManualRuns
}

/** The chain for a new root run and where to start in it, with the reason when not at the top. */
async function planRoot(
  automation: Automation,
  trigger: AutomationRun['trigger'],
  config: XosAutomationRunConfig
): Promise<{ options: XosModelChoice[]; start: number; reason: string | null }> {
  const primary = primaryChoice(automation)
  if (config.auto) {
    const preview = await xosPreviewAuto(config.auto)
    const picks = preview.candidates.filter((entry) => entry.available).map((entry) => entry.choice)
    if (picks.length === 0) {
      return {
        options: [primary, ...config.fallbacks],
        start: 0,
        reason: `Auto found nothing (${preview.reason}); ran the automation's own model`
      }
    }
    const extra = config.fallbacks.filter(
      (choice) => !picks.some((pick) => sameChoice(pick, choice))
    )
    return { options: [...picks, ...extra], start: 0, reason: preview.reason }
  }
  const options = [primary, ...config.fallbacks]
  if (config.fallbacks.length === 0 || !fallsBack(trigger, config)) {
    return { options, start: 0, reason: null }
  }
  // Plan §3.4 "before launch": a model whose quota is known to be used up is skipped.
  const notes: string[] = []
  for (let index = 0; index < options.length; index += 1) {
    const quota = assessQuota(options[index].agent, options[index].model, 0)
    if (!quota.exhausted) {
      return {
        options,
        start: index,
        reason: index > 0 ? `skipped before launch: ${notes.join('; ')}` : null
      }
    }
    notes.push(quota.note)
  }
  return { options, start: 0, reason: null }
}

export async function xosLaunchAutomation(
  automation: Automation,
  run: AutomationRun
): Promise<Automation> {
  try {
    const trigger = rootTrigger(automation.id, run)
    let chain: Chain
    let parentRunId: string | null = null
    let reason: string | null
    const queued = pending.get(automation.id)
    if (queued && run.trigger === 'manual' && queued.expiresAt > Date.now()) {
      pending.delete(automation.id)
      const { parentRunId: parent, reason: why, expiresAt: _expires, ...rest } = queued
      chain = rest
      parentRunId = parent
      reason = why
    } else {
      const plan = await planRoot(automation, trigger, readRunConfig(automation.id))
      chain = {
        rootRunId: run.id,
        rootTrigger: trigger,
        attempt: plan.start,
        choice: plan.options[plan.start],
        options: plan.options
      }
      reason = plan.reason
    }
    const launched = withChoice(automation, chain.choice)
    if (!launched) {
      chain = { ...chain, choice: primaryChoice(automation) }
    }
    chains.set(run.id, chain)
    appendLedger({
      type: 'attempt',
      runId: run.id,
      automationId: automation.id,
      at: new Date().toISOString(),
      attempt: chain.attempt,
      rootRunId: chain.rootRunId,
      parentRunId,
      agent: chain.choice.agent,
      model: chain.choice.model,
      effort: chain.choice.effort,
      reason
    })
    return launched ?? automation
  } catch (error) {
    console.warn('[xos] fallback launch overlay failed; launching as stored', error)
    return automation
  }
}

export function notify(body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'Orca automation', body }).show()
    }
  } catch {
    // Headless orcad may have no notification service; the ledger still records the hop.
  }
}

/** The next chain entry to try, skipping the failing agent when the cause is the agent itself. */
function nextChoice(
  chain: readonly XosModelChoice[],
  from: number,
  failed: XosModelChoice,
  verdict: XosRunLimitVerdict
): number {
  for (let index = from + 1; index < chain.length && index < MAX_ATTEMPTS; index += 1) {
    const sameAgentBroken = verdict.kind === 'auth' || verdict.kind === 'missing-binary'
    if (sameAgentBroken && chain[index].agent === failed.agent) {
      continue
    }
    return index
  }
  return -1
}

export function xosObserveFinishedRun(
  host: { automation: Automation | undefined; runNow: (automationId: string) => Promise<unknown> },
  run: AutomationRun
): void {
  try {
    if ((run.status !== 'completed' && run.status !== 'dispatch_failed') || handled.has(run.id)) {
      return
    }
    handled.add(run.id)
    if (handled.size > HANDLED_LIMIT) {
      handled.delete(handled.values().next().value as string)
    }
    const chain = chains.get(run.id)
    chains.delete(run.id)
    const verdict = classifyRunScreen(run.outputSnapshot?.content) ?? classifyRunScreen(run.error)
    appendLedger({
      type: 'outcome',
      runId: run.id,
      kind: verdict?.kind ?? (run.status === 'completed' ? 'ok' : 'failed'),
      detail: verdict ? verdict.evidence : (run.error ?? null),
      at: new Date().toISOString()
    })
    const automation = host.automation
    if (!verdict || !automation) {
      return
    }
    const config = readRunConfig(automation.id)
    const current = chain ?? {
      rootRunId: run.id,
      rootTrigger: run.trigger,
      attempt: 0,
      choice: primaryChoice(automation),
      options: [primaryChoice(automation), ...config.fallbacks]
    }
    const what = `${automation.name}: ${describeLimit(verdict)} on ${choiceLabel(current.choice)}`
    if (!fallsBack(current.rootTrigger, config)) {
      notify(`${what}. Manual runs don't fall back unless you turn it on in the automation.`)
      return
    }
    const options = current.options
    const index = nextChoice(options, current.attempt, current.choice, verdict)
    if (index === -1) {
      notify(
        options.length <= 1
          ? `${what}. Add fallback models to this automation to retry on another model.`
          : `${what}. Every fallback has been tried.`
      )
      return
    }
    pending.set(automation.id, {
      rootRunId: current.rootRunId,
      rootTrigger: current.rootTrigger,
      attempt: index,
      choice: options[index],
      options,
      parentRunId: run.id,
      reason: describeLimit(verdict),
      expiresAt: Date.now() + PENDING_TTL_MS
    })
    notify(`${what}. Retrying on ${choiceLabel(options[index])}.`)
    void host.runNow(automation.id).catch((error) => {
      pending.delete(automation.id)
      notify(`${automation.name}: the fallback run could not start (${String(error)}).`)
    })
  } catch (error) {
    console.warn('[xos] fallback observation failed', error)
  }
}
