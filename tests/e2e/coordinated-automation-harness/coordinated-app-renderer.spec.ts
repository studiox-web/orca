import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { createRestartSession } from '../helpers/orca-restart'
import { getE2ECompletedOnboardingProfile } from '../helpers/e2e-completed-onboarding-profile'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { Automation, AutomationRun } from '../../../src/shared/automations-types'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../src/shared/automation-runtime-capabilities'

// Prepared for the accepted isolated entry; launching remains a separate supervised checkpoint.
test('renderer creates, edits, reopens and inspects a frozen no-effect run through the public API', async ({
  testRepoPath
}, testInfo) => {
  const session = createRestartSession(
    testInfo,
    {},
    { mainPath: resolve('out-coordinated/main/index.js') }
  )
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    join(session.userDataDir, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: { ...profile.settings, experimentalCoordinatedAutomations: true, theme: 'dark' }
    })
  )
  let app: ElectronApplication | undefined
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await page.setViewportSize({ width: 1280, height: 900 })
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    await expect
      .poll(async () =>
        (await client.call<RuntimeStatus>('status.get')).result.capabilities?.includes(FAKE)
      )
      .toBe(true)
    const repo = (
      await client.call<{ repo: { id: string; displayName: string } }>('repo.add', {
        path: testRepoPath,
        kind: 'folder'
      })
    ).result.repo
    await page.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('The isolated renderer store is unavailable')
      }
      await store.getState().fetchRepos({ runtimeEnvironmentId: null })
      await store.getState().fetchAllWorktrees()
      store.getState().openAutomationsPage()
    })
    await page.getByRole('button', { name: 'New Automation', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Create automation' })
    await editor.getByRole('radio', { name: 'Coordinated workers mode' }).click()
    await editor
      .getByLabel('Automation name', { exact: true })
      .fill('Renderer no-effect checkpoint')
    await editor.getByLabel('Outcome statement').fill('Verify an isolated renderer round trip')
    await editor.getByLabel('Coordinator brief').fill('Use only the injected no-effect worker')
    const project = editor.getByRole('combobox', { name: 'Select project', exact: true })
    if (await project.count()) {
      await project.click()
      await page.getByRole('button', { name: new RegExp(repo.displayName) }).click()
    }
    await editor.getByText('Worktree', { exact: true }).click()
    const workspace = editor.getByRole('combobox', { name: 'Select workspace', exact: true })
    if (await workspace.count()) {
      await workspace.click()
      await page.getByRole('option').first().click()
    }
    await editor.getByRole('button', { name: 'Add worker', exact: true }).click()
    const worker = page.getByRole('dialog', { name: 'Configure Worker' })
    await worker.getByLabel('Name', { exact: true }).fill('Fixture reader')
    await worker.getByLabel('Inline instructions').fill('Return the injected fixture report')
    await worker.getByRole('button', { name: 'Save worker', exact: true }).click()
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const definitions = async () =>
      (await client.call<{ automations: Automation[] }>('automation.list')).result.automations
    await expect
      .poll(
        async () =>
          (await definitions()).find((entry) => entry.name === 'Renderer no-effect checkpoint')
            ?.enabled
      )
      .toBe(false)
    await page.getByRole('button', { name: /^Renderer no-effect checkpoint/ }).click()
    await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit automation' })
    await edit.getByLabel('Coordinator brief').fill('Updated isolated brief')
    await edit.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(edit).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
    await expect(edit.getByLabel('Coordinator brief')).toHaveValue('Updated isolated brief')
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    const parent = (await definitions()).find(
      (entry) => entry.name === 'Renderer no-effect checkpoint'
    )!
    expect(parent.definitionRevision).toBe(2)
    expect(parent.enabled).toBe(false)
    const panel = page.getByRole('region', { name: 'Coordinated test runs' })
    await panel.getByRole('button', { name: 'Start no-effect test run', exact: true }).click()
    await expect(panel).toContainText('Semantic receipt: completed')
    const runs = (
      await client.call<{ runs: AutomationRun[] }>('automation.runs', {
        automationId: parent.id,
        expectedOwner: { selector: { kind: 'self' } }
      })
    ).result.runs
    expect(runs).toHaveLength(1)
    await expect(panel.getByLabel('Selected test run')).toHaveValue(runs[0].id)
    await expect(panel).toContainText('Frozen revision: 2')
    await expect(panel).toContainText('Worker session unavailable:')
    await panel.getByRole('button', { name: 'Refresh test runs', exact: true }).click()
    await expect(panel).toContainText('Semantic receipt: completed')
    await panel.getByRole('button', { name: 'Reconcile selected test run', exact: true }).click()
    await expect(panel).toContainText('Semantic receipt: completed')
    await page.getByRole('button', { name: 'Edit automation', exact: true }).click()
    await edit.getByLabel('Coordinator brief').fill('Future revision only')
    await edit.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(edit).toHaveCount(0)
    await expect(panel).toContainText('Frozen revision: 2')
    expect((await definitions()).find((entry) => entry.id === parent.id)?.enabled).toBe(false)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await session.dispose(app)
  }
})
