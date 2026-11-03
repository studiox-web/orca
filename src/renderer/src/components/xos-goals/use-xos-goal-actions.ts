// XOS fork: board actions (run now, pause/resume, §3d CRUD, open file), reported as toasts.
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  XosActionResult,
  XosCronJob,
  XosCronMutation,
  XosGoalBoard,
  XosGoalMutation,
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

  const openFile = useCallback(
    (path: string) => {
      void api?.openFile({ path }).then((result) => {
        if (!result.ok) {
          toast.error(result.error)
        }
      })
    },
    [api]
  )

  const report = useCallback(
    async (key: string, action: () => Promise<XosActionResult>): Promise<boolean> => {
      setBusy(key)
      try {
        const result = await action()
        if (result.ok) {
          toast.success(result.message)
          if (result.openPath) {
            openFile(result.openPath)
          }
        } else {
          toast.error(result.error)
        }
        return result.ok
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught))
        return false
      } finally {
        setBusy(null)
        void refresh()
      }
    },
    [openFile, refresh]
  )

  return useMemo<XosGoalActions>(() => {
    const hash = board?.crontabHash ?? ''
    const cron: XosGoalActions['cron'] = (mutation, busyKey) =>
      api
        ? report(busyKey ?? mutation.kind, () =>
            api.mutateCron({ ...mutation, crontabHash: hash } as XosCronMutation)
          )
        : Promise.resolve(false)
    return {
      busy,
      cron,
      goalOp: (mutation, busyKey) =>
        api
          ? report(busyKey ?? mutation.kind, () =>
              api.mutateGoal({ ...mutation, crontabHash: hash } as XosGoalMutation)
            )
          : Promise.resolve(false),
      areaOp: (mutation) =>
        api
          ? report(`area:${mutation.kind}`, () => api.mutateArea(mutation))
          : Promise.resolve(false),
      runGoal: (goal, options) => {
        if (project && api) {
          void report(goal.goal, () =>
            api.runNow({
              kind: 'goal',
              projectKey: project.key,
              goal: goal.goal,
              ...options
            })
          )
        }
      },
      setGoalPaused: (goal, paused) => {
        if (project) {
          void cron(
            {
              kind: paused ? 'pause-goal' : 'resume-goal',
              projectKey: project.key,
              goal: goal.goal
            },
            goal.goal
          )
        }
      },
      runJob: (job: XosCronJob) => {
        if (api) {
          void report(job.id, () => api.runNow({ kind: 'job', jobId: job.id }))
        }
      },
      setJobPaused: (job: XosCronJob, paused: boolean) => {
        void cron({ kind: paused ? 'pause-job' : 'resume-job', jobId: job.id }, job.id)
      },
      openFile
    }
  }, [api, board, busy, openFile, project, report])
}
