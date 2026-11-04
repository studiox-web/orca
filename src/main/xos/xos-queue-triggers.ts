// XOS fork: Stage C queue-trigger evaluation (RT11 generalized, §3g.3): given a project root and
// the paths that changed, decide which goals to wake (input-queue events, downstream floors,
// open inbox replies), capped by the daily run limit and the lock lane. Pure evaluation — the
// fs watchers and debounce live in xos-queue-watcher.ts.
import { join, resolve, sep } from 'node:path'
import { frontmatterString, parseFrontmatter, readHead } from './xos-goal-files'
import { goalRunsToday } from './xos-native-receipts'
import { goalLockFile, isLockFree, laneLockFile } from './xos-lane-lock'
import { listProjectGoals, resolveGoalDir } from './xos-project-home'
import {
  countDownstreamFloorItems,
  countOpenReplyMessages,
  evaluateGoalQueueGate,
  resolveGoalDeclaredQueues
} from './xos-queue-gate'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'

export type XosQueueTriggerReason =
  | 'input_queue_event'
  | 'downstream_below_floor'
  | 'inbox_open_message'

export type XosQueueTriggerEvent = {
  repoRoot: string
  goal: string
  mode: 'normal' | 'reply'
  reason: XosQueueTriggerReason
  detail: string
  lockLane: string
  queueLabel?: string
  candidateItemPaths: string[]
}

export type XosQueueEvaluationOptions = {
  repoRoot: string
  changedPaths?: string[]
  dispatchedToday?: ReadonlyMap<string, number>
  isLaneLocked?: (repoRoot: string, lockLane: string, goal: string) => boolean | Promise<boolean>
  getRunsToday?: (repoRoot: string, goal: string, nowMs: number) => number
  maxRunsPerTick?: number
  nowMs?: number
}

function withinDir(filePath: string, dir: string): boolean {
  const cleanFile = resolve(filePath)
  const cleanDir = resolve(dir)
  return cleanFile === cleanDir || cleanFile.startsWith(cleanDir + sep)
}

function stageReadyKey(typeId?: string, stageId?: string): string | undefined {
  return LEGACY_ITEM_TYPES.find((t) => t.id === typeId)?.stages.find((s) => s.id === stageId)
    ?.readyKey
}

function floorKey(queue: {
  matchKey?: string
  typeId?: string
  stageId?: string
}): string | undefined {
  return queue.matchKey ?? stageReadyKey(queue.typeId, queue.stageId)
}

export async function evaluateProjectQueueTriggers(
  args: XosQueueEvaluationOptions
): Promise<XosQueueTriggerEvent[]> {
  const nowMs = args.nowMs ?? Date.now()
  const maxRunsPerTick = args.maxRunsPerTick ?? 5
  const goalNames = listProjectGoals(args.repoRoot)
  const events: XosQueueTriggerEvent[] = []
  const busy = new Set<string>()

  const isBusy = async (lockLane: string, goal: string): Promise<boolean> => {
    if (busy.has(`g:${goal}`) || busy.has(`l:${lockLane}`)) {
      return true
    }
    if (args.isLaneLocked) {
      return await args.isLaneLocked(args.repoRoot, lockLane, goal)
    }
    const [lFree, gFree] = await Promise.all([
      isLockFree(laneLockFile(args.repoRoot, lockLane)),
      isLockFree(goalLockFile(args.repoRoot, goal))
    ])
    return !lFree || !gFree
  }

  const recordEvent = (ev: XosQueueTriggerEvent): void => {
    busy.add(`g:${ev.goal}`)
    busy.add(`l:${ev.lockLane}`)
    events.push(ev)
  }

  for (const goal of goalNames) {
    if (events.length >= maxRunsPerTick) {
      break
    }
    const goalDir = resolveGoalDir(args.repoRoot, goal)
    const goalText = readHead(join(goalDir, 'GOAL.md'), 16 * 1024)
    if (!goalText) {
      continue
    }
    const fm = parseFrontmatter(goalText)
    const declared = resolveGoalDeclaredQueues(args.repoRoot, goal, fm)
    const lockLane = frontmatterString(fm, 'lock_lane') ?? 'repo-mutating'
    const inboxDir = join(goalDir, 'inbox')
    const inboxIsWork = declared.in.some((q) =>
      q.paths.some((p) => resolve(p) === resolve(inboxDir))
    )
    const openReplies = countOpenReplyMessages(goalDir, goal, inboxIsWork)
    const inboxTouched =
      !args.changedPaths?.length || args.changedPaths.some((p) => withinDir(p, inboxDir))
    if (openReplies > 0 && inboxTouched && !(await isBusy('dm', goal))) {
      recordEvent({
        repoRoot: args.repoRoot,
        goal,
        mode: 'reply',
        reason: 'inbox_open_message',
        detail: `${openReplies} open inbox message(s) waiting for reply`,
        lockLane: 'dm',
        candidateItemPaths: []
      })
      continue
    }

    const baseRuns = (args.getRunsToday ?? goalRunsToday)(args.repoRoot, goal, nowMs)
    const extraRuns = args.dispatchedToday?.get(`${args.repoRoot}:${goal}`) ?? 0
    const gate = evaluateGoalQueueGate({
      repoRoot: args.repoRoot,
      goal,
      fm,
      runsToday: baseRuns + extraRuns,
      nowMs
    })
    if (!gate.allowed) {
      continue
    }

    const starvedOut = declared.out.find((outQ) => {
      if (!outQ.floor || outQ.floor <= 0 || outQ.paths.length === 0) {
        return false
      }
      const count = countDownstreamFloorItems(outQ.paths, floorKey(outQ), nowMs)
      const touched =
        !args.changedPaths?.length ||
        args.changedPaths.some(
          (p) =>
            outQ.paths.some((dir) => withinDir(p, dir)) ||
            declared.in.some((inQ) => inQ.paths.some((dir) => withinDir(p, dir)))
        )
      return count < outQ.floor && touched && (gate.hasInputWork || declared.in.length === 0)
    })

    if (starvedOut) {
      if (!(await isBusy(lockLane, goal))) {
        const count = countDownstreamFloorItems(starvedOut.paths, floorKey(starvedOut), nowMs)
        recordEvent({
          repoRoot: args.repoRoot,
          goal,
          mode: 'normal',
          reason: 'downstream_below_floor',
          detail: `Downstream queue "${starvedOut.label}" is below floor (${count}/${starvedOut.floor})`,
          lockLane,
          queueLabel: starvedOut.label,
          candidateItemPaths: gate.candidateItemPaths
        })
      }
      continue
    }

    if (declared.in.length > 0 && gate.hasInputWork) {
      const inTouched =
        !args.changedPaths?.length ||
        args.changedPaths.some((p) =>
          declared.in.some((inQ) => inQ.paths.some((dir) => withinDir(p, dir)))
        )
      if (inTouched && !(await isBusy(lockLane, goal))) {
        recordEvent({
          repoRoot: args.repoRoot,
          goal,
          mode: 'normal',
          reason: 'input_queue_event',
          detail: `Input queue has ${gate.totalEligibleIn} eligible item(s)`,
          lockLane,
          queueLabel: declared.in[0]?.label,
          candidateItemPaths: gate.candidateItemPaths
        })
      }
    }
  }
  return events
}
