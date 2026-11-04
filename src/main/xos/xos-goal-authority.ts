// XOS fork: authority confirmation (§3a, §3d, M15). Native runs bypass the agent's sandbox only after
// the operator confirmed what the goal may do. The confirmation is bound to a fingerprint of the
// contract's authority fields, so widening them needs a fresh confirm.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit, xosHome } from './xos-crontab'
import { frontmatterList, frontmatterString } from './xos-goal-files'

const PRODUCTION_LANE = /deploy|prod|release/i

export type XosGoalAuthority = {
  lockLane: string
  ownedPaths: string[]
  agents: string[]
  autoPush: boolean
  /** Can reach production or push: unattended runs refuse until confirmed. */
  elevated: boolean
}

type ConfirmFile = Record<string, { fingerprint: string; confirmedAt: string }>

const filePath = (): string => join(xosHome(), 'goal-authority.json')
const keyFor = (repoRoot: string, goal: string): string => `${repoRoot}\0${goal}`

function readConfirmations(): ConfirmFile {
  try {
    const parsed: ConfirmFile = JSON.parse(readFileSync(filePath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function goalAuthority(fm: Record<string, unknown>): XosGoalAuthority {
  const lockLane = frontmatterString(fm, 'lock_lane') ?? 'repo-mutating'
  const autoPush = fm.auto_push === true || frontmatterString(fm, 'auto_push') === 'true'
  return {
    lockLane,
    ownedPaths: frontmatterList(fm, 'owned_paths'),
    agents: frontmatterList(fm, 'agents'),
    autoPush,
    elevated: autoPush || PRODUCTION_LANE.test(lockLane)
  }
}

function fingerprint(authority: XosGoalAuthority): string {
  return createHash('sha256').update(JSON.stringify(authority)).digest('hex').slice(0, 16)
}

export function isGoalAuthorityConfirmed(
  repoRoot: string,
  goal: string,
  fm: Record<string, unknown>
): boolean {
  const entry = readConfirmations()[keyFor(repoRoot, goal)]
  return entry?.fingerprint === fingerprint(goalAuthority(fm))
}

/** `typed` must repeat the goal name, the same guard hard delete uses. */
export function confirmGoalAuthority(args: {
  repoRoot: string
  goal: string
  fm: Record<string, unknown>
  typed: string
}): { ok: true; authority: XosGoalAuthority } | { ok: false; error: string } {
  if (args.typed !== args.goal) {
    return { ok: false, error: `Type ${args.goal} to confirm this goal's authority.` }
  }
  const authority = goalAuthority(args.fm)
  const confirmations = readConfirmations()
  confirmations[keyFor(args.repoRoot, args.goal)] = {
    fingerprint: fingerprint(authority),
    confirmedAt: new Date().toISOString()
  }
  mkdirSync(xosHome(), { recursive: true })
  writeFileSync(filePath(), `${JSON.stringify(confirmations, null, 2)}\n`, { mode: 0o600 })
  audit({ action: 'goal.authority_confirmed', repoRoot: args.repoRoot, goal: args.goal, authority })
  return { ok: true, authority }
}
