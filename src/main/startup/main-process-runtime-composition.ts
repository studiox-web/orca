import type { CoordinatedRunHostInjection } from '../automations/coordinated-automation-run-host-types'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedDefinitionWriteHost } from '../runtime/coordinated-definition-write-gate'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

/** Trusted entry-point dependencies, resolved after the active profile's Store is admitted. */
export type MainProcessRuntimeCompositionFactory = (context: {
  store: Store
  headless: boolean
}) => {
  coordinatedDefinitionWrites?: CoordinatedDefinitionWriteHost
  coordinatedRuns?: (context: {
    store: Store
    runtime: OrcaRuntimeService
  }) => CoordinatedRunHostInjection
}
