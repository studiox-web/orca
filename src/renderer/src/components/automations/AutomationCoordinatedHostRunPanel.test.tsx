// @vitest-environment happy-dom
import { act } from 'react'
import type * as CoordinatedRunApiClient from './coordinated-run-api-client'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationCoordinatedHostRunPanel } from './AutomationCoordinatedHostRunPanel'
import { sampleCompletedVerifiedRun } from './AutomationCoordinatedRunPanel.fixture'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'
import {
  coordinatedHostFixtureEntry,
  coordinatedHostViewFixture
} from './coordinated-host-run-view-fixture'
import type * as CoordinatedRunOperatorClient from './coordinated-run-operator-client'
import {
  CoordinatedOperatorUnconfirmedError,
  submitCoordinatedRunOperatorAction,
  type CoordinatedRunOperatorOutcome
} from './coordinated-run-operator-client'
import { openOrchestrationCrewAgent } from '@/lib/open-agent-message-sender'
import {
  inspectCoordinatedRun,
  readCoordinatedRunHost,
  type CoordinatedRunRequest
} from './coordinated-run-api-client'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'

vi.mock('./coordinated-run-api-client', async (original) => ({
  ...(await original<typeof CoordinatedRunApiClient>()),
  inspectCoordinatedRun: vi.fn(),
  readCoordinatedRunHost: vi.fn()
}))
vi.mock('./coordinated-run-operator-client', async (original) => ({
  ...(await original<typeof CoordinatedRunOperatorClient>()),
  submitCoordinatedRunOperatorAction: vi.fn()
}))
vi.mock('@/lib/open-agent-message-sender', () => ({ openOrchestrationCrewAgent: vi.fn() }))
let root: Root
let container: HTMLDivElement
let props: Parameters<typeof AutomationCoordinatedHostRunPanel>[0]
function deferredView() {
  let resolve!: (view: CoordinatedRunView) => void
  const promise = new Promise<CoordinatedRunView>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function render() {
  await act(async () => {
    root.render(<AutomationCoordinatedHostRunPanel {...props} />)
  })
}
function button(label: string, scope: ParentNode = document.body): HTMLButtonElement {
  return [...scope.querySelectorAll('button')].find((entry) => entry.textContent === label)!
}
async function click(label: string, scope: ParentNode = container) {
  await act(async () => {
    button(label, scope)?.click()
  })
}
function stageItem(child: string): HTMLElement {
  const item = [
    ...container.querySelectorAll<HTMLElement>('[aria-label="Host-observed stages"] > li')
  ].find((entry) => entry.textContent?.includes(`Child child-${child} `))
  if (!item) {
    throw new Error(`No host stage for child-${child}`)
  }
  return item
}
function outcome(
  action: CoordinatedRunOperatorOutcome['action'],
  view = coordinatedHostActiveViewFixture(),
  disposition: CoordinatedRunOperatorOutcome['disposition'] = 'recorded'
): CoordinatedRunOperatorOutcome {
  return {
    action,
    disposition,
    state: 'outcome_uncertain',
    reason: 'Awaiting exit evidence.',
    view
  }
}
async function select(runId: string) {
  await act(async () => {
    const control = container.querySelector('select')!
    control.value = runId
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  props = {
    automation: { ...sampleCoordinatedArticleAutomation, enabled: false },
    runs: [sampleCompletedVerifiedRun, { ...sampleCompletedVerifiedRun, id: 'second-run' }],
    hostEntry: coordinatedHostFixtureEntry,
    capturedOwner: { owner: coordinatedHostFixtureEntry.owner, selector: { kind: 'self' } },
    enabled: true,
    requests: new Map<string, CoordinatedRunRequest>()
  }
  vi.mocked(inspectCoordinatedRun).mockImplementation(async (_binding, id) =>
    coordinatedHostViewFixture(id)
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
})

describe('selected host run observation', () => {
  it('renders real availability distinctions, exact attempts and receipt without invented spend or sessions', async () => {
    await render()
    expect(container.textContent).toContain('Frozen revision: 2')
    expect(container.textContent).toContain('Technical run status: completed')
    expect(container.textContent).toContain('Semantic acceptance: accepted')
    expect(container.textContent).toContain('Dispatch ctx_res_1')
    expect(container.textContent).toContain('Worker session unavailable:')
    expect(container.textContent).toContain('Spend, elapsed time')
    expect(container.textContent).not.toContain('$0.00')
    expect(container.querySelector('[aria-label="Host-observed stages"]')).not.toBeNull()
    expect(container.querySelector('select')?.labels?.[0].textContent).toContain(
      'Selected test run'
    )
    expect(button('Stop run', container).disabled).toBe(true)
    expect(container.textContent).toContain('Stop unavailable: The run is already settled.')
    expect(button('Open worker terminal', container).disabled).toBe(true)
  })
  it('discards a delayed response after selected-run switching', async () => {
    const first = deferredView()
    vi.mocked(inspectCoordinatedRun).mockImplementationOnce(() => first.promise)
    await render()
    await select('second-run')
    expect(container.textContent).toContain('Parent run: second-run')
    await act(async () => first.resolve(coordinatedHostViewFixture()))
    expect(container.textContent).toContain('Parent run: second-run')
    expect(container.textContent).not.toContain(`Parent run: ${sampleCompletedVerifiedRun.id}`)
    expect(vi.mocked(inspectCoordinatedRun).mock.calls[1]?.slice(1)).toEqual(['second-run', 2])
  })
  it('clears trusted receipt and worker state on host unavailability and ignores its late reply', async () => {
    await render()
    const late = deferredView()
    vi.mocked(inspectCoordinatedRun).mockImplementationOnce(() => late.promise)
    await click('Refresh test runs')
    props = {
      ...props,
      hostEntry: { ...coordinatedHostFixtureEntry, authorityHealth: 'unavailable' }
    }
    await render()
    await act(async () => late.resolve(coordinatedHostViewFixture()))
    expect(container.textContent).toContain('owning host is unavailable')
    expect(container.textContent).not.toContain('Semantic acceptance: accepted')
    expect(container.textContent).not.toContain('Semantic receipt: ready_to_publish')
  })
  it('clears evidence on an explicit host refusal without falling back to persisted receipts', async () => {
    await render()
    vi.mocked(inspectCoordinatedRun).mockRejectedValueOnce(
      new Error('Selected run refused by host owner fence')
    )
    await click('Refresh test runs')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('owner fence')
    expect(container.textContent).not.toContain('Semantic receipt: ready_to_publish')
    expect(container.querySelector('[aria-label="Host-observed stages"]')).toBeNull()
  })
  it('invalidates observations when the parent revision or captured authority changes', async () => {
    const late = deferredView()
    vi.mocked(inspectCoordinatedRun).mockImplementationOnce(() => late.promise)
    await render()
    props = {
      ...props,
      automation: { ...props.automation, definitionRevision: 4 },
      historyUnavailable: 'History belongs to a disconnected authority'
    }
    await render()
    await act(async () => late.resolve(coordinatedHostViewFixture()))
    expect(container.textContent).toContain('disconnected authority')
    expect(container.querySelector('[aria-label="Host-observed stages"]')).toBeNull()
  })
  it('keeps the feature off and normal no-capability hosts inoperative', async () => {
    props = { ...props, enabled: false, runs: [] }
    await render()
    expect(readCoordinatedRunHost).not.toHaveBeenCalled()
    const startButton = () =>
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Start no-effect test run'
      )!
    expect(startButton().disabled).toBe(true)
    props = { ...props, enabled: true }
    vi.mocked(readCoordinatedRunHost).mockRejectedValueOnce(
      new Error('This host does not support isolated no-effect test runs.')
    )
    await render()
    expect(startButton().disabled).toBe(true)
    expect(container.textContent).toContain('does not support isolated')
  })
})

describe('selected host run operator controls', () => {
  beforeEach(() => {
    vi.mocked(inspectCoordinatedRun).mockImplementation(async (_binding, id) =>
      coordinatedHostActiveViewFixture(id)
    )
  })
  it('submits one stop after the impact preview and reports only the host answer', async () => {
    const stopped = coordinatedHostActiveViewFixture()
    stopped.inspection.operatorStop = { at: 1762712000000, reason: null }
    const reply = Promise.withResolvers<CoordinatedRunOperatorOutcome>()
    vi.mocked(submitCoordinatedRunOperatorAction).mockReturnValue(reply.promise)
    await render()
    await click('Stop run')
    expect(document.body.textContent).toContain('not proof that a worker exited')
    expect(document.body.textContent).toContain('local:local-host')
    await click('Confirm Stop Run', document.body)
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    expect(submitCoordinatedRunOperatorAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitCoordinatedRunOperatorAction).mock.calls[0]?.[2]).toEqual({
      kind: 'stop'
    })
    expect(container.textContent).not.toContain('The host recorded')
    await act(async () => reply.resolve(outcome({ kind: 'stop' }, stopped)))
    const status = [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent)
    expect(status.join(' ')).toContain(
      'The host recorded the stop request. Worker exit is not proven until the run settles. Reported run state: outcome_uncertain (Awaiting exit evidence.).'
    )
  })
  it('retries only the confirmed latest attempt and keeps ineligible stages disabled', async () => {
    vi.mocked(submitCoordinatedRunOperatorAction).mockResolvedValue(
      outcome({
        kind: 'retry',
        childDefinitionId: 'child-writer',
        retryOfDispatchId: 'ctx_writer_2'
      })
    )
    await render()
    expect(button('Retry stage', stageItem('researcher')).disabled).toBe(true)
    expect(stageItem('researcher').textContent).toContain('Attempt ctx_res_1 is still open.')
    await click('Retry stage', stageItem('writer'))
    expect(document.body.textContent).toContain('ctx_writer_2')
    await click('Confirm Retry Stage', document.body)
    expect(vi.mocked(submitCoordinatedRunOperatorAction).mock.calls[0]?.[2]).toEqual({
      kind: 'retry',
      childDefinitionId: 'child-writer',
      retryOfDispatchId: 'ctx_writer_2'
    })
  })
  it('resolves same-id decisions in their own scope and shows recorded approvals', async () => {
    vi.mocked(submitCoordinatedRunOperatorAction).mockImplementation(
      async (_binding, _run, action) => outcome(action)
    )
    await render()
    const decisions = () => container.querySelector('[aria-label="Pending decisions"]')!
    expect(decisions().querySelectorAll('li')).toHaveLength(3)
    expect(container.querySelector('[aria-label="Stage approvals"]')?.textContent).toContain(
      'gate-editorial-signoff · reviewer · pending · stage child-reviewer'
    )
    await click('Resolve', decisions().querySelectorAll('li')[1])
    expect(document.body.textContent).toContain('Parent outcome (no stage scope)')
    await click('Confirm Gate Decision', document.body)
    await click('Resolve', decisions().querySelectorAll('li')[2])
    expect(document.body.textContent).toContain('records your acknowledgement only')
    await click('Confirm Gate Decision', document.body)
    expect(vi.mocked(submitCoordinatedRunOperatorAction).mock.calls.map((call) => call[2])).toEqual(
      [
        {
          kind: 'gate',
          candidate: expect.objectContaining({
            base: expect.objectContaining({ automationRunId: sampleCompletedVerifiedRun.id })
          }),
          gateId: 'gate-editorial-signoff',
          scope: 'parent',
          childDefinitionId: null,
          decision: 'approve'
        },
        {
          kind: 'gate',
          candidate: expect.objectContaining({
            base: expect.objectContaining({ automationRunId: sampleCompletedVerifiedRun.id })
          }),
          gateId: 'escalation:uncertain-effect',
          scope: 'escalation',
          childDefinitionId: null,
          decision: 'approve'
        }
      ]
    )
  })
  it('blocks an ineligible held report and names the captured attempt', async () => {
    await render()
    const first = () => container.querySelector('[aria-label="Pending decisions"] li')!
    await click('Resolve', first())
    expect(document.body.textContent).toContain('approve binds ctx_rev_1')
    expect(button('Confirm Gate Decision').disabled).toBe(false)
    await click('Cancel', document.body)
    const waiting = coordinatedHostActiveViewFixture()
    waiting.inspection.stages[2].gateResolutionEligibility.approvableDispatchId = null
    vi.mocked(inspectCoordinatedRun).mockResolvedValue(waiting)
    await click('Refresh test runs')
    await click('Resolve', first())
    expect(button('Confirm Gate Decision').disabled).toBe(true)
    expect(document.body.textContent).toContain('held report is not eligible')
    await act(async () => document.getElementById('gate-decision-reject')?.click())
    expect(button('Confirm Gate Decision').disabled).toBe(false)
  })
  it('shows report evidence with its semantic disposition as plain text and never as links', async () => {
    await render()
    const writer = stageItem('writer')
    expect(writer.textContent).toContain('Rejected by the coordinator')
    expect(writer.textContent).toContain('A worker-reported succeeded is not semantic acceptance.')
    expect(writer.textContent).toContain('<b>Ready to publish</b>')
    expect(writer.querySelector('b')).toBeNull()
    expect(writer.textContent).toContain('no content digest reported')
    expect(writer.textContent).toContain('Blocker missing_citations')
    expect(container.querySelector('a')).toBeNull()
    expect(stageItem('researcher').textContent).toContain('· attempt open')
    expect(stageItem('researcher').textContent).toContain('Report evidence absent:')
    expect(stageItem('publisher').textContent).toContain(
      'Report evidence unavailable: The native Task result no longer matches'
    )
    const superseded = coordinatedHostActiveViewFixture()
    const stage = superseded.inspection.stages[1]
    if (stage.semantic.kind === 'available') {
      stage.semantic.activeDispatchId = 'ctx_writer_3'
    }
    vi.mocked(inspectCoordinatedRun).mockResolvedValue(superseded)
    await click('Refresh test runs')
    expect(stageItem('writer').textContent).toContain('A newer attempt ctx_writer_3 has launched')
  })
  it('refuses every control when the host authority is absent or contradicts run history', async () => {
    const unfrozen = coordinatedHostActiveViewFixture()
    unfrozen.inspection.targetExecutionAuthority = null
    vi.mocked(inspectCoordinatedRun).mockResolvedValue(unfrozen)
    await render()
    expect(button('Stop run', container).disabled).toBe(true)
    expect(button('Resolve', container).disabled).toBe(true)
    expect(container.textContent).toContain('no frozen execution authority')
    unfrozen.inspection.targetExecutionAuthority = 'ssh:other'
    await click('Refresh test runs')
    expect(button('Retry stage', stageItem('writer')).disabled).toBe(true)
    expect(container.textContent).toContain('different execution authority than the host')
  })
  it('discards an operator reply that outlives the selected run', async () => {
    const reply = Promise.withResolvers<CoordinatedRunOperatorOutcome>()
    vi.mocked(submitCoordinatedRunOperatorAction).mockReturnValue(reply.promise)
    await render()
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    await select('second-run')
    await act(async () => reply.resolve(outcome({ kind: 'stop' })))
    expect(container.textContent).toContain('Parent run: second-run')
    expect(container.textContent).not.toContain('The host recorded')
  })
  it('claims no outcome when the host does not confirm the request', async () => {
    vi.mocked(submitCoordinatedRunOperatorAction).mockRejectedValue(new Error('request timed out'))
    await render()
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    const alert = container.querySelector('[role="alert"]')?.textContent
    expect(alert).toContain('request timed out')
    expect(alert).toContain('no outcome change is claimed')
    expect(container.textContent).not.toContain('The host recorded')
  })
  it('keeps host-scoped controls and hides frozen details when history is another definition', async () => {
    props = {
      ...props,
      runs: props.runs.map((run) => ({
        ...run,
        resolvedSnapshot: { ...run.resolvedSnapshot!, canonicalDigest: 'sha256:other' }
      }))
    }
    await render()
    expect(button('Stop run', container).disabled).toBe(false)
    expect(container.textContent).toContain(
      'Frozen definition details are unavailable until matching run history is refreshed.'
    )
  })
  it('opens only the host-minted terminal of the current attempt on the owning host', async () => {
    await render()
    expect(button('Open worker terminal', stageItem('writer')).disabled).toBe(true)
    await click('Open worker terminal', stageItem('researcher'))
    expect(vi.mocked(openOrchestrationCrewAgent).mock.calls).toEqual([
      [
        expect.objectContaining({
          partyKey: 'pane:research:1',
          openTarget: { kind: 'terminal', handle: 'term_res_1' }
        }),
        { kind: 'local' }
      ]
    ])
    const superseded = coordinatedHostActiveViewFixture()
    const researcher = superseded.inspection.stages[0]
    if (researcher.native.kind === 'available') {
      researcher.native.latestDispatchId = 'ctx_res_2'
    }
    vi.mocked(inspectCoordinatedRun).mockResolvedValue(superseded)
    await click('Refresh test runs')
    expect(button('Open worker terminal', stageItem('researcher')).disabled).toBe(true)
    expect(stageItem('researcher').textContent).toContain('not the stage’s current attempt')
  })
})

describe('run pinned to the run details route', () => {
  const other = { ...sampleCompletedVerifiedRun, id: 'second-run' }
  beforeEach(() => {
    vi.mocked(inspectCoordinatedRun).mockImplementation(async (_binding, id) =>
      coordinatedHostActiveViewFixture(id)
    )
    props = {
      ...props,
      runs: [other, sampleCompletedVerifiedRun],
      pinnedRun: sampleCompletedVerifiedRun
    }
  })
  it('acts on the routed run, never the latest history entry, and offers no new start', async () => {
    vi.mocked(submitCoordinatedRunOperatorAction).mockResolvedValue(outcome({ kind: 'stop' }))
    await render()
    expect(vi.mocked(inspectCoordinatedRun).mock.calls[0]?.[1]).toBe(sampleCompletedVerifiedRun.id)
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).not.toContain('Start no-effect test run')
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    expect(vi.mocked(submitCoordinatedRunOperatorAction).mock.calls[0]?.[1].id).toBe(
      sampleCompletedVerifiedRun.id
    )
  })
  it('drops a reply after the route changes, keeps the unconfirmed request, and replays it once', async () => {
    const reply = Promise.withResolvers<CoordinatedRunOperatorOutcome>()
    vi.mocked(submitCoordinatedRunOperatorAction).mockReturnValueOnce(reply.promise)
    await render()
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    props = { ...props, pinnedRun: other }
    await render()
    await act(async () => reply.reject(new CoordinatedOperatorUnconfirmedError('timed out')))
    expect(container.textContent).toContain('Parent run: second-run')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    props = { ...props, pinnedRun: sampleCompletedVerifiedRun }
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'An earlier stop request for this run was submitted without a confirmed answer (timed out). Its effect is unknown.'
    )
    vi.mocked(submitCoordinatedRunOperatorAction).mockResolvedValueOnce(
      outcome({ kind: 'stop' }, coordinatedHostActiveViewFixture(), 'already_recorded')
    )
    await click('Ask host about this request')
    expect(vi.mocked(submitCoordinatedRunOperatorAction).mock.calls[1]?.slice(2)).toEqual([
      { kind: 'stop' },
      { replay: true }
    ])
    expect(container.textContent).toContain(
      'The host had already recorded this stop request; this request wrote nothing.'
    )
    expect(container.textContent).not.toContain('Its effect is unknown')
  })
  it('records nothing as unconfirmed when the request was refused before submission', async () => {
    vi.mocked(submitCoordinatedRunOperatorAction).mockRejectedValue(
      new Error('The run is already settled.')
    )
    await render()
    await click('Stop run')
    await click('Confirm Stop Run', document.body)
    await click('Refresh run')
    expect(container.textContent).not.toContain('Its effect is unknown')
  })
  it('stays read-only for a run that belongs to another Automation', async () => {
    props = { ...props, pinnedRun: { ...other, automationId: 'another-automation' } }
    await render()
    expect(inspectCoordinatedRun).not.toHaveBeenCalled()
    expect(container.textContent).toContain('belongs to a different Automation')
    expect(container.querySelector('[aria-label="Run controls"]')).toBeNull()
  })
})
