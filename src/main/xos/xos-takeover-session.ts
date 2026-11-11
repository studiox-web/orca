// XOS fork: §3e.4-5. While the operator is at the helm the goal's lane and item belong to that
// session: scheduled runs see the lane busy and the claim doesn't go stale. Releasing leaves a
// handoff note in STATUS.md, so the next automatic run resumes cold, and gives everything back.
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { audit } from './xos-crontab'
import { parseFrontmatter, frontmatterString, readHead } from './xos-goal-files'
import { claimWorkItem, releaseWorkItemClaim } from './xos-item-claims'
import { settleWorkItem } from './xos-item-outcome'
import { adoptLock, goalLockFile, laneLockFile, tryLock, type HeldLock } from './xos-lane-lock'
import { commitProjectHome, resolveGoalDir } from './xos-project-home'
import {
  activeTakeover,
  leasePathFor,
  removeRunJournal,
  writeRunJournal,
  writeRunLease
} from './xos-run-journal'

const SESSION_MS = 12 * 60 * 60_000

export async function startTakeoverSession(args: {
  repoRoot: string
  goal: string
  agent: string
  itemPath: string | null
  nowMs?: number
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const nowMs = args.nowMs ?? Date.now()
  if (activeTakeover(args.repoRoot, args.goal)) {
    return { ok: false, error: `${args.goal} is already taken over; release it first.` }
  }
  const fm = parseFrontmatter(readHead(join(resolveGoalDir(args.repoRoot, args.goal), 'GOAL.md')))
  const lane = frontmatterString(fm, 'lock_lane') ?? 'repo-mutating'
  const runId = `takeover-${args.goal}-${nowMs.toString(36)}`
  const leasePath = leasePathFor(runId)
  const lease = { path: leasePath, expiresAtMs: nowMs + SESSION_MS }
  writeRunLease(leasePath, null)
  const locks: HeldLock[] = []
  const giveUp = (error: string): { ok: false; error: string } => {
    locks.forEach((lock) => lock.release())
    removeRunJournal(runId, leasePath)
    return { ok: false, error }
  }
  for (const file of [goalLockFile(args.repoRoot, args.goal), laneLockFile(args.repoRoot, lane)]) {
    const lock = await tryLock(file, 0, lease)
    if (!lock) {
      return giveUp(`Lane "${lane}" is busy; wait for the run to finish, or stop it first.`)
    }
    locks.push(lock)
  }
  if (args.itemPath) {
    const claim = claimWorkItem(args.itemPath, { runId, nowMs, untilMs: nowMs + SESSION_MS })
    if (!claim.claimed) {
      return giveUp(claim.reason ?? 'Could not claim the work item.')
    }
  }
  writeRunJournal({
    kind: 'takeover',
    runId,
    repoRoot: args.repoRoot,
    goal: args.goal,
    agent: args.agent,
    itemPath: args.itemPath,
    startedAt: new Date(nowMs).toISOString(),
    deadlineAtMs: nowMs + SESSION_MS,
    locks: locks.map(({ file, pid }) => ({ file, pid })),
    leasePath
  })
  audit({ action: 'goal.takeover_start', goal: args.goal, runId, item: args.itemPath })
  return { ok: true, runId }
}

/** `advance` = the work is done, so the item moves on; otherwise it just returns to its stage. */
export function releaseTakeoverSession(args: {
  repoRoot: string
  goal: string
  note?: string
  advance?: boolean
}): { ok: true; message: string } | { ok: false; error: string } {
  const session = activeTakeover(args.repoRoot, args.goal)
  if (!session) {
    return { ok: false, error: `${args.goal} is not taken over.` }
  }
  const statusPath = join(resolveGoalDir(args.repoRoot, args.goal), 'STATUS.md')
  const note = args.note?.trim() || 'Operator released the goal back to automation.'
  if (existsSync(statusPath)) {
    appendFileSync(statusPath, `\n\n## Handoff (${new Date().toISOString()})\n\n${note}\n`, 'utf8')
  }
  if (session.itemPath && existsSync(session.itemPath)) {
    if (args.advance) {
      settleWorkItem({
        repoRoot: args.repoRoot,
        goal: args.goal,
        itemPath: session.itemPath,
        runId: session.runId,
        success: true
      })
    } else {
      releaseWorkItemClaim(session.itemPath)
    }
  }
  session.locks.forEach((lock) => adoptLock(lock.file, lock.pid).release())
  removeRunJournal(session.runId, session.leasePath)
  audit({ action: 'goal.takeover_release', goal: args.goal, runId: session.runId })
  void commitProjectHome(args.repoRoot, `xos: release takeover of ${args.goal}`)
  return { ok: true, message: `${args.goal} is back on automation.` }
}
