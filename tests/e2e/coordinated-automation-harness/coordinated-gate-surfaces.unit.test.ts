// @vitest-environment happy-dom
import '../../../src/main/runtime/rpc/unused-default-rpc-methods.test-fixture'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createCoordinatedRunRpcFixture } from '../../../src/main/runtime/coordinated-run-rpc.test-support'
import { child } from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import { callRuntimeRpc } from '../../../src/renderer/src/runtime/runtime-rpc-client'
import { AutomationCoordinatedHostRunPanel } from '../../../src/renderer/src/components/automations/AutomationCoordinatedHostRunPanel'
import { coordinatedHostFixtureEntry } from '../../../src/renderer/src/components/automations/coordinated-host-run-view-fixture'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
vi.mock('../../../src/renderer/src/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/web-client-location', () => ({
  isWebClientLocation: () => false
}))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  await fixture?.dispose()
  fixture = undefined
  vi.clearAllMocks()
})
async function click(element: Element | undefined | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Missing interactive control')
  }
  await act(async () => element.click())
}
function button(label: string) {
  return [...document.querySelectorAll('button')].find((entry) => entry.textContent === label)
}
const GATE = 'automation.resolveCoordinatedGate'
const submissions = () =>
  vi.mocked(callRuntimeRpc).mock.calls.filter(([, method]) => method === GATE)

it.each([false, true])(
  'composes real host, RPC, and pinned=%s live surface through lost rejection A, hold B, replay and approval',
  async (pinned) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    fixture = await createCoordinatedRunRpcFixture({
      definition: {
        children: [
          child('writer', {
            launchConfig: { maxRetries: 1 },
            stageAcceptance: { requiredApprovals: [{ id: 'signoff', role: 'editor' }] }
          }),
          child('reviewer', { dependencies: [{ childId: 'writer' }] })
        ]
      }
    })
    const host = fixture
    host.env.scripts.set('writer', (identity, attempt) => [
      { type: 'report', result: host.env.report(identity, { summary: `Draft ${attempt}` }) }
    ])
    host.env.scripts.set('reviewer', (identity) => [
      { type: 'report', result: host.env.report(identity) }
    ])
    const started = await host.runtime.startCoordinatedFakeRun(host.startRequest)
    const runId = started.view.inspection.automationRunId
    const run = host.env.run(runId)
    const automation = host.env.store
      .listAutomations()
      .find((entry) => entry.id === host.automationId)!
    const progress = () =>
      createFileCoordinatedRunProgressStore(
        join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)
      ).read(runId)!
    let loseResponse = true
    vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method, params) => {
      if (method === 'status.get') {
        return host.runtime.getStatus()
      }
      const response = await host.rpc(method, params)
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      if (method === GATE && loseResponse) {
        loseResponse = false
        throw new Error('Committed rejection response lost')
      }
      return response.result
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root!.render(
        createElement(AutomationCoordinatedHostRunPanel, {
          automation,
          runs: [run],
          pinnedRun: pinned ? run : undefined,
          capturedOwner: { owner: coordinatedHostFixtureEntry.owner, selector: { kind: 'self' } },
          hostEntry: coordinatedHostFixtureEntry,
          requests: new Map(),
          enabled: true
        })
      )
    )
    const resolve = () => container!.querySelector('[aria-label="Resolve stage gate signoff"]')
    const confirm = () => document.querySelector('[data-testid="confirm-run-control-action"]')
    expect(container.textContent).toContain('Draft 1')
    await click(resolve())
    await click(document.querySelector('[aria-label="reject"]'))
    await click(confirm())
    const original = structuredClone(submissions()[0][2])
    expect(container.textContent).toContain('Its effect is unknown')
    const second = progress().stages.writer.pendingApproval!
    expect(progress().operatorDecisions).toHaveLength(1)
    expect(original).toMatchObject({
      stageCandidate: {
        kind: 'report',
        dispatchId: progress().operatorDecisions![0].dispatchId,
        reportDigest: progress().operatorDecisions![0].reportDigest
      }
    })
    await click(button(pinned ? 'Refresh run' : 'Refresh test runs'))
    expect(container.textContent).toContain('Draft 2')
    await click(button('Ask host about this request'))
    expect(submissions()[1][2]).toEqual(original)
    expect(progress().operatorDecisions).toHaveLength(1)
    expect(progress().stages.writer.pendingApproval).toEqual(second)
    expect(resolve()).not.toBeNull()
    await click(resolve())
    await click(document.querySelector('[aria-label="approve"]'))
    await click(confirm())
    expect(submissions()[2][2]).toMatchObject({
      decision: 'approve',
      stageCandidate: {
        kind: 'report',
        dispatchId: second.dispatchId,
        reportDigest: second.reportDigest
      }
    })
    expect(progress().operatorDecisions!.map((entry) => entry.decision)).toEqual([
      'reject',
      'approve'
    ])
    expect(host.env.run(runId).completionReceipt).toBeDefined()
    expect(host.env.dispatchIds(runId, 'reviewer')).toHaveLength(1)
    expect(await host.rpc(GATE, submissions()[2][2])).toMatchObject({
      ok: true,
      result: { disposition: 'already_recorded' }
    })
    expect(host.env.dispatchIds(runId, 'reviewer')).toHaveLength(1)
  }
)
