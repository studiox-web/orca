// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import * as openAgentMessageSender from '@/lib/open-agent-message-sender'
import {
  sampleCompletedVerifiedRun,
  sampleRemoteFolderHistoricalRun
} from './AutomationCoordinatedRunPanel.fixture'
import {
  AutomationCoordinatedRunPanel,
  type AutomationCoordinatedRunPanelProps
} from './AutomationCoordinatedRunPanel'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import {
  sampleActiveRunObservation,
  sampleBlockedUncertainObservation
} from './coordinated-automation-run-fixture-scenarios'

const roots: Root[] = []

async function renderPanel(props: AutomationCoordinatedRunPanelProps): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <AutomationCoordinatedRunPanel
          isFeatureFlagEnabled
          runtimeTarget={{ kind: 'local' }}
          {...props}
        />
      </TooltipProvider>
    )
  })
  return container
}

function clickElement(el: Element | null): void {
  if (el instanceof HTMLElement) {
    el.click()
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('AutomationCoordinatedRunPanel', () => {
  it('renders parent run state separation, hazard callouts, limits, and stage evidence without opening raw logs', async () => {
    const container = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation,
      hostLabel: 'Local Orca Host',
      workspaceLabel: 'djvibe/article-pilot'
    })

    // Semantic vs Technical separation on parent run
    expect(
      container.querySelector('[data-testid="coordinated-run-semantic-outcome-badge"]')?.textContent
    ).toContain('Waiting for approval')
    expect(
      container.querySelector('[data-testid="coordinated-run-technical-status-badge"]')?.textContent
    ).toContain('Technical: dispatched')

    // Pending question and occupied mutation lane visible directly on panel
    expect(container.textContent).toContain(
      'Should we include the latency percentile chart from section 3 in the lead?'
    )
    expect(container.textContent).toContain('article-draft (held by Article Writer)')

    // Stage technical vs semantic acceptance separation on reviewer stage
    expect(
      container.querySelector('[data-testid="stage-technical-status-child-reviewer"]')?.textContent
    ).toContain('Technical: completed')
    expect(
      container.querySelector('[data-testid="stage-semantic-acceptance-child-reviewer"]')
        ?.textContent
    ).toContain('Acceptance: evaluating')

    // Rename & Tombstone drift badges
    expect(
      container.querySelector('[data-testid="stage-drift-badge-child-researcher"]')?.textContent
    ).toContain('Renamed in current definition: News & Signal Scout')
    expect(
      container.querySelector('[data-testid="stage-drift-badge-child-publisher"]')?.textContent
    ).toContain('Removed in Rev 3 — preserved in snapshot')
  })

  it('distinguishes View definition from Open worker (chat, terminal, dispatch) via openOrchestrationCrewAgent', async () => {
    const openSpy = vi
      .spyOn(openAgentMessageSender, 'openOrchestrationCrewAgent')
      .mockResolvedValue(undefined)
    const onInspectChildDefinition = vi.fn()

    const container = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation,
      onInspectChildDefinition
    })

    // 1. Clicking View definition for configured child calls onInspectChildDefinition
    const viewDefBtn = container.querySelector(
      'button[aria-label="View definition for Topic Researcher"]'
    )
    await act(async () => {
      clickElement(viewDefBtn)
    })
    expect(onInspectChildDefinition).toHaveBeenCalledWith('child-researcher')
    expect(openSpy).not.toHaveBeenCalled()

    // 2. Clicking Open worker on chat stage opens exact chat session
    const openResearcherBtn = container.querySelector(
      '[data-testid="open-stage-worker-child-researcher"]'
    )
    await act(async () => {
      clickElement(openResearcherBtn)
    })
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0]?.[0].openTarget).toEqual({
      kind: 'chat',
      sessionId: 'chat_session_res_1',
      worktreeId: 'wt-article-pilot'
    })

    // 3. Clicking Open worker on terminal stage opens exact terminal handle
    const openWriterBtn = container.querySelector('[data-testid="open-stage-worker-child-writer"]')
    await act(async () => {
      clickElement(openWriterBtn)
    })
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy.mock.calls[1]?.[0].openTarget).toEqual({
      kind: 'terminal',
      handle: 'term_writer_2'
    })

    // 4. Clicking historical superseded attempt #1 opens its exact attempt terminal target
    const openSupersededBtn = container.querySelector('[data-testid="open-attempt-ctx_writer_1"]')
    await act(async () => {
      clickElement(openSupersededBtn)
    })
    expect(openSpy).toHaveBeenCalledTimes(3)
    expect(openSpy.mock.calls[2]?.[0].openTarget).toEqual({
      kind: 'terminal',
      handle: 'term_writer_1'
    })

    // 5. Clicking Open worker on dispatch stage opens exact dispatch address
    const openReviewerBtn = container.querySelector(
      '[data-testid="open-stage-worker-child-reviewer"]'
    )
    await act(async () => {
      clickElement(openReviewerBtn)
    })
    expect(openSpy).toHaveBeenCalledTimes(4)
    expect(openSpy.mock.calls[3]?.[0].openTarget).toEqual({
      kind: 'dispatch',
      address: 'dispatch:task_rev_3:ctx_rev_1'
    })
  })

  it('selects graph stages with native buttons and switches to Receipt and Frozen Snapshot views', async () => {
    const container = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleCompletedVerifiedRun,
      observation: sampleActiveRunObservation
    })

    // Switch to Run Graph view
    const graphBtn = container.querySelector('button[aria-label="Run stages graph view"]')
    await act(async () => {
      clickElement(graphBtn)
    })
    expect(container.querySelector('[data-testid="coordinated-run-stages-graph"]')).not.toBeNull()

    const writerNode = container.querySelector(
      'button[aria-label="Select stage Article Writer (child-writer)"]'
    )
    expect(writerNode).not.toBeNull()
    await act(async () => {
      clickElement(writerNode)
    })
    expect(writerNode?.getAttribute('aria-pressed')).toBe('true')

    // Switch to Receipt view
    const receiptBtn = container.querySelector('button[aria-label="Run completion receipt view"]')
    await act(async () => {
      clickElement(receiptBtn)
    })
    expect(container.querySelector('[data-testid="completion-receipt-inspector"]')).not.toBeNull()
    expect(container.textContent).toContain('Ready to publish')
    expect(container.textContent).toContain('cms_draft_id:99412')

    // Switch to Frozen Snapshot view
    const snapshotBtn = container.querySelector('button[aria-label="Run frozen snapshot view"]')
    await act(async () => {
      clickElement(snapshotBtn)
    })
    expect(
      container.querySelector('[data-testid="automation-historical-snapshot-viewer"]')
    ).not.toBeNull()
  })

  it('stages operator controls with impact preview and explicit unavailable reasons or bound callbacks', async () => {
    const onStopRun = vi.fn()
    const onResolveGate = vi.fn()

    // 1. Without operatorActions bound, clicking Stop run shows impact preview + unavailable reason
    const unboundContainer = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation
    })

    const stopBtn = unboundContainer.querySelector('[data-testid="stop-coordinated-run-btn"]')
    await act(async () => {
      clickElement(stopBtn)
    })
    expect(
      document.body.querySelector('[data-testid="run-control-unavailable-reason"]')?.textContent
    ).toContain('Host stop-run operation binding is not yet connected')
    const confirmUnboundBtn = document.body.querySelector(
      '[data-testid="confirm-run-control-action"]'
    )
    expect(confirmUnboundBtn?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    document.body.innerHTML = ''

    // 2. With operatorActions bound, confirming Resolve gate sends exact run, task, dispatch, and authority
    const boundContainer = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation,
      operatorActions: {
        stopRun: { availability: { supported: true, reason: null }, onStopRun },
        resolveGate: { availability: { supported: true, reason: null }, onResolveGate }
      }
    })

    const resolveGateBtn = boundContainer.querySelector(
      '[data-testid="resolve-gate-btn-child-reviewer"]'
    )
    await act(async () => {
      clickElement(resolveGateBtn)
    })

    const confirmBoundBtn = document.body.querySelector(
      '[data-testid="confirm-run-control-action"]'
    )
    expect(confirmBoundBtn?.hasAttribute('disabled')).toBe(false)
    await act(async () => {
      clickElement(confirmBoundBtn)
    })

    expect(onResolveGate).toHaveBeenCalledWith({
      automationId: 'auto-article-coord',
      automationRunId: 'run-coord-active-101',
      orchestrationRunId: 'orch_run_live_101',
      childDefinitionId: 'child-reviewer',
      taskId: 'task_rev_3',
      dispatchId: 'ctx_rev_1',
      gateId: 'gate-editorial-signoff',
      decision: 'approve',
      note: undefined,
      targetExecutionAuthority: 'local:local-host'
    })
  })

  it('surfaces uncertain external effects, blockers, remote authority, and folder workspace clearly', async () => {
    const uncertainContainer = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleBlockedUncertainObservation
    })

    expect(
      uncertainContainer.querySelector('[data-testid="stage-uncertain-effect-child-publisher"]')
    ).not.toBeNull()
    expect(uncertainContainer.textContent).toContain('CMS_EFFECT_UNCERTAIN')

    const remoteFolderContainer = await renderPanel({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleRemoteFolderHistoricalRun,
      hostLabel: 'SSH: prod-editorial',
      workspaceLabel: '/srv/editorial/weekly-digest',
      isFolderWorkspace: true
    })

    expect(remoteFolderContainer.textContent).toContain('ssh:prod-editorial')
    expect(remoteFolderContainer.textContent).toContain('[Remote]')
    expect(remoteFolderContainer.textContent).toContain('(Folder workspace)')
    expect(remoteFolderContainer.textContent).toContain('Unaccepted technical completion')
  })
})
