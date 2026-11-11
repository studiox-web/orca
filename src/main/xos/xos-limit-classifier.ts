// XOS fork: RT4 limit classification for terminal-surface automation runs. Orca's terminal runs
// are interactive agents that go idle rather than exit, so there is no exit code: the verdict comes
// from the last lines on screen only (a goal whose own work mentions "429" must not fall back).
// Only usage limits, overload, auth failures and a missing agent binary qualify; a real task
// failure never falls back (plan §3.4).

import type { XosRunLimitKind } from '../../shared/xos-runtime-types'

export type { XosRunLimitKind }

export type XosRunLimitVerdict = {
  kind: XosRunLimitKind
  /** The screen line that matched, trimmed, for the run record and notifications. */
  evidence: string
  /** "resets 3pm", "try again in 3 days"… when the banner says. */
  resetHint: string | null
}

/** How many non-empty lines from the bottom of the screen are inspected. */
export const LIMIT_TAIL_LINES = 25

type Rule = {
  kind: XosRunLimitKind
  pattern: RegExp
  /** Generic wording: only as a line's own message, not inside prose. */ lineStart?: boolean
}

const RULES: Rule[] = [
  // Claude: "You've hit your limit · resets 3pm"; Codex: "You've hit your usage limit. Try again…"
  { kind: 'usage-limit', pattern: /\byou(?:'|’)?ve hit your (?:\w+ )?limit\b/i },
  {
    kind: 'usage-limit',
    pattern:
      /\b(?:usage|session|weekly|monthly|5-hour|five-hour|opus) limit (?:reached|exceeded)\b/i
  },
  { kind: 'usage-limit', pattern: /\bclaude (?:ai )?usage limit reached\b/i },
  {
    kind: 'usage-limit',
    pattern: /\b(?:spend|spending) (?:cap|limit) (?:reached|hit|exceeded)\b/i
  },
  { kind: 'usage-limit', pattern: /\bhit your (?:monthly|weekly|usage|spend)\b.{0,20}\blimit\b/i },
  {
    kind: 'usage-limit',
    pattern: /\bout of (?:credits|extra usage)\b|\bcredit balance is too low\b/i
  },
  { kind: 'usage-limit', pattern: /\bexceeded retry limit, last status: 429\b/i },
  {
    kind: 'usage-limit',
    pattern:
      /429 too many requests\b|quota exceeded\b|RESOURCE_EXHAUSTED\b|rate limit reached for\b/i,
    lineStart: true
  },
  { kind: 'overloaded', pattern: /\bAPI Error: 529\b|\boverloaded_error\b|\b529 Overloaded\b/i },
  { kind: 'auth', pattern: /\binvalid api key\b|please run \/login\b/i },
  {
    kind: 'auth',
    pattern:
      /failed to authenticate\b|401 invalid authentication credentials\b|oauth token (?:has )?expired\b|not logged in\b/i,
    lineStart: true
  }
]

/** Log prefixes a banner may carry and still be the line's own message. */
const LINE_START = /^(?:(?:error|fatal|api error|stream error)\s*:?\s*)*/i

function ruleMatches(rule: Rule, line: string): boolean {
  const match = rule.pattern.exec(line)
  if (!match) {
    return false
  }
  return !rule.lineStart || match.index <= (LINE_START.exec(line)?.[0].length ?? 0)
}

const RESET_HINT = /\b(?:resets?(?: at| in)? [\w:., ]{1,30}|try again (?:at|in) [\w:., ]{1,30})/i

const AGENT_BINARIES = [
  'claude',
  'codex',
  'grok',
  'cursor-agent',
  'codebuddy',
  'omp',
  'gemini',
  'agy'
]

function missingBinary(line: string): boolean {
  const match = /(?:^|\s|:)([\w.-]+): (?:command not found|not found)\b/i.exec(line)
  return match !== null && AGENT_BINARIES.includes(match[1].toLowerCase())
}

/** Removes ANSI colour/cursor codes and TUI box borders around a line. */
function clean(line: string): string {
  return (
    line
      // oxlint-disable-next-line no-control-regex -- terminal snapshots can carry escape codes
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/^[\s│┃|╭╮╰╯─━>⎿●✻*·■⚠]+|[\s│┃|╭╮╰╯─━]+$/g, '')
      .trim()
  )
}

/**
 * RT4. `exitCode` 0 means the agent says it succeeded, so only a screen that is nothing but a banner
 * counts; non-zero or unknown (terminal runs have no exit code) reads the bottom of the screen.
 */
export function classifyRunScreen(
  screen: string | null | undefined,
  options: { exitCode?: number | null } = {}
): XosRunLimitVerdict | null {
  if (!screen) {
    return null
  }
  const all = screen.split('\n').map(clean).filter(Boolean)
  if (options.exitCode === 0 && all.length > LIMIT_TAIL_LINES) {
    return null
  }
  const lines = all.slice(-LIMIT_TAIL_LINES)
  // Bottom-up: the most recent banner wins over anything earlier in the tail.
  for (const line of lines.toReversed()) {
    if (missingBinary(line)) {
      return { kind: 'missing-binary', evidence: line.slice(0, 240), resetHint: null }
    }
    for (const rule of RULES) {
      if (ruleMatches(rule, line)) {
        return {
          kind: rule.kind,
          evidence: line.slice(0, 240),
          resetHint: RESET_HINT.exec(line)?.[0]?.trim() ?? null
        }
      }
    }
  }
  return null
}

export function describeLimit(verdict: XosRunLimitVerdict): string {
  const label = {
    'usage-limit': 'usage limit',
    overloaded: 'provider overloaded',
    auth: 'not signed in',
    'missing-binary': 'agent not installed'
  }[verdict.kind]
  return verdict.resetHint ? `${label} (${verdict.resetHint})` : label
}

/** Map a typed chat-session failure fact (`AgentSessionFailureFact`) to a screen line classifyRunScreen matches. */
export function formatChatFailureLine(
  failure:
    | {
        kind?: string
        usageLimit?: { window?: string; resetsAt?: number }
        retry?: { status?: number; error?: string }
      }
    | null
    | undefined,
  fallbackText?: string | null
): string | null {
  const kind = failure?.kind
  if (!kind) {
    return fallbackText?.trim() || null
  }
  if (kind === 'usageLimitReached') {
    const resetAt = failure?.usageLimit?.resetsAt
    const resetSuffix =
      typeof resetAt === 'number' && Number.isFinite(resetAt)
        ? ` · resets at ${new Date(resetAt).toISOString()}`
        : ''
    return `Usage limit reached${resetSuffix}`
  }
  if (
    kind === 'notSignedIn' ||
    kind === 'claudeAccountFolderMissing' ||
    kind === 'claudeAccountSetupFailed'
  ) {
    return fallbackText?.trim() ? `${fallbackText.trim()} (not logged in)` : 'Not logged in'
  }
  if (
    kind === 'cliMissing' ||
    kind === 'agentCommandNotRunnable' ||
    kind === 'runtimeNotInstalled'
  ) {
    return 'claude: command not found'
  }
  if (
    kind === 'providerRetrying' &&
    (failure?.retry?.status === 529 || failure?.retry?.error === 'overloaded')
  ) {
    return '529 Overloaded'
  }
  return fallbackText?.trim() || null
}
