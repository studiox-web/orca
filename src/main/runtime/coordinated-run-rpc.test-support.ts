import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { vi } from 'vitest'
import { RecoveryEnv } from '../../../tests/e2e/coordinated-automation-harness/coordinated-automation-recovery-env'
import { testState } from '../persistence/persistence-test-harness'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  type CoordinatedFakeRunHostInjection
} from '../automations/coordinated-automation-run-host-types'
import { OrcaRuntimeService } from './orca-runtime'
import { RpcDispatcher } from './rpc/dispatcher'
import { COORDINATED_AUTOMATION_RUN_METHODS } from './rpc/methods/coordinated-automation-runs'
import { AUTOMATION_METHODS } from './rpc/methods/automations'
import type { RpcDispatchStreamingOptions } from './rpc/dispatcher-stream-options'
import type { AutomationsChangedPayload } from '../../shared/runtime-client-events'
import { coordinatedCreateInput } from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import * as worktreeChangeInvalidators from '../ipc/worktree-change-invalidators'
import { _resetTerminalModelQueryAuthorityForTest } from './terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from './terminal-view-attribute-store'

export async function createCoordinatedRunRpcFixture(
  options: {
    nestedProfile?: boolean
    activeProfileDirectory?: (() => string | null) | null
    definitionGate?: boolean
    host?: boolean
    start?: boolean
    injection?: Partial<CoordinatedFakeRunHostInjection>
    fakeEffects?: boolean
    /** Definition for the fixture's parent; the default two-stage pipeline when omitted. */
    definition?: Parameters<typeof coordinatedCreateInput>[0]
  } = {}
) {
  const env = await RecoveryEnv.create({ nestedProfile: options.nestedProfile })
  let selectedProfileDirectory: string | null = testState.dir
  if (options.nestedProfile) {
    installFakeAppEnvironment({ getPath: () => env.harness.root })
  }
  env.store.updateSettings({ experimentalCoordinatedAutomations: true })
  for (const id of ['research', 'writer']) {
    env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
  }
  const registration = vi.spyOn(worktreeChangeInvalidators, 'registerWorktreeChangeInvalidator')
  const runtime = new OrcaRuntimeService(
    env.store,
    undefined,
    options.definitionGate === false
      ? undefined
      : {
          coordinatedDefinitionWrites: { profileDirectory: testState.dir }
        }
  )
  const published: AutomationsChangedPayload[] = []
  vi.spyOn(runtime, 'notifyAutomationsChanged').mockImplementation((payload = {}) => {
    published.push(payload)
  })
  const injection: CoordinatedFakeRunHostInjection = {
    capability: COORDINATED_FAKE_RUNS_CAPABILITY,
    profile: { kind: 'isolated_test', root: testState.dir },
    orchestrationDb: env.db,
    workerProvider: env.workerProvider(),
    clock: env.clock(),
    laneLocks: { tryAcquire: () => ({ acquired: true, release: () => {} }) },
    effects: options.fakeEffects
      ? { policy: 'fake', adapter: env.harness.effects }
      : { policy: 'deny' },
    durableBoundary: env.boundaryHook(),
    ...options.injection
  }
  const service = createRuntimeAutomationService({
    store: env.store,
    runtime,
    headless: false,
    activeProfileDirectory:
      options.activeProfileDirectory === null
        ? undefined
        : (options.activeProfileDirectory ?? (() => selectedProfileDirectory)),
    coordinatedRuns: options.host === false ? undefined : injection
  })
  if (options.start !== false) {
    service.start()
  }
  const { automationId } = env.createDefinitionOnly(coordinatedCreateInput(options.definition))
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...AUTOMATION_METHODS, ...COORDINATED_AUTOMATION_RUN_METHODS]
  })
  return {
    env,
    selectActiveProfile(directory: string | null) {
      selectedProfileDirectory = directory
    },
    runtime,
    service,
    published,
    automationId,
    startRequest: {
      runtimeId: runtime.getRuntimeId(),
      automationId,
      expectedOwner: { selector: { kind: 'self' } } as const,
      expectedDefinitionRevision: 1,
      idempotencyKey: 'api-fixture-1'
    },
    selection(automationRunId: string) {
      return {
        runtimeId: runtime.getRuntimeId(),
        automationId,
        automationRunId,
        expectedOwner: { selector: { kind: 'self' } } as const
      }
    },
    rpc(method: string, params: unknown, options?: RpcDispatchStreamingOptions) {
      return dispatcher.dispatch({ id: 'api-test', method, authToken: 'fixture', params }, options)
    },
    async dispose() {
      service.stop()
      const disposers = registration.mock.results.flatMap((result) =>
        result.type === 'return' ? [result.value] : []
      )
      vi.restoreAllMocks()
      for (const dispose of disposers) {
        dispose()
      }
      _resetTerminalModelQueryAuthorityForTest()
      _resetTerminalViewAttributesForTest()
      await env.dispose()
    }
  }
}
