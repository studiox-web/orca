// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UnifiedAutomationCreateDialog } from './UnifiedAutomationCreateDialog'

const projects = [
  { key: '/projects/alpha', name: 'Alpha' },
  { key: '/projects/beta', name: 'Beta' }
]

function renderDialog() {
  const callbacks = {
    onOpenChange: vi.fn(),
    onCreateAutomation: vi.fn(),
    onCreateGoal: vi.fn(),
    onOpenGoalAdvanced: vi.fn()
  }
  render(
    <TooltipProvider>
      <UnifiedAutomationCreateDialog
        open
        goalProjects={projects}
        goalProjectsLoading={false}
        goalProjectsError={null}
        {...callbacks}
      />
    </TooltipProvider>
  )
  return callbacks
}

afterEach(cleanup)

describe('UnifiedAutomationCreateDialog', () => {
  it('has an accessible keyboard type chooser and delegates native creation unchanged', async () => {
    const callbacks = renderDialog()
    const user = userEvent.setup()
    const chooser = screen.getByRole('radiogroup', { name: 'Creation type' })
    const automation = screen.getByRole('radio', { name: 'Agent automation' })
    const goal = screen.getByRole('radio', { name: 'Goal' })

    expect(chooser).toBeInTheDocument()
    expect(automation).toBeChecked()
    await waitFor(() => expect(automation).toHaveFocus())
    goal.focus()
    await user.keyboard(' ')
    expect(goal).toBeChecked()
    automation.focus()
    await user.keyboard(' ')
    expect(automation).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'New Automation' }))

    expect(callbacks.onCreateAutomation).toHaveBeenCalledOnce()
    expect(callbacks.onCreateGoal).not.toHaveBeenCalled()
  })

  it('requires a clear project choice and exposes the existing Advanced Goal route', async () => {
    const callbacks = renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: 'Goal' }))
    const continueButton = screen.getByRole('button', { name: 'Continue to Goal details' })
    expect(continueButton).toBeDisabled()
    await user.click(screen.getByRole('combobox', { name: 'Project' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(continueButton).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Advanced Goal options' }))
    expect(
      screen.getByText(/file, scheduling, pause\/resume, archive, and run management controls/)
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Goal workspace' }))
    expect(callbacks.onOpenGoalAdvanced).toHaveBeenCalledExactlyOnceWith('/projects/beta')

    await user.click(continueButton)
    expect(callbacks.onCreateGoal).toHaveBeenCalledExactlyOnceWith('/projects/beta')
  })

  it('keeps Script and External disabled without invoking execution or migration callbacks', () => {
    const callbacks = renderDialog()

    expect(screen.getByRole('radio', { name: 'Script' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'External automation' })).toBeDisabled()
    expect(
      screen.getByText(
        'Unavailable until validation, cancellation, timeout, and artifact contracts exist.'
      )
    ).toBeVisible()
    expect(screen.getByText('Scripts are visible for review only.')).toBeVisible()
    expect(callbacks.onCreateAutomation).not.toHaveBeenCalled()
    expect(callbacks.onCreateGoal).not.toHaveBeenCalled()
    expect(callbacks.onOpenGoalAdvanced).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const callbacks = renderDialog()
    await userEvent.keyboard('{Escape}')
    expect(callbacks.onOpenChange).toHaveBeenCalledWith(false)
  })
})
