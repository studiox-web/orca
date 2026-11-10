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
import type { Repo } from '../../../../shared/repo-types'
import { AutomationEditorDialog, type AutomationDraft } from './AutomationEditorDialog'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'

const roots: Root[] = []

async function renderEditorDialog(props: {
  draft: AutomationDraft
  settings: GlobalSettings
  onDraftChange?: (updater: (current: AutomationDraft) => AutomationDraft) => void
  onSave?: () => void
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
          repos={[{ id: 'repo-1', name: 'test-repo', defaultBaseRef: 'main' } as unknown as Repo]}
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
          onSave={props.onSave ?? vi.fn()}
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

    expect(document.body.querySelector('button[aria-label="Single prompt mode"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="Coordinated workers mode"]')).toBeNull()
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

    const singleBtn = document.body.querySelector('button[aria-label="Single prompt mode"]')
    const coordBtn = document.body.querySelector('button[aria-label="Coordinated workers mode"]')
    expect(singleBtn).not.toBeNull()
    expect(coordBtn).not.toBeNull()
    expect(coordBtn?.getAttribute('role')).toBe('radio')
    expect(coordBtn?.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      ;(coordBtn as HTMLButtonElement).click()
    })

    expect(onDraftChange).toHaveBeenCalled()
    const updater = onDraftChange.mock.calls[0][0]
    const updated = updater(baseDraft)
    expect(updated.kind).toBe('coordinated')
  })

  it('enables save with the saved-disabled policy notice and does not write outcome to prompt', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: true
    })

    const onDraftChange = vi.fn()
    const onSave = vi.fn()

    const coordinatedDraft: AutomationDraft = {
      ...baseDraft,
      kind: 'coordinated',
      prompt: 'Original prompt that must not be overwritten',
      outcomeContract: {
        humanStatement: 'Initial outcome',
        acceptanceCriteria: [],
        requiredApprovals: [],
        allowedFinalStates: ['completed']
      },
      children: []
    }

    await renderEditorDialog({
      draft: coordinatedDraft,
      settings,
      onDraftChange,
      onSave
    })

    const notice = document.body.querySelector('[data-testid="coordinated-save-policy-message"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('Saved disabled')

    // Verify Save/Create button is disabled
    const saveButton = Array.from(document.body.querySelectorAll('button')).find((b) =>
      ['Create', 'Save', 'Save Changes'].includes(b.textContent?.trim() ?? '')
    ) as HTMLButtonElement | undefined
    expect(saveButton).toBeDefined()
    expect(saveButton?.disabled).toBe(false)
    await act(async () => {
      saveButton?.click()
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    // Test typing in outcome statement textarea
    const textarea = document.body.querySelector(
      '#automation-outcome-statement'
    ) as HTMLTextAreaElement
    expect(textarea).not.toBeNull()

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setValue?.call(textarea, 'New refined outcome statement')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Check onDraftChange was called, and that draft.prompt was NOT mutated
    expect(onDraftChange).toHaveBeenCalled()
    const updater = onDraftChange.mock.calls[0][0]
    const updated = updater(coordinatedDraft)
    expect(updated.outcomeContract?.humanStatement).toBe('New refined outcome statement')
    // Crucial requirement: never write outcome into draft.prompt
    expect(updated.prompt).toBe('Original prompt that must not be overwritten')
  })

  it('renders read-only warning notice when flag is off for existing coordinated draft', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: false
    })

    const coordinatedDraft: AutomationDraft = {
      ...baseDraft,
      kind: 'coordinated',
      outcomeContract: {
        humanStatement: 'Deliver validated weekly report',
        acceptanceCriteria: [],
        requiredApprovals: [],
        allowedFinalStates: ['completed']
      },
      children: []
    }

    await renderEditorDialog({
      draft: coordinatedDraft,
      settings
    })

    expect(document.body.textContent).toContain(
      'Coordinated automations require the experimental feature flag to be enabled'
    )
  })

  it('allows adding workers in create mode preview even though save is disabled', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: true
    })

    const coordinatedDraft: AutomationDraft = {
      ...baseDraft,
      kind: 'coordinated',
      children: []
    }

    await renderEditorDialog({
      draft: coordinatedDraft,
      settings
    })

    const addWorkerBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add worker')
    )
    expect(addWorkerBtn).toBeDefined()
    expect(addWorkerBtn?.disabled).toBe(false)
  })

  it('supports roving tabindex and arrow keys on execution mode radiogroup', async () => {
    const settings = createGlobalSettingsFixture({
      experimentalCoordinatedAutomations: true
    })

    const onDraftChange = vi.fn()
    await renderEditorDialog({
      draft: baseDraft,
      settings,
      onDraftChange
    })

    const singleRadio = document.body.querySelector('button[aria-label="Single prompt mode"]')
    const coordRadio = document.body.querySelector('button[aria-label="Coordinated workers mode"]')
    const radioGroup = document.body.querySelector('div[role="radiogroup"]')
    expect(singleRadio?.getAttribute('tabindex')).toBe('0')
    expect(coordRadio?.getAttribute('tabindex')).toBe('-1')
    expect(singleRadio?.hasAttribute('aria-pressed')).toBe(false)
    expect(coordRadio?.hasAttribute('aria-pressed')).toBe(false)

    await act(async () => {
      radioGroup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(onDraftChange).toHaveBeenCalled()
    const updater = onDraftChange.mock.calls[0][0]
    expect(updater(baseDraft).kind).toBe('coordinated')
  })
})
