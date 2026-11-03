// XOS fork: Run now, pause/resume and open-file actions for the board, reported as toasts.
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  XosActionResult,
  XosCronJob,
  XosGoalBoard,
  XosProject
} from '../../../../shared/xos-goals-types'
import type { XosGoalActions } from './XosGoalViewerParts'

export function useXosGoalActions(
  board: XosGoalBoard | null,
  project: XosProject | null,
  refresh: () => Promise<void>
): XosGoalActions {
  const api = window.api.xosGoals
  const [busy, setBusy] = useState<string | null>(null)

  const report = useCallback(
    async (key: string, action: () => Promise<XosActionResult>) => {
      setBusy(key)
      try {
        const result = await action()
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy(null)
        void refresh()
      }
    },
    [refresh]
  )

  return useMemo(
    () => ({
      busy,
      runGoal: (goal) => {
        if (project && api) {
          void report(goal.goal, () =>
            api.runNow({ kind: 'goal', projectKey: project.key, goal: goal.goal })
          )
        }
      },
      setGoalPaused: (goal, paused) => {
        if (project && api && board) {
          void report(goal.goal, () =>
            api.mutateCron({
              kind: paused ? 'pause-goal' : 'resume-goal',
              projectKey: project.key,
              goal: goal.goal,
              crontabHash: board.crontabHash
            })
          )
        }
      },
      runJob: (job: XosCronJob) => {
        if (api) {
          void report(job.id, () => api.runNow({ kind: 'job', jobId: job.id }))
        }
      },
      setJobPaused: (job: XosCronJob, paused: boolean) => {
        if (api && board) {
          void report(job.id, () =>
            api.mutateCron({
              kind: paused ? 'pause-job' : 'resume-job',
              jobId: job.id,
              crontabHash: board.crontabHash
            })
          )
        }
      },
      openFile: (path: string) => {
        void api?.openFile({ path }).then((result) => {
          if (!result.ok) {
            toast.error(result.error)
          }
        })
      }
    }),
    [api, board, busy, project, report]
  )
}
