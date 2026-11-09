// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AutomationWorkersSection } from './AutomationWorkersSection'
import type {
  CoordinatedAutomationChildDefinition,
  ResolvedAutomationRunSnapshot
} from '../../../../shared/coordinated-automation-types'

const roots: Root[] = []

function renderWorkersSection(
  props: React.ComponentProps<typeof AutomationWorkersSection>
): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <TooltipProvider>
        <AutomationWorkersSection {...props} />
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

describe('AutomationWorkersSection', () => {
  const baseChild1: CoordinatedAutomationChildDefinition = {
    id: 'worker-1',
    role: 'researcher',
    name: 'Researcher Alpha',
    description: 'Finds sources',
    promptSource: { kind: 'inline', text: 'Analyze research trends.' },
    dependencies: [],
    mutationClass: 'read_only',
    enabled: true,
    launchConfig: {
      agentId: 'claude',
      model: 'claude-3-5-sonnet',
      provenance: {
        agentId: 'inherited',
        model: 'overridden'
      }
    }
  }

  const baseChild2: CoordinatedAutomationChildDefinition = {
    id: 'worker-2',
    role: 'writer',
    name: 'Writer Beta',
    description: 'Writes drafts',
    promptSource: {
      kind: 'source_reference',
      path: 'docs/goals/writer.md',
      digest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    },
    dependencies: [{ childId: 'worker-1', condition: 'accepted' }],
    mutationClass: 'exclusive_writer',
    enabled: true,
    launchConfig: {
      agentId: 'claude',
      provenance: {
        agentId: 'inherited',
        model: 'inherited'
      }
    }
  }

  it('renders configured workers with role, prompt, and provenance', () => {
    const container = renderWorkersSection({
      workers: [baseChild1, baseChild2],
      isEditing: false
    })

    expect(container.textContent).toContain('Researcher Alpha')
    expect(container.textContent).toContain('researcher')
    expect(container.textContent).toContain('Writer Beta')
    expect(container.textContent).toContain('writer')
    expect(container.textContent).toContain('Analyze research trends.')
    expect(container.textContent).toContain('docs/goals/writer.md')
    expect(container.textContent).toContain('Overridden')
    expect(container.textContent).toContain('Inherited')
  })

  it('adds a worker when clicking Add worker in edit mode', () => {
    const onWorkersChange = vi.fn()
    const container = renderWorkersSection({
      workers: [baseChild1],
      isEditing: true,
      onWorkersChange
    })

    const addButton = container.querySelector(
      'button[aria-label="Add worker"]'
    ) as HTMLButtonElement
    expect(addButton).not.toBeNull()

    act(() => {
      addButton.click()
    })

    expect(onWorkersChange).toHaveBeenCalledTimes(1)
    const newChildren = onWorkersChange.mock.calls[0][0]
    expect(newChildren).toHaveLength(2)
    expect(newChildren[1].id).toBeDefined()
  })

  it('reorders workers up and down in edit mode', () => {
    const onWorkersChange = vi.fn()
    const container = renderWorkersSection({
      workers: [baseChild1, baseChild2],
      isEditing: true,
      onWorkersChange
    })

    const moveDownBtn = container.querySelector(
      'button[aria-label="Move worker down"]'
    ) as HTMLButtonElement
    expect(moveDownBtn).not.toBeNull()

    act(() => {
      moveDownBtn.click()
    })

    expect(onWorkersChange).toHaveBeenCalledTimes(1)
    const reordered = onWorkersChange.mock.calls[0][0]
    expect(reordered[0].id).toBe('worker-2')
    expect(reordered[1].id).toBe('worker-1')
  })

  it('disables and enables a worker', () => {
    const onWorkersChange = vi.fn()
    const container = renderWorkersSection({
      workers: [baseChild1],
      isEditing: true,
      onWorkersChange
    })

    const disableBtn = container.querySelector(
      'button[aria-label="Disable worker"]'
    ) as HTMLButtonElement
    expect(disableBtn).not.toBeNull()

    act(() => {
      disableBtn.click()
    })

    expect(onWorkersChange).toHaveBeenCalledTimes(1)
    expect(onWorkersChange.mock.calls[0][0][0].enabled).toBe(false)
  })

  it('removes a worker and cleans up dependent references', () => {
    const onWorkersChange = vi.fn()
    const container = renderWorkersSection({
      workers: [baseChild1, baseChild2],
      isEditing: true,
      onWorkersChange
    })

    const removeBtn = container.querySelector(
      'button[aria-label="Remove worker Researcher Alpha"]'
    ) as HTMLButtonElement
    expect(removeBtn).not.toBeNull()

    act(() => {
      removeBtn.click()
    })

    expect(onWorkersChange).toHaveBeenCalledTimes(1)
    const remaining = onWorkersChange.mock.calls[0][0]
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('worker-2')
    // Dependency on worker-1 should be removed
    expect(remaining[0].dependencies).toEqual([])
  })

  it('resets overridden launch config field to inherited', () => {
    const onWorkersChange = vi.fn()
    const container = renderWorkersSection({
      workers: [baseChild1],
      isEditing: true,
      onWorkersChange
    })

    const overrideBadge = container.querySelector('[data-testid="worker-card-worker-1"]')
    expect(overrideBadge?.textContent).toContain('Overridden')
  })

  it('handles duplicate names with distinct stable IDs', () => {
    const duplicateChild: CoordinatedAutomationChildDefinition = {
      ...baseChild1,
      id: 'worker-duplicate-id',
      name: 'Researcher Alpha' // Same display name, different ID
    }

    const container = renderWorkersSection({
      workers: [baseChild1, duplicateChild],
      isEditing: false
    })

    const card1 = container.querySelector('[data-testid="worker-card-worker-1"]')
    const card2 = container.querySelector('[data-testid="worker-card-worker-duplicate-id"]')
    expect(card1).not.toBeNull()
    expect(card2).not.toBeNull()
    expect(card1?.textContent).toContain('(worker-1)')
    expect(card2?.textContent).toContain('(worker-duplicate-id)')
  })

  it('displays long prompts and long model names without crashing or overflowing', () => {
    const longPromptChild: CoordinatedAutomationChildDefinition = {
      ...baseChild1,
      id: 'worker-long',
      promptSource: {
        kind: 'inline',
        text: 'A'.repeat(5000)
      },
      launchConfig: {
        agentId: 'claude',
        model: 'super-long-custom-fine-tuned-model-id-v2-preview-evaluation-20261109-experimental',
        provenance: { model: 'overridden' }
      }
    }

    const container = renderWorkersSection({
      workers: [longPromptChild],
      isEditing: false
    })

    expect(container.textContent).toContain('super-long-custom-fine-tuned-model-id')
  })

  it('displays validation errors and allows jumping to the offending worker', () => {
    const invalidChildren: CoordinatedAutomationChildDefinition[] = [
      {
        ...baseChild1,
        id: 'child-a',
        dependencies: [{ childId: 'child-b' }]
      },
      {
        ...baseChild2,
        id: 'child-b',
        dependencies: [{ childId: 'child-a' }]
      }
    ]

    const container = renderWorkersSection({
      workers: invalidChildren,
      isEditing: true
    })

    const validationAlert = container.querySelector(
      '[data-testid="automation-workers-validation-summary"]'
    )
    expect(validationAlert).not.toBeNull()
    expect(validationAlert?.textContent).toContain('Dependency Cycle')
  })

  it('switches between list and graph views', () => {
    const container = renderWorkersSection({
      workers: [baseChild1, baseChild2],
      isEditing: false
    })

    expect(container.querySelector('[data-testid="automation-workers-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="automation-workers-graph"]')).toBeNull()

    const graphBtn = container.querySelector('button[aria-label="Graph view"]') as HTMLButtonElement
    act(() => {
      graphBtn.click()
    })

    expect(container.querySelector('[data-testid="automation-workers-graph"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="automation-workers-list"]')).toBeNull()
  })

  it('renders read-only historical snapshots with canonical digest and copy action', async () => {
    const snapshot: ResolvedAutomationRunSnapshot = {
      automationId: 'auto-hist',
      definitionRevision: 1,
      createdAt: 1700000000000,
      canonicalDigest: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      outcomeContract: {
        humanStatement: 'Deliver validated weekly report',
        acceptanceCriteria: [],
        requiredApprovals: [],
        allowedFinalStates: ['completed']
      },
      executionTarget: { type: 'local', id: 'local' },
      inheritedDefaults: {
        agentId: 'claude',
        model: null,
        reasoningEffort: null,
        surface: 'terminal',
        extraAgentArgs: '',
        reuseSession: false,
        workspaceMode: 'existing',
        workspaceId: 'ws',
        baseBranch: 'main',
        setupDecision: 'inherit',
        timeoutSeconds: 1800,
        maxRetries: 3,
        maxReviewIterations: 2
      },
      globalCeilings: {},
      publicationPolicy: {
        allowExternalMutation: false,
        requireHumanDecisionForProduction: true,
        allowedFinalStates: ['completed']
      },
      retentionPolicy: { preserveCompletionReceipt: true },
      resolvedChildren: [
        {
          childDefinitionId: 'child-1',
          role: 'researcher',
          name: 'Snapshot Researcher',
          prompt: {
            kind: 'inline',
            text: 'Historical prompt text',
            digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
          },
          launchConfig: {
            agentId: 'claude',
            model: 'claude-3-5-sonnet',
            reasoningEffort: null,
            surface: 'terminal',
            extraAgentArgs: '',
            reuseSession: false,
            workspaceMode: 'existing',
            workspaceId: 'ws',
            baseBranch: 'main',
            setupDecision: 'inherit',
            timeoutSeconds: 1800,
            maxRetries: 3,
            maxReviewIterations: 2
          },
          provenance: {
            agentId: 'inherited',
            model: 'overridden',
            reasoningEffort: 'inherited',
            surface: 'inherited',
            extraAgentArgs: 'inherited',
            reuseSession: 'inherited',
            workspaceMode: 'inherited',
            workspaceId: 'inherited',
            baseBranch: 'inherited',
            setupDecision: 'inherited',
            timeoutSeconds: 'inherited',
            maxRetries: 'inherited',
            maxReviewIterations: 'inherited'
          },
          dependencies: [],
          mutationClass: 'read_only',
          enabled: true
        }
      ]
    }

    const container = renderWorkersSection({
      workers: [baseChild1],
      historicalSnapshot: snapshot,
      isEditing: false
    })

    const snapshotViewer = container.querySelector(
      '[data-testid="automation-historical-snapshot-viewer"]'
    )
    expect(snapshotViewer).not.toBeNull()
    expect(snapshotViewer?.textContent).toContain('Frozen run snapshot (Revision 1)')
    expect(snapshotViewer?.textContent).toContain('Read-only')
    expect(snapshotViewer?.textContent).toContain('Deliver validated weekly report')
    expect(snapshotViewer?.textContent).toContain('Snapshot Researcher')
    expect(snapshotViewer?.textContent).toContain(snapshot.canonicalDigest)

    // Verify copy button exists with accessible name
    const copyBtn = container.querySelector(
      'button[aria-label="Copy canonical digest"]'
    ) as HTMLButtonElement
    expect(copyBtn).not.toBeNull()

    // Verify NO execution / dispatch / run now buttons are rendered
    expect(container.querySelector('button[aria-label*="Run"]')).toBeNull()
    expect(container.querySelector('button[aria-label*="Dispatch"]')).toBeNull()
  })

  it('renders future-revision impact preview distinguishing active run from draft', () => {
    const container = renderWorkersSection({
      workers: [baseChild1],
      definitionRevision: 2,
      hasModifications: true,
      activeRunId: 'run-active-1234',
      activeRunRevision: 1,
      isEditing: false
    })

    const preview = container.querySelector('[data-testid="automation-revision-impact-preview"]')
    expect(preview).not.toBeNull()
    expect(preview?.textContent).toContain('Rev 2')
    expect(preview?.textContent).toContain('Next: Rev 3')
    expect(preview?.textContent).toContain('run-active-1234')
    expect(preview?.textContent).toContain('Frozen')
  })
})
