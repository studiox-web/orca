// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitAutomationsChangedWindowEvent } from '@/lib/automations-changed-window-event'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../../shared/automation-runtime-capabilities'
import { AutomationCoordinatedHostRunPanel } from './AutomationCoordinatedHostRunPanel'
import { sampleCompletedVerifiedRun as run } from './AutomationCoordinatedRunPanel.fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { coordinatedHostFixtureEntry } from './coordinated-host-run-view-fixture'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))

let root: Root
let container: HTMLDivElement
let view: ReturnType<typeof coordinatedHostActiveViewFixture>
let props: Parameters<typeof AutomationCoordinatedHostRunPanel>[0]
let loseAnswer: boolean
const gateId = 'gate-editorial-signoff'
const resolveMethod = 'automation.resolveCoordinatedGate'
const submissions = () =>
  vi.mocked(callRuntimeRpc).mock.calls.filter(([, method]) => method === resolveMethod)
const dialog = () => document.querySelector('[role="dialog"]')!
const confirm = () =>
  dialog().querySelector<HTMLButtonElement>('[data-testid="confirm-run-control-action"]')!
async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected an interactive HTML element')
  }
  await act(async () => element.click())
}
function button(label: string) {
  return [...document.querySelectorAll('button')].find((entry) => entry.textContent === label)!
}
async function render() {
  await act(async () => root.render(<AutomationCoordinatedHostRunPanel {...props} />))
}
async function open(scope = 'stage') {
  await click(container.querySelector(`[aria-label="Resolve ${scope} gate ${gateId}"]`))
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  view = coordinatedHostActiveViewFixture()
  loseAnswer = false
  props = {
    automation: { ...sampleCoordinatedArticleAutomation, enabled: false },
    runs: [run],
    capturedOwner: { owner: coordinatedHostFixtureEntry.owner, selector: { kind: 'self' } },
    hostEntry: coordinatedHostFixtureEntry,
    requests: new Map(),
    enabled: true
  }
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method) => {
    if (method === 'status.get') {
      return {
        runtimeId: view.runtimeId,
        capabilities: [FAKE],
        coordinatedFakeRuns: { available: true }
      }
    }
    if (method === 'automation.inspectCoordinatedRun') {
      return { view: structuredClone(view) }
    }
    if (method === resolveMethod) {
      if (loseAnswer) {
        throw new Error('Answer lost')
      }
      return {
        disposition: 'already_recorded',
        state: 'awaiting_approval',
        reason: null,
        view: structuredClone(view)
      }
    }
    throw new Error(`Unexpected method ${method}`)
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
})

describe.each([false, true])('held approval on pinned route %s', (pinned) => {
  beforeEach(() => {
    if (pinned) {
      props.pinnedRun = run
    }
  })

  it('shows completed worker and held evidence, submitting exactly the displayed report and scope', async () => {
    await render()
    const reviewer = container.querySelector(
      `[aria-label="${view.inspection.stages[2].name} held report"]`
    )!
    expect(reviewer.textContent).toContain('Waiting for human approval')
    expect(reviewer.textContent).toContain('Review complete; awaiting editorial sign-off.')
    expect(reviewer.textContent).toContain('style-guide · passed')
    expect(reviewer.closest('li')?.textContent).toContain('Technical: completed · completed')
    expect(reviewer.closest('li')?.textContent).not.toContain('attempt open')
    expect(reviewer.closest('li')?.textContent).toContain('Admitted attempts: 0')
    expect(reviewer.closest('li')?.textContent).toContain('initial · awaiting human approval')
    await open()
    expect(dialog().textContent).toContain('Review complete; awaiting editorial sign-off.')
    expect(dialog().textContent).toContain('file:///workspace/review.md')
    expect(dialog().querySelector('a')).toBeNull()
    await click(confirm())
    expect(submissions()).toHaveLength(1)
    expect(submissions()[0][2]).toEqual({
      runtimeId: 'isolated-runtime',
      automationId: run.automationId,
      automationRunId: run.id,
      expectedOwner: { selector: { kind: 'self' } },
      orchestrationRunId: 'orch_run_verified_202',
      definitionRevision: 2,
      targetExecutionAuthority: 'local:local-host',
      gateScope: 'stage',
      gateId,
      decision: 'approve',
      childDefinitionId: 'child-reviewer',
      taskId: 'task_rev_3',
      dispatchId: 'ctx_rev_1',
      expectedReportDigest: view.inspection.stages[2].pendingApproval!.reportDigest
    })
    expect(container.textContent).toContain('already recorded this approve decision')
    expect(container.textContent).toContain('this request wrote nothing')
  })

  it.each(['dispatch', 'digest', 'unavailable'] as const)(
    'refuses %s changes during dialog delay without replacing the shown candidate',
    async (change) => {
      await render()
      await open()
      const held = view.inspection.stages[2].pendingApproval!
      if (change === 'dispatch') {
        held.dispatchId = 'ctx_rev_2'
        view.inspection.stages[2].gateResolutionEligibility.approvableDispatchId = held.dispatchId
      } else if (change === 'digest') {
        held.reportDigest = 'sha256:new-report'
      } else {
        held.report = { kind: 'unavailable', reason: 'Report changed on host.' }
      }
      if (held.report.kind === 'available') {
        held.report.summary = 'Replacement report'
      }
      // The host refresh arrives while the original decision remains open.
      await act(async () => emitAutomationsChangedWindowEvent({ reason: 'run' }))
      expect(dialog().textContent).toContain('Review complete; awaiting editorial sign-off.')
      expect(dialog().textContent).not.toContain('Replacement report')
      expect(container.textContent).toContain(
        change === 'unavailable' ? 'Report changed on host.' : 'Replacement report'
      )
      await click(confirm())
      expect(submissions()).toHaveLength(0)
      expect(container.textContent).toContain('Nothing was submitted')
    }
  )

  it.each(['missing', 'absent', 'unavailable'] as const)(
    'does not offer approval with %s held evidence, while reject keeps its explicit scope',
    async (kind) => {
      const stage = view.inspection.stages[2]
      if (kind === 'missing') {
        delete stage.pendingApproval
      } else {
        stage.pendingApproval!.report = { kind, reason: 'No verified report bytes.' }
      }
      await render()
      await open()
      expect(confirm().disabled).toBe(true)
      expect(
        dialog().querySelector('[aria-label="approve"]')?.getAttribute('disabled')
      ).not.toBeNull()
      await click(dialog().querySelector('[aria-label="reject"]'))
      expect(confirm().disabled).toBe(false)
      await click(confirm())
      expect(submissions()[0][2]).toMatchObject({
        gateScope: 'stage',
        gateId,
        decision: 'reject',
        taskId: 'task_rev_3'
      })
      expect(submissions()[0][2]).not.toHaveProperty('expectedReportDigest')
      expect(submissions()[0][2]).not.toHaveProperty('dispatchId')
    }
  )

  it('keeps parent approval free of stage evidence even when its gate id is shared', async () => {
    await render()
    await open('parent')
    expect(dialog().textContent).not.toContain('Review complete; awaiting editorial sign-off.')
    await click(confirm())
    expect(submissions()[0][2]).toMatchObject({ gateScope: 'parent', gateId, decision: 'approve' })
    for (const field of ['childDefinitionId', 'taskId', 'dispatchId', 'expectedReportDigest']) {
      expect(submissions()[0][2]).not.toHaveProperty(field)
    }
  })

  it('retains the original payload after a lost answer and truthfully acknowledges a settled same-candidate replay', async () => {
    loseAnswer = true
    await render()
    await open()
    await click(confirm())
    const original = structuredClone(submissions()[0][2])
    expect(container.textContent).toContain('Its effect is unknown')
    delete view.inspection.stages[2].pendingApproval
    view.inspection.humanResolution.pendingDecisions = []
    view.actions.humanResolution = {
      available: false,
      state: 'refused',
      reason: 'Already resolved.'
    }
    await click(button(pinned ? 'Refresh run' : 'Refresh test runs'))
    loseAnswer = false
    await click(button('Ask host about this request'))
    expect(submissions()).toHaveLength(2)
    expect(submissions()[1][2]).toEqual(original)
    expect(container.textContent).toContain('this request wrote nothing')
    expect(container.textContent).not.toContain('Its effect is unknown')
  })
})
