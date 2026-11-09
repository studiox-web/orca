// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor-stub" />,
  loader: { config: vi.fn() }
}))
vi.mock('@/lib/monaco-setup', () => ({ monaco: {} }))

import { TooltipProvider } from '@/components/ui/tooltip'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { AutomationEditorDialog, type AutomationDraft } from './AutomationEditorDialog'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'

const roots: Root[] = []

async function renderEditorDialog(props: {
  draft: AutomationDraft
  settings: GlobalSettings
  onDraftChange?: (updater: (current: AutomationDraft) => AutomationDraft) => void
}): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TooltipProvider>
        <AutomationEditorDialog
          open={true}
          isEditing={false}
          isSaving={false}
          canSave={true}
          repos={[]}
          projectHostSetups={[]}
          automationYamlHooksByRepoKey={{}}
          getAutomationHooksCacheKey={() => ''}
          repoMap={new Map()}
          worktrees={[]}
          settings={props.settings}
          draft={props.draft}
          onProjectChange={vi.fn()}
          onOpenChange={vi.fn()}
          onDraftChange={props.onDraftChange ?? vi.fn()}
          onSetupDecisionTouched={vi.fn()}
          onApplyTemplate={vi.fn()}
          onSave={vi.fn()}
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

describe('AutomationEditorDialog coordinated automations', () => {
  const baseDraft: AutomationDraft = {
    name: 'New Automation',
    prompt: 'Summarize news daily',
    agentId: 'claude',
    extraAgentArgs: '',
    projectId: 'repo-1',
    workspaceMode: 'existing',
    workspaceId: 'ws-1',
    baseBranch: '',
    reuseSession: false,
    precheckCommand: '',
    precheckTimeoutSeconds: '60',
    preset: 'weekdays',
    time: '09:00',
    dayOfWeek: '1',
    customSchedule: '',
    savedSchedule: null,
    missedRunGraceMinutes: '720',
    scheduleWarning: null
  }

  it('preserves single automation editor UI when feature flag is off', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: false
    })

    await renderEditorDialog({
      draft: baseDraft,
      settings
    })

    // Header should NOT show the mode buttons
    expect(document.body.querySelector('button[aria-label="Single prompt mode"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="Coordinated workers mode"]')).toBeNull()
    // Workers section should NOT be present
    expect(document.body.querySelector('[data-testid="automation-workers-section"]')).toBeNull()
  })

  it('allows switching to coordinated workers mode when feature flag is on', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: true
    })

    const onDraftChange = vi.fn()
    await renderEditorDialog({
      draft: baseDraft,
      settings,
      onDraftChange
    })

    // Header shows the mode toggle buttons
    const singleBtn = document.body.querySelector('button[aria-label="Single prompt mode"]')
    const coordBtn = document.body.querySelector('button[aria-label="Coordinated workers mode"]')
    expect(singleBtn).not.toBeNull()
    expect(coordBtn).not.toBeNull()

    await act(async () => {
      ;(coordBtn as HTMLButtonElement).click()
    })

    expect(onDraftChange).toHaveBeenCalled()
    const updater = onDraftChange.mock.calls[0][0]
    const updated = updater(baseDraft)
    expect(updated.kind).toBe('coordinated')
  })

  it('renders workers section and outcome statement when draft is coordinated', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: true
    })

    const coordinatedDraft: AutomationDraft = {
      ...baseDraft,
      kind: 'coordinated',
      definitionRevision: 1,
      outcomeContract: {
        humanStatement: 'Deliver validated weekly report',
        acceptanceCriteria: [],
        requiredApprovals: [],
        allowedFinalStates: ['completed']
      },
      children: [
        {
          id: 'child-1',
          role: 'writer',
          name: 'Writer 1',
          promptSource: { kind: 'inline', text: 'Write content' },
          dependencies: [],
          mutationClass: 'exclusive_writer',
          enabled: true,
          launchConfig: {}
        }
      ]
    }

    await renderEditorDialog({
      draft: coordinatedDraft,
      settings
    })

    expect(document.body.querySelector('[data-testid="automation-workers-section"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Outcome statement')
    expect(document.body.textContent).toContain('Writer 1')
  })
})
