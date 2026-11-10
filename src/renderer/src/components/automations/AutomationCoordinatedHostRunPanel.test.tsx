// @vitest-environment happy-dom
import { act } from 'react'
import type * as CoordinatedRunApiClient from './coordinated-run-api-client'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationCoordinatedHostRunPanel } from './AutomationCoordinatedHostRunPanel'
import { sampleCompletedVerifiedRun } from './AutomationCoordinatedRunPanel.fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'
import {
  coordinatedHostFixtureEntry,
  coordinatedHostViewFixture
} from './coordinated-host-run-view-fixture'
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
async function click(label: string) {
  await act(async () => {
    ;[...container.querySelectorAll('button')]
      .find((button) => button.textContent === label)
      ?.click()
  })
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
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Stop')
    ).toBe(false)
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
