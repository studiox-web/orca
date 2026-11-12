import { beforeEach, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE,
  COORDINATED_AUTOMATION_NATIVE_RUNS_RUNTIME_CAPABILITY as NATIVE
} from '../../../../shared/automation-runtime-capabilities'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import {
  inspectCoordinatedRun,
  readCoordinatedRunHost,
  reconcileCoordinatedTestRun,
  startCoordinatedTestRun,
  type CoordinatedRunRequest
} from './coordinated-run-api-client'
import { coordinatedHostViewFixture } from './coordinated-host-run-view-fixture'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import { listAutomationRunsForOwner } from './automation-scoped-list-client'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
vi.mock('./automation-scoped-list-client', () => ({ listAutomationRunsForOwner: vi.fn() }))

const binding = {
  automation: {
    ...sampleCoordinatedArticleAutomation,
    enabled: false,
    triggerPolicy: 'manual_only' as const,
    workspaceId: 'pilot-workspace',
    definitionRevision: 2
  },
  owner: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
}
let status: Pick<
  RuntimeStatus,
  'runtimeId' | 'capabilities' | 'coordinatedNativeRuns' | 'coordinatedFakeRuns'
>
let view: ReturnType<typeof coordinatedHostViewFixture>
let startError: Error | null
const methods = () => vi.mocked(callRuntimeRpc).mock.calls.map(([, method]) => method)

beforeEach(() => {
  vi.resetAllMocks()
  view = { ...coordinatedHostViewFixture(), executionKind: 'native' }
  view.inspection.idempotencyKey = 'manual:article-1'
  status = {
    runtimeId: view.runtimeId,
    capabilities: [NATIVE],
    coordinatedNativeRuns: {
      available: true,
      nativeStart: {
        idempotencyKey: 'manual:article-1',
        workspaceId: 'pilot-workspace',
        definitions: [{ automationId: binding.automation.id, expectedDefinitionRevision: 2 }]
      }
    }
  }
  startError = null
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method) => {
    if (method === 'status.get') {
      return status
    }
    if (method === 'automation.startCoordinatedNativeRun' && startError) {
      throw startError
    }
    if (method === 'automation.inspectCoordinatedRun') {
      return { view }
    }
    if (
      method === 'automation.startCoordinatedNativeRun' ||
      method === 'automation.reconcileCoordinatedNativeRun'
    ) {
      return { view, created: true, state: 'completed', reason: null }
    }
    throw new Error(`Unexpected RPC ${method}`)
  })
})

it('starts the admitted native occurrence and never calls the simulated run API', async () => {
  const request: CoordinatedRunRequest = {}
  await startCoordinatedTestRun(binding, request)
  expect(methods()).toEqual(['status.get', 'automation.startCoordinatedNativeRun'])
  expect(vi.mocked(callRuntimeRpc).mock.calls[1][2]).toMatchObject({
    automationId: binding.automation.id,
    expectedDefinitionRevision: 2,
    idempotencyKey: 'manual:article-1'
  })
  expect(request.start).toBeUndefined()
})

it('refuses a definition revision outside the native host admission before starting', async () => {
  await expect(
    startCoordinatedTestRun(
      { ...binding, automation: { ...binding.automation, definitionRevision: 3 } },
      {}
    )
  ).rejects.toThrow('has not admitted')
  expect(methods()).toEqual(['status.get'])
})

it('recovers an uncertain native start from its original receipt without another start', async () => {
  const request: CoordinatedRunRequest = {}
  startError = new Error('Lost response')
  await expect(startCoordinatedTestRun(binding, request)).rejects.toThrow('Lost response')
  expect(request.startExecutionKind).toBe('native')
  const submitted = request.start!
  vi.mocked(listAutomationRunsForOwner).mockResolvedValue([
    {
      ...sampleActiveCoordinatedRun,
      id: view.inspection.automationRunId,
      automationId: binding.automation.id,
      idempotencyKey: submitted.idempotencyKey
    }
  ])
  status.runtimeId = view.runtimeId = 'restarted-runtime'
  await startCoordinatedTestRun(binding, request)
  expect(methods().filter((method) => method.startsWith('automation.start'))).toHaveLength(1)
  expect(request.start).toBeUndefined()
})

it('retains an uncertain native start when the host changes to simulated execution', async () => {
  const request: CoordinatedRunRequest = {}
  startError = new Error('Lost response')
  await expect(startCoordinatedTestRun(binding, request)).rejects.toThrow('Lost response')
  const original = structuredClone(request.start)
  status.capabilities = [FAKE]
  status.coordinatedFakeRuns = { available: true }
  await expect(startCoordinatedTestRun(binding, request)).rejects.toThrow('execution mode changed')
  expect(request.start).toEqual(original)
  expect(listAutomationRunsForOwner).not.toHaveBeenCalled()
})

it('refuses ambiguous host modes and mismatched run kinds', async () => {
  status.capabilities = [FAKE, NATIVE]
  await expect(readCoordinatedRunHost(binding)).rejects.toThrow('one supported')
  status.capabilities = [NATIVE]
  view.executionKind = 'fake'
  await expect(inspectCoordinatedRun(binding, view.inspection.automationRunId)).rejects.toThrow(
    'different'
  )
})

it('reconciles a native run through its native endpoint', async () => {
  view.inspection.receipt = { kind: 'absent', reason: 'Still running' }
  view.actions.reconcile = { available: true }
  await reconcileCoordinatedTestRun(binding, {}, view.inspection.automationRunId, 2)
  expect(methods()).toEqual([
    'status.get',
    'automation.inspectCoordinatedRun',
    'automation.reconcileCoordinatedNativeRun'
  ])
})

it.each(['mode', 'run'] as const)(
  'retains uncertain reconciliation when a completed receipt differs in %s',
  async (difference) => {
    const request: CoordinatedRunRequest = {
      reconcileExecutionKind: difference === 'mode' ? 'fake' : 'native',
      reconcile: {
        runtimeId: view.runtimeId,
        automationId: binding.automation.id,
        automationRunId: difference === 'run' ? 'another-run' : view.inspection.automationRunId,
        expectedOwner: { selector: { kind: 'self' } }
      }
    }
    const original = structuredClone(request)
    await expect(
      reconcileCoordinatedTestRun(binding, request, view.inspection.automationRunId)
    ).rejects.toThrow(difference === 'mode' ? 'execution mode changed' : 'different run or runtime')
    expect(request).toEqual(original)
    expect(methods()).toEqual(['status.get', 'automation.inspectCoordinatedRun'])
  }
)
