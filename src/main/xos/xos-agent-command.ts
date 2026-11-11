// XOS fork: the one-shot agent command for native goal runs. Prompts go over stdin (RT3), because a
// single argv string caps at 128 KiB on Linux, and every value is single-quoted so a frontmatter
// model or a repo path can't reach the shell. Only agents with a verified one-shot mode run here.
import type { XosModelChoice } from '../../shared/xos-runtime-types'

export const NATIVE_AGENTS: readonly string[] = ['claude', 'codex']

/** RT9: the cheap model of each agent for inbox-only reply runs. */
const REPLY_MODELS: Record<string, string> = { codex: 'gpt-5.4-mini', claude: 'haiku' }

/** RT5 tier rows: index = tier, so a fallback keeps roughly the strength it replaced. */
const TIER_ROWS: Record<string, string>[] = [
  { codex: 'gpt-5.5', claude: 'opus' },
  { codex: 'gpt-5.4-mini', claude: 'sonnet' },
  { codex: 'gpt-5.3-codex-spark', claude: 'haiku' }
]

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function replyModelFor(agent: string): string | null {
  return REPLY_MODELS[agent] ?? null
}

/** A model name only means something to its own provider; null means "the agent's default". */
export function modelFitsAgent(agent: string, model: string | null): boolean {
  if (!model) {
    return true
  }
  const openai = /^(?:gpt|o\d|codex)/i.test(model)
  const anthropic = /^(?:claude|opus|sonnet|haiku|fable)/i.test(model)
  if (agent === 'codex') {
    return !anthropic
  }
  return agent === 'claude' ? !openai : !openai && !anthropic
}

/** Same-tier model on another agent, or null when the tier map has no row for it. */
export function equivalentModel(model: string | null, agent: string): string | null {
  if (!model) {
    return null
  }
  const row = TIER_ROWS.find((entry) => Object.values(entry).includes(model))
  return row?.[agent] ?? null
}

/** The chain after `current`: declared `fallbacks`, else the other allowed agents at the same tier. */
export function nativeFallbackChain(
  current: XosModelChoice,
  allowedAgents: readonly string[],
  declared: readonly string[]
): XosModelChoice[] {
  const parsed = declared.map((entry): XosModelChoice => {
    const [agent, model] = entry.split(':', 2).map((part) => part.trim())
    return { agent, model: model || null, effort: null }
  })
  const derived = allowedAgents
    .filter((agent) => agent !== current.agent)
    .map((agent): XosModelChoice => ({
      agent,
      model: equivalentModel(current.model, agent),
      effort: null
    }))
  return (parsed.length > 0 ? parsed : derived).filter((choice) =>
    NATIVE_AGENTS.includes(choice.agent)
  )
}

export type AgentRunCommandArgs = {
  root: string
  promptPath: string
  agent: string
  model: string | null
  effort: string | null
  lockLane: string
  inboxOnly: boolean
  /** Unattended authority confirmed by the operator (§3d); otherwise the agent stays sandboxed. */
  bypassPermissions: boolean
}

/** Throws for an agent without a one-shot mode, rather than silently running a different one. */
export function buildAgentRunCommand(args: AgentRunCommandArgs): string {
  if (!NATIVE_AGENTS.includes(args.agent)) {
    throw new Error(`Native goal runs support ${NATIVE_AGENTS.join(' and ')}, not "${args.agent}".`)
  }
  const env = [
    `CASCADE_ACTIVE_LOCK_LANE=${shellQuote(args.lockLane)}`,
    ...(args.inboxOnly ? ['CASCADE_GOAL_INBOX_ONLY=1'] : [])
  ].join(' ')
  const cd = `cd ${shellQuote(args.root)} &&`
  const prompt = `< ${shellQuote(args.promptPath)}`
  if (args.agent === 'claude') {
    const flags = [
      ...(args.model ? [`--model ${shellQuote(args.model)}`] : []),
      ...(args.effort ? [`--effort ${shellQuote(args.effort)}`] : []),
      args.bypassPermissions ? '--dangerously-skip-permissions' : '--permission-mode acceptEdits'
    ]
    return `${cd} ${env} claude -p ${flags.join(' ')} ${prompt}`
  }
  const flags = [
    args.bypassPermissions
      ? '--dangerously-bypass-approvals-and-sandbox'
      : '--sandbox workspace-write',
    `-C ${shellQuote(args.root)}`,
    ...(args.model ? [`-m ${shellQuote(args.model)}`] : []),
    ...(args.effort ? [`-c ${shellQuote(`model_reasoning_effort="${args.effort}"`)}`] : [])
  ]
  return `${cd} ${env} codex exec ${flags.join(' ')} - ${prompt}`
}
