// XOS fork: live quota per agent for Auto mode and the before-launch skip (plan §3.3/§3.4). Reads
// the same RateLimitService state as the usage bars. No Electron imports: orcad bundles this too.
import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../shared/rate-limit-types'

type QuotaSource = { getState: () => RateLimitState }

let source: QuotaSource | null = null

/** Called where the RateLimitService is created (desktop and orcad). */
export function registerXosQuotaSource(next: QuotaSource): void {
  source = next
}

const PROVIDER: Record<string, keyof RateLimitState> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  antigravity: 'antigravity',
  grok: 'grok',
  cursor: 'cursor',
  opencode: 'opencodeGo',
  kimi: 'kimi'
}

/** A 5h window is unusable this close to full; weekly/monthly use the configured reserve. */
const SESSION_CEILING = 98

export type XosQuota = {
  /** False when the provider reports nothing usable (not signed in, never fetched). */
  known: boolean
  exhausted: boolean
  /** Higher = more quota left relative to its reset (use-it-or-lose-it). */
  score: number
  note: string
}

function provider(agent: string): ProviderRateLimits | null {
  const key = PROVIDER[agent]
  if (!source || !key) {
    return null
  }
  try {
    const value = source.getState()[key]
    return value && typeof value === 'object' && 'provider' in value ? value : null
  } catch {
    return null
  }
}

function resetText(window: RateLimitWindow, now: number): string {
  if (!window.resetsAt) {
    return ''
  }
  const hours = Math.max(0, (window.resetsAt - now) / 3_600_000)
  return hours >= 36 ? `, resets in ${Math.round(hours / 24)}d` : `, resets in ${Math.ceil(hours)}h`
}

export function assessQuota(
  agent: string,
  model: string | null,
  reservePercent: number,
  now = Date.now(),
  limits: ProviderRateLimits | null = provider(agent)
): XosQuota {
  const long = [
    model && /fable/i.test(model) ? (limits?.fableWeekly ?? null) : null,
    limits?.weekly ?? null,
    limits?.monthly ?? null
  ].find((window): window is RateLimitWindow => Boolean(window))
  const session = limits?.session ?? null
  if (!long && !session) {
    return { known: false, exhausted: false, score: 0, note: `${agent} quota unknown` }
  }
  if (session && session.usedPercent >= SESSION_CEILING) {
    return {
      known: true,
      exhausted: true,
      score: 0,
      note: `${agent} 5h window at ${Math.round(session.usedPercent)}%${resetText(session, now)}`
    }
  }
  const name = long && long.windowMinutes > 20_000 ? 'monthly' : 'weekly'
  if (long && long.usedPercent >= 100 - reservePercent) {
    return {
      known: true,
      exhausted: true,
      score: 0,
      note: `${agent} ${name} at ${Math.round(long.usedPercent)}%${reservePercent ? ` (keeping ${reservePercent}% reserve)` : ''}`
    }
  }
  const window = long ?? session!
  const left = Math.max(0, 100 - (long ? reservePercent : 0) - window.usedPercent)
  const hours = window.resetsAt
    ? Math.max(1, (window.resetsAt - now) / 3_600_000)
    : window.windowMinutes / 60
  return {
    known: true,
    exhausted: false,
    score: left / hours,
    note: `${agent} ${long ? name : '5h'} ${Math.round(window.usedPercent)}% used${resetText(window, now)}`
  }
}

/** `orca usage limits`: each agent's standing as Auto mode sees it. */
export function listAgentQuotas(): {
  agent: string
  known: boolean
  exhausted: boolean
  note: string
}[] {
  return Object.keys(PROVIDER).map((agent) => {
    const { known, exhausted, note } = assessQuota(agent, null, 0)
    return { agent, known, exhausted, note }
  })
}
