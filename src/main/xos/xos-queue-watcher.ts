// XOS fork: Stage C queue watcher (RT11 generalized, §3g.3). Watches each goal's declared
// input-queue folders (plus floored downstream queues and the inbox), debounces the notifications
// and asks xos-queue-triggers which goals to wake. Capped by max_runs_per_day and the lock lane.
import { watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import { audit } from './xos-crontab'
import { isDirectory, parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { resolveProjectGoalsDir } from './xos-project-home'
import { isMarkdownItem, resolveGoalDeclaredQueues } from './xos-queue-gate'
import { evaluateProjectQueueTriggers, type XosQueueTriggerEvent } from './xos-queue-triggers'

export {
  evaluateProjectQueueTriggers,
  type XosQueueEvaluationOptions,
  type XosQueueTriggerEvent,
  type XosQueueTriggerReason
} from './xos-queue-triggers'

export type XosQueueWatcherOptions = {
  getProjectRoots: () => string[] | Promise<string[]>
  onTrigger: (event: XosQueueTriggerEvent) => Promise<void> | void
  debounceMs?: number
  maxRunsPerTick?: number
  isLaneLocked?: (repoRoot: string, lockLane: string, goal: string) => boolean | Promise<boolean>
  getRunsToday?: (repoRoot: string, goal: string, nowMs: number) => number
  now?: () => number
}

export function createXosQueueWatcher(options: XosQueueWatcherOptions) {
  const debounceMs = options.debounceMs ?? 1500
  const watchers = new Map<string, FSWatcher>()
  const pendingByRoot = new Map<string, Set<string>>()
  const dispatchedToday = new Map<string, { day: string; count: number }>()
  let timer: NodeJS.Timeout | null = null

  const runEvaluation = async (roots: string[], changedByRoot?: Map<string, Set<string>>) => {
    const nowMs = (options.now ?? Date.now)()
    const day = new Date(nowMs).toISOString().slice(0, 10)
    const countMap = new Map<string, number>()
    for (const [k, v] of dispatchedToday) {
      if (v.day === day) {
        countMap.set(k, v.count)
      }
    }
    const allFired: XosQueueTriggerEvent[] = []
    for (const repoRoot of roots) {
      const changed = changedByRoot?.get(repoRoot)
      const events = await evaluateProjectQueueTriggers({
        repoRoot,
        changedPaths: changed ? [...changed] : undefined,
        dispatchedToday: countMap,
        isLaneLocked: options.isLaneLocked,
        getRunsToday: options.getRunsToday,
        maxRunsPerTick: options.maxRunsPerTick,
        nowMs
      })
      for (const ev of events) {
        if (ev.mode !== 'reply') {
          const key = `${ev.repoRoot}:${ev.goal}`
          const prev = dispatchedToday.get(key)
          const next = prev?.day === day ? prev.count + 1 : 1
          dispatchedToday.set(key, { day, count: next })
          countMap.set(key, next)
        }
        audit({ action: 'queue.trigger', ...ev })
        await options.onTrigger(ev)
        allFired.push(ev)
      }
    }
    return allFired
  }

  const flush = async (): Promise<XosQueueTriggerEvent[]> => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = null
    const snapshot = new Map(pendingByRoot)
    pendingByRoot.clear()
    const roots = snapshot.size > 0 ? [...snapshot.keys()] : await options.getProjectRoots()
    return runEvaluation(roots, snapshot.size > 0 ? snapshot : undefined)
  }

  const notifyPathChanged = (repoRoot: string, filePath: string): void => {
    const root = resolve(repoRoot)
    const set = pendingByRoot.get(root) ?? new Set<string>()
    set.add(resolve(filePath))
    pendingByRoot.set(root, set)
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, debounceMs)
    timer.unref?.()
  }

  const start = async (): Promise<void> => {
    for (const rawRoot of await options.getProjectRoots()) {
      const repoRoot = resolve(rawRoot)
      const goalsDir = resolveProjectGoalsDir(repoRoot)
      for (const goal of safeReaddir(goalsDir)) {
        const goalDir = join(goalsDir, goal)
        if (goal.startsWith('_') || goal.startsWith('.') || !isDirectory(goalDir)) {
          continue
        }
        const fm = parseFrontmatter(readHead(join(goalDir, 'GOAL.md'), 16 * 1024))
        const declared = resolveGoalDeclaredQueues(repoRoot, goal, fm)
        const dirs = [
          join(goalDir, 'inbox'),
          ...declared.in.flatMap((q) => q.paths),
          ...declared.out.filter((q) => q.floor && q.floor > 0).flatMap((q) => q.paths)
        ].filter(isDirectory)
        for (const dir of dirs) {
          if (watchers.has(dir)) {
            continue
          }
          try {
            watchers.set(
              dir,
              watch(dir, (_ev, filename) => {
                if (!filename || isMarkdownItem(String(filename))) {
                  notifyPathChanged(repoRoot, filename ? join(dir, String(filename)) : dir)
                }
              })
            )
          } catch {
            // Ignore unwatchable path.
          }
        }
      }
    }
  }

  const stop = (): void => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = null
    watchers.forEach((w) => w.close())
    watchers.clear()
    pendingByRoot.clear()
  }

  return {
    start,
    stop,
    notifyPathChanged,
    flush,
    tick: async () => runEvaluation(await options.getProjectRoots())
  }
}
