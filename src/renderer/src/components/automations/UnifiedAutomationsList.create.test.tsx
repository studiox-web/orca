// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  UnifiedAutomationsList,
  type UnifiedAutomationsListController
} from './UnifiedAutomationsList'

afterEach(cleanup)

describe('UnifiedAutomationsList create boundary', () => {
  it('reads Goal projects without calling execution, migration, or schedule mutations', async () => {
    const api = {
      getUnifiedAutomations: vi.fn().mockResolvedValue({
        generatedAt: '2026-11-08T00:00:00.000Z',
        revisions: {
          goals: 'goals',
          legacyCron: 'cron',
          nativeAutomations: 'native',
          runtimeBindings: 'bindings'
        },
        rows: [],
        warnings: []
      }),
      getBoard: vi.fn().mockResolvedValue({
        generatedAt: '2026-11-08T00:00:00.000Z',
        crontabHash: 'cron',
        projects: [],
        otherJobs: [],
        warnings: []
      }),
      runNow: vi.fn(),
      mutateCron: vi.fn(),
      mutateGoal: vi.fn(),
      setRunConfig: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { xosGoals: api }
    })
    const controller: UnifiedAutomationsListController = {
      list: {
        visibleRows: [],
        externalAutomationEntries: [],
        externalManagersUncheckedNotice: null,
        hostCatalog: { entries: [] },
        selectAutomationRow: vi.fn()
      },
      store: { repoForRow: vi.fn() },
      local: {
        selectExternalKey: vi.fn(),
        setActivePaneTab: vi.fn(),
        setIsDetailOpen: vi.fn()
      }
    }

    render(
      <TooltipProvider>
        <UnifiedAutomationsList
          controller={controller}
          onShowOrg={vi.fn()}
          onShowNative={vi.fn()}
          onOpenGoal={vi.fn()}
          onOpenNative={vi.fn()}
          editorsEnabled
          onCreateAutomation={vi.fn()}
          onCreateGoal={vi.fn()}
          onOpenGoalAdvanced={vi.fn()}
        />
      </TooltipProvider>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.getBoard).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog', { name: 'Create' })).toBeInTheDocument()
    expect(api.runNow).not.toHaveBeenCalled()
    expect(api.mutateCron).not.toHaveBeenCalled()
    expect(api.mutateGoal).not.toHaveBeenCalled()
    expect(api.setRunConfig).not.toHaveBeenCalled()
  })
})
