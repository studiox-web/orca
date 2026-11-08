// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'

const mocks = vi.hoisted(() => ({
  openAutomationsPage: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openAutomationsPage: mocks.openAutomationsPage })
}))

import { AutomationsSettingsPane } from './AutomationsSettingsPane'

describe('AutomationsSettingsPane', () => {
  beforeEach(() => {
    mocks.openAutomationsPage.mockReset()
  })

  afterEach(cleanup)

  it('controls sidebar visibility and opens Automations', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn()
    render(
      <AutomationsSettingsPane
        settings={{ ...getDefaultSettings('/tmp'), showAutomationsButton: false }}
        updateSettings={updateSettings}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Show Automations Button' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(updateSettings).toHaveBeenCalledWith({ showAutomationsButton: true })

    const unifiedToggle = screen.getByRole('switch', { name: 'Unified Goals list' })
    expect(unifiedToggle).toHaveAttribute('aria-checked', 'false')
    await user.click(unifiedToggle)
    expect(updateSettings).toHaveBeenCalledWith({ unifiedAutomationSurface: true })

    const editorToggle = screen.getByRole('switch', { name: 'Unified create chooser' })
    expect(editorToggle).toHaveAttribute('aria-checked', 'false')
    await user.click(editorToggle)
    expect(updateSettings).toHaveBeenCalledWith({ unifiedAutomationEditors: true })

    const enabledSettings = {
      ...getDefaultSettings('/tmp'),
      unifiedAutomationEditors: true
    }
    cleanup()
    render(<AutomationsSettingsPane settings={enabledSettings} updateSettings={updateSettings} />)
    await user.click(screen.getByRole('switch', { name: 'Unified create chooser' }))
    expect(updateSettings).toHaveBeenCalledWith({ unifiedAutomationEditors: false })

    const openButton = screen.getByRole('button', { name: /Open Automations/ })
    expect(openButton).toBeEnabled()
    await user.click(openButton)
    expect(mocks.openAutomationsPage).toHaveBeenCalledOnce()
  })
})
