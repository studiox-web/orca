import { vi } from 'vitest'
import { RecoveryEnv } from '../../../tests/e2e/coordinated-automation-harness/coordinated-automation-recovery-env'
import { testState } from '../persistence/persistence-test-harness'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  type CoordinatedRunHostInjection
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
    definitionGate?: boolean
    host?: boolean
    start?: boolean
    injection?: Partial<CoordinatedRunHostInjection>
    fakeEffects?: boolean
  } = {}
) {
  const env = await RecoveryEnv.create()
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
  const injection: CoordinatedRunHostInjection = {
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
    coordinatedRuns: options.host === false ? undefined : injection
  })
  if (options.start !== false) {
    service.start()
  }
  const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...AUTOMATION_METHODS, ...COORDINATED_AUTOMATION_RUN_METHODS]
  })
  return {
    env,
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
