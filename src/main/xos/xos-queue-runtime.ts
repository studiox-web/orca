// XOS fork: H1. Wires the queue watcher to native runs, for projects that opted in with
// `orca goals triggers --enable`.
import { audit } from './xos-crontab'
import { startNativeGoalRun } from './xos-live-runs'
import { createXosQueueWatcher } from './xos-queue-watcher'
import { goalRunsToday } from './xos-native-receipts'
import { readTriggerProjects } from './xos-trigger-projects'

const SWEEP_MS = 60_000

/** One watcher per main process (desktop or orcad; they never run at once). */
export function startXosQueueRuntime(): () => void {
  const watcher = createXosQueueWatcher({
    getProjectRoots: readTriggerProjects,
    getRunsToday: goalRunsToday,
    onTrigger: async (event) => {
      const started = await startNativeGoalRun({
        repoRoot: event.repoRoot,
        goal: event.goal,
        mode: event.mode,
        trigger: 'event'
      })
      if (!started.ok) {
        audit({ action: 'queue.trigger_refused', goal: event.goal, error: started.error })
      }
    }
  })
  const sweep = (): void => {
    if (readTriggerProjects().length === 0) {
      return
    }
    // start() also picks up projects and queue folders added since the last sweep.
    void watcher
      .start()
      .then(() => watcher.tick())
      .catch((error) => console.warn('[xos] queue sweep failed', error))
  }
  const timer = setInterval(sweep, SWEEP_MS)
  timer.unref()
  sweep()
  return () => {
    clearInterval(timer)
    watcher.stop()
  }
}
