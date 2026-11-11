// XOS fork: RT15. How long a goal run may take, from its contract.
import { frontmatterString } from './xos-goal-files'

const DEFAULT_TIMEOUT_MINUTES = 120
const MIN_DERIVED_MINUTES = 15

/** `timeout_minutes`, else twice `estimated_runtime`, else a two-hour ceiling. */
export function goalRunTimeoutMinutes(fm: Record<string, unknown>): number {
  const explicit = Number(fm.timeout_minutes)
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  const estimate = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?)?$/i.exec(
    frontmatterString(fm, 'estimated_runtime')?.trim() ?? ''
  )
  if (!estimate) {
    return DEFAULT_TIMEOUT_MINUTES
  }
  const minutes = Number(estimate[1]) * (/^h/i.test(estimate[2] ?? '') ? 60 : 1)
  return Math.max(MIN_DERIVED_MINUTES, Math.ceil(minutes * 2))
}
