import { useEffect, useMemo, useRef, useState } from 'react'
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { emitAutomationsChangedWindowEvent } from '@/lib/automations-changed-window-event'
import { ownerKey } from '../../../../shared/automation-owner-key'
import type { AutomationCapturedOwner } from './automation-captured-owner'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import { automationAuthorityCatalogKey } from './automation-host-catalog-types'
import { subscribeAutomationHostInvalidation } from './automation-host-invalidation-window-events'
import {
  coordinatedRunBindingKey,
  inspectCoordinatedRun,
  readCoordinatedRunHost,
  reconcileCoordinatedTestRun,
  startCoordinatedTestRun,
  type CoordinatedRunBinding,
  type CoordinatedRunRequests
} from './coordinated-run-api-client'

type ReadState = {
  key: string
  view: CoordinatedRunView | null
  notice: string | null
  ready: boolean
}

export function useCoordinatedRunApi(input: {
  automation: Automation
  runs: AutomationRun[]
  capturedOwner?: AutomationCapturedOwner
  hostEntry?: AutomationHostCatalogEntry | null
  historyUnavailable?: string | null
  enabled: boolean
  requests: CoordinatedRunRequests
}) {
  const { automation, capturedOwner, hostEntry, requests } = input
  const owner = capturedOwner?.owner
  const unavailable = !input.enabled
    ? 'Coordinated automations are disabled.'
    : (input.historyUnavailable ??
      (!owner || !hostEntry?.owner || ownerKey(owner) !== ownerKey(hostEntry.owner)
        ? 'Refresh the automation list to confirm its owning host.'
        : hostEntry.catalogState !== 'authoritative' ||
            !['fresh', 'refreshing'].includes(hostEntry.authorityHealth)
          ? 'The owning host is unavailable. Refresh its connection before inspecting or starting a run.'
          : null))
  const binding = useMemo<CoordinatedRunBinding | null>(
    () => (owner ? { automation, owner } : null),
    [automation, owner]
  )
  const parentKey = binding ? coordinatedRunBindingKey(binding) : automation.id
  const [selection, setSelection] = useState<{ parent: string; runId: string } | null>(null)
  const selectedRunId =
    selection?.parent === parentKey ? selection.runId : (input.runs[0]?.id ?? null)
  const selectedRun = input.runs.find((run) => run.id === selectedRunId)
  const revision = selectedRun?.automationDefinitionRevision
  const [reload, setReload] = useState(0)
  const key = JSON.stringify([
    parentKey,
    selectedRunId,
    automation.definitionRevision,
    revision,
    unavailable,
    reload
  ])
  const currentKey = useRef(key)
  currentKey.current = key
  const [read, setRead] = useState<ReadState>({ key: '', view: null, notice: null, ready: false })
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const operation = useRef(false)
  const bindingRef = useRef(binding)
  bindingRef.current = binding

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!binding || unavailable) {
      return
    }
    let cancelled = false
    setRead({ key, view: null, notice: null, ready: false })
    void (
      selectedRunId
        ? inspectCoordinatedRun(binding, selectedRunId, revision)
        : readCoordinatedRunHost(binding).then(() => null)
    )
      .then((view) => {
        if (!cancelled && currentKey.current === key) {
          setRead({ key, view, notice: null, ready: true })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && currentKey.current === key) {
          setRead({
            key,
            view: null,
            notice: String(error instanceof Error ? error.message : error),
            ready: false
          })
        }
      })
    return () => {
      cancelled = true
    }
    // The key includes the captured authority incarnation, definition and exact selection.
  }, [key, binding, selectedRunId, revision, unavailable])

  useEffect(
    () =>
      subscribeAutomationHostInvalidation((event) => {
        const current = bindingRef.current
        if (
          !current ||
          operation.current ||
          automationAuthorityCatalogKey(event.authority) !==
            automationAuthorityCatalogKey(current.owner.authority) ||
          (event.selector && event.selector.kind !== 'self')
        ) {
          return
        }
        setReload((value) => value + 1)
      }),
    []
  )

  const currentRead = read.key === key ? read : null
  const view = unavailable ? null : (currentRead?.view ?? null)
  const notice = unavailable ?? currentRead?.notice ?? null
  const pendingStart = requests.get(parentKey)?.start
  const perform = async (kind: 'start' | 'reconcile'): Promise<void> => {
    if (!binding || unavailable || operation.current || !currentRead?.ready) {
      return
    }
    if (kind === 'reconcile' && !selectedRunId) {
      return
    }
    operation.current = true
    setBusy(true)
    setRead({ key, view: null, notice: null, ready: false })
    const requestKey = kind === 'start' ? parentKey : JSON.stringify([parentKey, selectedRunId])
    const request = requests.get(requestKey) ?? {}
    requests.set(requestKey, request)
    try {
      const result =
        kind === 'start'
          ? await startCoordinatedTestRun(binding, request)
          : await reconcileCoordinatedTestRun(binding, request, selectedRunId!, revision)
      if (!mounted.current || currentKey.current !== key) {
        return
      }
      setSelection({ parent: parentKey, runId: result.inspection.automationRunId })
      setRead({ key, view: result, notice: null, ready: true })
      emitAutomationsChangedWindowEvent({
        ...(binding.owner.authority.kind === 'runtime'
          ? { environmentId: binding.owner.authority.environmentId }
          : {}),
        selector: { kind: 'self' },
        reason: 'run'
      })
      setReload((value) => value + 1)
    } catch (error) {
      if (!mounted.current || currentKey.current !== key) {
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      setRead({
        key,
        view: null,
        notice: `${detail} Submitted request identities are retained. Refresh, then retry to inspect the original operation before replay.`,
        ready: false
      })
    } finally {
      operation.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  return {
    selectedRunId,
    view,
    notice,
    busy,
    loading: !unavailable && !currentRead,
    ready: !unavailable && currentRead?.ready === true,
    pendingStart,
    selectRun: (runId: string) => setSelection({ parent: parentKey, runId }),
    refresh: () => setReload((value) => value + 1),
    start: () => perform('start'),
    reconcile: () => perform('reconcile')
  }
}
