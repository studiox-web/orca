// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import { AutomationDetail } from './AutomationDetail'
import { makeAutomation } from './automations-page-fixtures'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'

const roots: Root[] = []

async function renderDetail(
  automation: Automation,
  runs: AutomationRun[] = []
): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <AutomationDetail
          automation={automation}
          runs={runs}
          projectName="test-project"
          workspaceName="main"
          projectDefaultBaseRef="main"
          runNowAvailability={{ canRunNow: true, reason: 'available', message: null }}
          now={Date.now()}
          onRunNow={vi.fn()}
          onEdit={vi.fn()}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>
    )
  })
  return container
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  document.body.innerHTML = ''
})

describe('AutomationDetail coordinated automations & flag preservation', () => {
  const sampleCoordinatedAutomation: Automation = makeAutomation({
    id: 'auto-coord-1',
    name: 'Content Pipeline',
    prompt: 'Publish top articles weekly',
    kind: 'coordinated',
    definitionRevision: 1,
    outcomeContract: {
      humanStatement: 'Produce and publish weekly articles',
      acceptanceCriteria: [],
      requiredApprovals: [],
      allowedFinalStates: ['completed']
    },
    children: [
      {
        id: 'child-1',
        role: 'researcher',
        name: 'Topic Researcher',
        promptSource: { kind: 'inline', text: 'Gather news' },
        dependencies: [],
        mutationClass: 'read_only',
        enabled: true,
        launchConfig: {}
      }
    ]
  })

  it('preserves single Automation UI when flag is off', async () => {
    useAppStore.setState({
      settings: createGlobalSettingsFixture({
        experimentalCoordinatedAutomations: false
      })
    })

    const singleAuto = makeAutomation({ name: 'Daily Sweep', kind: 'single' })
    const container = await renderDetail(singleAuto)

    // Prompt disclosure is rendered, workers section is NOT rendered
    expect(container.querySelector('[data-testid="automation-workers-section"]')).toBeNull()
    expect(container.textContent).toContain('Daily Sweep')
    expect(container.textContent).not.toContain('Coordinated (Rev')

    // Run Now button should not be disabled
    const runNowBtn = container.querySelector('button')
    expect(runNowBtn?.disabled).toBe(false)
  })

  it('shows Workers section and disables Run Now for coordinated automation', async () => {
    useAppStore.setState({
      settings: createGlobalSettingsFixture({
        experimentalCoordinatedAutomations: true
      })
    })

    const container = await renderDetail(sampleCoordinatedAutomation)

    // Workers section is rendered
    expect(container.querySelector('[data-testid="automation-workers-section"]')).not.toBeNull()
    expect(container.textContent).toContain('Content Pipeline')
    expect(container.textContent).toContain('Coordinated (Rev 1)')
    expect(container.textContent).toContain('Topic Researcher')

    // Run Now button must be disabled (no execution/dispatch in Phase 3)
    const buttons = Array.from(container.querySelectorAll('button'))
    const runNowBtn = buttons.find((b) => b.textContent?.includes('Run Now'))
    expect(runNowBtn?.disabled).toBe(true)
  })

  it('preserves single automation UI even if flag is on when viewing single automation', async () => {
    useAppStore.setState({
      settings: createGlobalSettingsFixture({
        experimentalCoordinatedAutomations: true
      })
    })

    const singleAuto = makeAutomation({ name: 'Single Job', kind: 'single' })
    const container = await renderDetail(singleAuto)

    // For a single automation, workers section is not rendered
    expect(container.querySelector('[data-testid="automation-workers-section"]')).toBeNull()
    expect(container.textContent).not.toContain('Coordinated (Rev')
  })
})
