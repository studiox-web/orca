// XOS fork: load the work-item snapshot for Tasks → Goals; refresh every 60s while visible.
import { useCallback, useEffect, useState } from 'react'
import type { XosItemsSnapshot } from '../../../../shared/xos-items-types'

const REFRESH_MS = 60_000

export function useXosItems(): {
  snapshot: XosItemsSnapshot | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const api = window.api.xosGoals
  const [snapshot, setSnapshot] = useState<XosItemsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!api) {
      return
    }
    setLoading(true)
    try {
      setSnapshot(await api.getItems({ projectKey: null }))
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

  return { snapshot, loading, error, refresh }
}
