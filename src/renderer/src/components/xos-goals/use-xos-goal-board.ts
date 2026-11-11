// XOS fork: load the goal board, refresh it every 30s while visible, and track window visibility.
import { useCallback, useEffect, useState } from 'react'
import type { XosGoalBoard } from '../../../../shared/xos-goals-types'

const REFRESH_MS = 30_000

export function useXosGoalBoard(): {
  board: XosGoalBoard | null
  loading: boolean
  error: string | null
  hidden: boolean
  refresh: () => Promise<void>
} {
  const api = window.api.xosGoals
  const [board, setBoard] = useState<XosGoalBoard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(document.hidden)

  const refresh = useCallback(async () => {
    if (!api) {
      return
    }
    setLoading(true)
    try {
      setBoard(await api.getBoard())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const onVisibility = (): void => {
      setHidden(document.hidden)
      if (!document.hidden) {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refresh()
      }
    }, REFRESH_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [refresh])

  return { board, loading, error, hidden, refresh }
}
