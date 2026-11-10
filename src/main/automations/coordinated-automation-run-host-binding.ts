import type { AutomationRun } from '../../shared/automations-types'
import type { Store } from '../persistence/loading-store/store'
import {
  LocalCoordinatedAutomationRunHost,
  type CoordinatedRunHostLane
} from './coordinated-automation-run-host'
import {
  coordinatedRunHostRefusal,
  coordinatedRunStoreRefusal
} from './coordinated-automation-run-host-gate'
import {
  createUnavailableCoordinatedRunHost,
  type CoordinatedAutomationRunHost,
  type CoordinatedRunHostEnvironment,
  type CoordinatedRunHostInjection
} from './coordinated-automation-run-host-types'

type StartStopService = {
  coordinatedRuns: CoordinatedAutomationRunHost
  publishAutomationsChanged: (payload: { reason: 'run'; selector: { kind: 'self' } }) => void
  start: () => void
  stop: () => void
  runInAutomationLane: CoordinatedRunHostLane
}

/**
 * Wires the opt-in host into an AutomationService: the watcher's recovery hook reconciles retained
 * runs during start(), manual work waits for that recovery, and stop() fences before teardown.
 * Without a valid injection the service keeps the unavailable host and the hook stays a no-op.
 */
export function createCoordinatedRunHostBinding(input: {
  store: Store
  injection: CoordinatedRunHostInjection | undefined
  headless: boolean
  environment: CoordinatedRunHostEnvironment | null
}): {
  recoverCoordinatedRuns: (runs: readonly AutomationRun[]) => void
  attach: (service: StartStopService) => void
} {
  // Host facts, then live Store setting/authority/profile, re-evaluated on every call.
  const gate = (): string | null =>
    coordinatedRunHostRefusal(input) ??
    (input.injection ? coordinatedRunStoreRefusal(input.store, input.injection.profile.root) : null)
  // Static host facts refuse for the process lifetime; Store facts only revoke while they fail.
  const refusal = coordinatedRunHostRefusal(input)
  let host: LocalCoordinatedAutomationRunHost | null = null
  return {
    recoverCoordinatedRuns: (runs) => host?.recoverRetainedRuns(runs),
    attach: (service) => {
      if (refusal || !input.injection) {
        service.coordinatedRuns = input.injection
          ? createUnavailableCoordinatedRunHost(refusal ?? '', 'refused')
          : createUnavailableCoordinatedRunHost(
              'Coordinated fake runs are not configured for this host.'
            )
        return
      }
      const local = new LocalCoordinatedAutomationRunHost({
        store: input.store,
        injection: input.injection,
        lane: (automationId, operation) => service.runInAutomationLane(automationId, operation),
        gate,
        // Coordinated fake runs are local desktop only, so progress is scoped to Self.
        onProgressCommitted: () =>
          service.publishAutomationsChanged({ reason: 'run', selector: { kind: 'self' } })
      })
      host = local
      service.coordinatedRuns = local
      const start = service.start.bind(service)
      const stop = service.stop.bind(service)
      service.start = () => {
        local.beginStartup()
        start()
        local.finishStartup()
      }
      service.stop = () => {
        local.stop()
        stop()
      }
    }
  }
}
