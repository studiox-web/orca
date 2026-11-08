// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  settings: {
    unifiedAutomationSurface: true,
    unifiedAutomationEditors: false
  },
  openCreateDialog: vi.fn(),
  orgProps: null as null | Record<string, unknown>
}))

vi.mock('./use-automations-page-controller', () => ({
  useAutomationsPageController: () => ({
    store: { settings: harness.settings },
    editorActions: { openCreateDialog: harness.openCreateDialog }
  })
}))

vi.mock('./AutomationsPageSurface', () => ({
  AutomationsPageSurface: () => <div data-testid="native-surface">Native surface</div>
}))

vi.mock('./UnifiedAutomationsList', () => ({
  UnifiedAutomationsList: (props: {
    editorsEnabled: boolean
    onCreateAutomation: () => void
    onCreateGoal: (projectKey: string) => void
  }) => (
    <div data-testid="unified-surface">
      {props.editorsEnabled ? (
        <>
          <button type="button" onClick={props.onCreateAutomation}>
            Delegate native
          </button>
          <button type="button" onClick={() => props.onCreateGoal('/projects/alpha')}>
            Delegate Goal
          </button>
        </>
      ) : null}
    </div>
  )
}))

vi.mock('../xos-goals/XosOrgChartPage', () => ({
  XosOrgChartPage: (props: Record<string, unknown>) => {
    harness.orgProps = props
    return <div data-testid="org-surface">Org surface</div>
  }
}))

import AutomationsPage, { XOS_VIEW_KEY } from './AutomationsPage'

beforeEach(() => {
  harness.settings.unifiedAutomationSurface = true
  harness.settings.unifiedAutomationEditors = false
  harness.openCreateDialog.mockReset()
  harness.orgProps = null
  window.localStorage.setItem(XOS_VIEW_KEY, 'goals')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { xosGoals: {} }
  })
})

afterEach(cleanup)

describe('AutomationsPage unified create delegation', () => {
  it('reversibly gates the create entry independently from the unified list', () => {
    const view = render(<AutomationsPage />)
    expect(screen.getByTestId('unified-surface')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delegate native' })).not.toBeInTheDocument()

    harness.settings.unifiedAutomationEditors = true
    view.rerender(<AutomationsPage />)
    expect(screen.getByRole('button', { name: 'Delegate native' })).toBeInTheDocument()

    harness.settings.unifiedAutomationEditors = false
    view.rerender(<AutomationsPage />)
    expect(screen.queryByRole('button', { name: 'Delegate native' })).not.toBeInTheDocument()
    expect(screen.getByTestId('unified-surface')).toBeInTheDocument()
  })

  it('opens the unchanged native create path before showing its surface', async () => {
    harness.settings.unifiedAutomationEditors = true
    render(<AutomationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Delegate native' }))

    expect(harness.openCreateDialog).toHaveBeenCalledOnce()
    expect(screen.getByTestId('native-surface')).toBeInTheDocument()
  })

  it('routes a selected local project to the existing Goal create flow', async () => {
    harness.settings.unifiedAutomationEditors = true
    render(<AutomationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Delegate Goal' }))

    expect(screen.getByTestId('org-surface')).toBeInTheDocument()
    expect(harness.orgProps?.initialTarget).toEqual({
      projectKey: '/projects/alpha',
      goal: null,
      create: true
    })
    expect(harness.openCreateDialog).not.toHaveBeenCalled()
  })
})
