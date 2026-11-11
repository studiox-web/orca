// XOS fork: structured model + reasoning effort for an automation (plan §3.2, RT1/RT2), stored in
// upstream's own `extraAgentArgs` so both dispatch paths (renderer and orcad) already apply it.
// Only the model/effort flags are read or rewritten; any other allowed extras are kept as-is.
import type { TuiAgent } from './tui-agent'
import { quoteStartupArg, tokenizeStartupCommand } from './tui-agent-startup-shell'

/** Plain tokens stay readable in the editor's Extra arguments field; anything else is quoted. */
function quote(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(token) ? token : quoteStartupArg(token, 'posix')
}

type EffortSpec = {
  flags: readonly string[]
  /** Codex sets effort through a config override: `-c model_reasoning_effort=high`. */
  valuePrefix?: string
  emit: (value: string) => string[]
}

type ModelFlagSpec = {
  modelFlags: readonly string[]
  emitModel: (value: string) => string[]
  effort?: EffortSpec
}

const DASH_EFFORT: EffortSpec = { flags: ['--effort'], emit: (value) => ['--effort', value] }

// Mirrors the model/effort entries of upstream's extra-args allowlist (automation-extra-agent-args).
const SPECS: Partial<Record<TuiAgent, ModelFlagSpec>> = {
  claude: { modelFlags: ['--model'], emitModel: (v) => ['--model', v], effort: DASH_EFFORT },
  codex: {
    modelFlags: ['-m', '--model'],
    emitModel: (v) => ['-m', v],
    effort: {
      flags: ['-c', '--config'],
      valuePrefix: 'model_reasoning_effort=',
      emit: (value) => ['-c', `model_reasoning_effort=${value}`]
    }
  },
  grok: {
    modelFlags: ['-m', '--model'],
    emitModel: (v) => ['--model', v],
    effort: {
      flags: ['--effort', '--reasoning-effort'],
      emit: (value) => ['--effort', value]
    }
  },
  codebuddy: { modelFlags: ['--model'], emitModel: (v) => ['--model', v], effort: DASH_EFFORT },
  cursor: { modelFlags: ['-m', '--model'], emitModel: (v) => ['--model', v] },
  omp: { modelFlags: ['--model'], emitModel: (v) => ['--model', v] }
}

export type XosModelArgs = { model: string | null; effort: string | null }

export function xosModelArgsSupported(agent: TuiAgent): boolean {
  return SPECS[agent] !== undefined
}

export function xosAgentTakesEffort(agent: TuiAgent): boolean {
  return SPECS[agent]?.effort !== undefined
}

type Scan = XosModelArgs & { rest: string[] }

function scan(agent: TuiAgent, extraAgentArgs: string): Scan | null {
  const spec = SPECS[agent]
  const tokenized = tokenizeStartupCommand(extraAgentArgs.trim(), 'posix')
  if (!spec || !tokenized.ok) {
    return null
  }
  const tokens = tokenized.tokens
  const result: Scan = { model: null, effort: null, rest: [] }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const [name, inline] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, null]
    if (spec.modelFlags.includes(name)) {
      result.model = inline ?? tokens[index + 1] ?? null
      index += inline === null ? 1 : 0
      continue
    }
    const effort = spec.effort
    if (effort && effort.flags.includes(name)) {
      const value = inline ?? tokens[index + 1] ?? ''
      if (!effort.valuePrefix) {
        result.effort = value || null
        index += inline === null ? 1 : 0
        continue
      }
      if (value.startsWith(effort.valuePrefix)) {
        result.effort = value.slice(effort.valuePrefix.length) || null
        index += inline === null ? 1 : 0
        continue
      }
    }
    result.rest.push(token)
  }
  return result
}

/** The model/effort an automation's extra arguments select, or nulls for "agent default". */
export function readXosModelArgs(agent: TuiAgent, extraAgentArgs: string): XosModelArgs {
  const found = scan(agent, extraAgentArgs)
  return { model: found?.model ?? null, effort: found?.effort ?? null }
}

/** Rewrites only the model/effort flags; returns null when the existing text cannot be parsed. */
export function writeXosModelArgs(
  agent: TuiAgent,
  extraAgentArgs: string,
  choice: XosModelArgs
): string | null {
  const spec = SPECS[agent]
  const found = scan(agent, extraAgentArgs)
  if (!spec || !found) {
    return null
  }
  const tokens = [
    ...(choice.model ? spec.emitModel(choice.model) : []),
    ...(choice.effort && spec.effort ? spec.effort.emit(choice.effort) : []),
    ...found.rest
  ]
  return tokens.map(quote).join(' ')
}
