// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { XosProject } from '../../../../shared/xos-goals-types'
import type { XosGoalActions } from './XosGoalViewerParts'
import { XosNewGoalDialog } from './XosNewGoalDialog'

const project: XosProject = {
  key: '/projects/orca',
  name: 'Orca',
  root: '/projects/orca',
  goalsDir: '/projects/orca/automations/goals',
  worktreeSelector: null,
  orgSource: 'default',
  areas: [{ id: 'product', title: 'Product', description: '', manager: '' }],
  goals: [],
  archived: [],
  scripts: []
}

function renderDialog({
  goalOp = vi.fn().mockResolvedValue(true),
  currentProject = project
}: {
  goalOp?: ReturnType<typeof vi.fn>
  currentProject?: XosProject
} = {}) {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(
    <TooltipProvider>
      <XosNewGoalDialog
        open
        project={currentProject}
        actions={{ goalOp } as unknown as XosGoalActions}
        onClose={onClose}
        onCreated={onCreated}
      />
    </TooltipProvider>
  )
  return { goalOp, onClose, onCreated }
}

afterEach(cleanup)

describe('XosNewGoalDialog agent selector', () => {
  it('renders native provider labels and icons without blank or unsupported choices', async () => {
    renderDialog()

    const trigger = screen.getByRole('combobox', { name: 'Agent' })
    expect(trigger).toHaveTextContent('Codex')
    expect(trigger.querySelector('svg, img')).not.toBeNull()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    for (const label of ['Codex', 'Claude', 'Gemini']) {
      const option = screen.getByRole('option', { name: label })
      expect(option.querySelector('svg, img')).not.toBeNull()
    }
    expect(screen.queryByRole('option', { name: 'Blank Terminal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'OpenCode' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText('Search agents...')).toHaveFocus())
  })

  it('selects an agent while preserving validation and the create mutation payload', async () => {
    const { goalOp, onClose, onCreated } = renderDialog()
    const user = userEvent.setup()
    const create = screen.getByRole('button', { name: 'Create goal' })

    expect(create).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Festival Curator'), ' Festival Curator ')
    const folderName = screen.getByRole('textbox', { name: 'Folder name' })
    await user.clear(folderName)
    await user.type(folderName, 'bad_name')
    expect(create).toBeDisabled()
    expect(screen.getByText('Use lowercase letters, digits and dashes.')).toBeInTheDocument()

    await user.clear(folderName)
    await user.type(folderName, 'festival-curator')
    await user.click(screen.getByRole('combobox', { name: 'Agent' }))
    await user.click(screen.getByRole('option', { name: 'Claude' }))
    expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveTextContent('Claude')

    await user.click(screen.getByRole('combobox', { name: 'Business area' }))
    await user.click(screen.getByRole('option', { name: 'Product' }))
    await user.click(create)

    expect(goalOp).toHaveBeenCalledExactlyOnceWith({
      kind: 'create',
      projectKey: '/projects/orca',
      goal: 'festival-curator',
      title: 'Festival Curator',
      agent: 'claude',
      areaId: 'product'
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith('festival-curator'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps existing and archived folder names invalid', async () => {
    const goalOp = vi.fn().mockResolvedValue(true)
    renderDialog({
      goalOp,
      currentProject: {
        ...project,
        archived: [
          {
            goal: 'festival-curator',
            title: 'Festival Curator',
            path: '/archive',
            archivedAt: null
          }
        ]
      }
    })

    await userEvent.type(screen.getByPlaceholderText('Festival Curator'), 'Festival Curator')

    expect(
      screen.getByText('A goal with this name already exists (or is archived).')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create goal' })).toBeDisabled()
    expect(goalOp).not.toHaveBeenCalled()
  })
})
