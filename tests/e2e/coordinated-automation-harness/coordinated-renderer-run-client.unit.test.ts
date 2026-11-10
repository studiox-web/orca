import '../../../src/main/runtime/rpc/unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoordinatedRunRpcFixture } from '../../../src/main/runtime/coordinated-run-rpc.test-support'
import { callRuntimeRpc } from '../../../src/renderer/src/runtime/runtime-rpc-client'
import {
  inspectCoordinatedRun,
  startCoordinatedTestRun,
  reconcileCoordinatedTestRun,
  type CoordinatedRunRequest,
  type CoordinatedRunBinding
} from '../../../src/renderer/src/components/automations/coordinated-run-api-client'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
vi.mock('../../../src/renderer/src/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined
async function setup(options?: Parameters<typeof createCoordinatedRunRpcFixture>[0]) {
  fixture = await createCoordinatedRunRpcFixture(options)
  const host = fixture
  const requests: { method: string; input: unknown }[] = []
  let loseResponse: string | null = null
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method, input) => {
    requests.push({ method, input: structuredClone(input) })
    if (method === 'status.get') {
      return host.runtime.getStatus()
    }
    const result = await host.rpc(method, input)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    if (method === loseResponse) {
      loseResponse = null
      throw new Error('Committed response lost')
    }
    return result.result
  })
  const automation = host.env.store
    .listAutomations()
    .find((entry) => entry.id === host.automationId)!
  const binding: CoordinatedRunBinding = {
    automation,
    owner: { authority: { kind: 'desktop' }, selector: { kind: 'self' } }
  }
  return {
    host,
    binding,
    requests,
    lose: (method: string) => {
      loseResponse = method
    }
  }
}
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.clearAllMocks()
})

describe('renderer transactions against accepted Store and public run RPC', () => {
  it('starts and inspects the exact run, keeping technical status and receipt separate', async () => {
    const { binding, requests } = await setup()
    const request: CoordinatedRunRequest = {}
    const started = await startCoordinatedTestRun(binding, request)
    expect(started.inspection.receipt.kind).toBe('available')
    expect(started.inspection.stages[0].sessionTarget.kind).toBe('unavailable')
    expect(await inspectCoordinatedRun(binding, started.inspection.automationRunId, 1)).toEqual(
      started
    )
    expect(request.start).toBeUndefined()
    expect(
      requests.find((item) => item.method === 'automation.startCoordinatedFakeRun')?.input
    ).toMatchObject({
      runtimeId: started.runtimeId,
      automationId: binding.automation.id,
      expectedDefinitionRevision: 1,
      expectedOwner: { selector: { kind: 'self' } }
    })
  })
  it('recovers commit-then-lost-response by exact history and inspect before any replay, preserving the submitted revision after edits', async () => {
    const { binding, host, requests, lose } = await setup()
    const request: CoordinatedRunRequest = {}
    lose('automation.startCoordinatedFakeRun')
    await expect(startCoordinatedTestRun(binding, request)).rejects.toThrow(
      'Committed response lost'
    )
    const submitted = structuredClone(request.start)
    const recovered = await startCoordinatedTestRun(
      { ...binding, automation: { ...binding.automation, definitionRevision: 2 } },
      request
    )
    expect(recovered.inspection.definitionRevision).toBe(1)
    expect(recovered.inspection.idempotencyKey).toBe(submitted?.idempotencyKey)
    expect(host.env.store.listAutomationRuns(binding.automation.id)).toHaveLength(1)
    expect(
      requests.filter((item) => item.method === 'automation.startCoordinatedFakeRun')
    ).toHaveLength(1)
    expect(requests.slice(-2).map((item) => item.method)).toEqual([
      'automation.runs',
      'automation.inspectCoordinatedRun'
    ])
    expect(request.start).toBeUndefined()
  })
  it('replays the identical request when persistence did not happen, and the real host deduplicates it', async () => {
    const { binding, host } = await setup()
    const request: CoordinatedRunRequest = { start: { ...host.startRequest } }
    const submitted = structuredClone(request.start)
    const first = await startCoordinatedTestRun(binding, request)
    request.start = submitted
    const second = await startCoordinatedTestRun(binding, request)
    expect(second.inspection.automationRunId).toBe(first.inspection.automationRunId)
    expect(host.env.store.listAutomationRuns(binding.automation.id)).toHaveLength(1)
  })
  it('retains a refused revision request without rotating its key or creating a run', async () => {
    const { binding, host } = await setup()
    const request: CoordinatedRunRequest = {}
    const changed = { ...binding, automation: { ...binding.automation, definitionRevision: 99 } }
    await expect(startCoordinatedTestRun(changed, request)).rejects.toThrow()
    const submitted = structuredClone(request.start)
    await expect(startCoordinatedTestRun(binding, request)).rejects.toThrow()
    expect(request.start).toEqual(submitted)
    expect(host.env.store.listAutomationRuns(binding.automation.id)).toHaveLength(0)
  })
  it('checks the receipt before replaying an uncertain reconcile', async () => {
    const { binding, requests } = await setup()
    const started = await startCoordinatedTestRun(binding, {})
    const request: CoordinatedRunRequest = {
      reconcile: {
        runtimeId: started.runtimeId,
        automationId: binding.automation.id,
        automationRunId: started.inspection.automationRunId,
        expectedOwner: { selector: { kind: 'self' } }
      }
    }
    const result = await reconcileCoordinatedTestRun(
      binding,
      request,
      started.inspection.automationRunId,
      1
    )
    expect(result.inspection.receipt.kind).toBe('available')
    expect(request.reconcile).toBeUndefined()
    expect(requests.some((item) => item.method === 'automation.reconcileCoordinatedFakeRun')).toBe(
      false
    )
  })
  it('recovers a reconcile that committed before losing its response without repeating worker attempts', async () => {
    const { binding, host, lose, requests } = await setup()
    const created = host.env.store.createCoordinatedAutomationRun({
      automationId: binding.automation.id,
      trigger: 'manual',
      scheduledFor: host.env.harness.clock.now(),
      idempotencyKey: 'renderer-pending-reconcile',
      expectedDefinitionRevision: 1,
      expectedOwner: { selector: { kind: 'self' } }
    })
    if (!created.run) {
      throw new Error('Missing isolated pending run')
    }
    const request: CoordinatedRunRequest = {}
    lose('automation.reconcileCoordinatedFakeRun')
    await expect(reconcileCoordinatedTestRun(binding, request, created.run.id, 1)).rejects.toThrow(
      'Committed response lost'
    )
    const submitted = structuredClone(request.reconcile)
    expect(submitted?.automationRunId).toBe(created.run.id)
    const attempts = new Map(host.env.attempts)
    const recovered = await reconcileCoordinatedTestRun(binding, request, created.run.id, 1)
    expect(recovered.inspection.receipt.kind).toBe('available')
    expect(host.env.attempts).toEqual(attempts)
    expect(
      requests.filter((entry) => entry.method === 'automation.reconcileCoordinatedFakeRun')
    ).toHaveLength(1)
    expect(request.reconcile).toBeUndefined()
  })
  it('fails closed on host unavailability and on a foreign run selection', async () => {
    const { binding, host } = await setup()
    await expect(inspectCoordinatedRun(binding, 'foreign-run')).rejects.toThrow()
    host.service.stop()
    await expect(startCoordinatedTestRun(binding, {})).rejects.toThrow()
    expect(host.env.store.listAutomationRuns(binding.automation.id)).toHaveLength(0)
  })
  it('rejects SSH and remote callers before any RPC', async () => {
    const { binding, requests } = await setup()
    await expect(
      startCoordinatedTestRun(
        {
          ...binding,
          owner: {
            ...binding.owner,
            selector: { kind: 'ssh', targetId: 'prod', targetGeneration: 1 }
          }
        },
        {}
      )
    ).rejects.toThrow('Self')
    await expect(
      startCoordinatedTestRun(
        {
          ...binding,
          owner: {
            authority: { kind: 'runtime', environmentId: 'prod', pairingRevision: 1 },
            selector: { kind: 'self' }
          }
        },
        {}
      )
    ).rejects.toThrow('local caller')
    expect(requests).toHaveLength(0)
  })
})
