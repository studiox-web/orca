import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { createRestartSession } from '../helpers/orca-restart'
import { getE2ECompletedOnboardingProfile } from '../helpers/e2e-completed-onboarding-profile'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../src/shared/automation-runtime-capabilities'
import type {
  CoordinatedFakeRunStartResponse,
  CoordinatedRunView
} from '../../../src/shared/coordinated-automation-run-view'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'

test('isolated desktop exposes real fake-run RPCs and retains exact run evidence after restart', async ({
  testRepoPath
}, testInfo) => {
  const session = createRestartSession(
    testInfo,
    {},
    { mainPath: resolve('out-coordinated/main/index.js'), appRoot: resolve('out-coordinated/main') }
  )
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    join(session.userDataDir, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: { ...profile.settings, experimentalCoordinatedAutomations: true }
    })
  )
  let app: ElectronApplication | undefined
  try {
    const first = await session.launch()
    app = first.app
    await first.page.setViewportSize({ width: 1280, height: 900 })
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
    const status = (await client.call<RuntimeStatus>('status.get')).result
    const repo = (
      await client.call<{ repo: { id: string } }>('repo.add', {
        path: testRepoPath,
        kind: 'folder'
      })
    ).result.repo
    const { projectId: _projectId, ...definition } = coordinatedCreateInput({
      children: [child('read')]
    })
    void _projectId
    const created = (
      await client.call<{ automation: { id: string } }>('automation.createCoordinated', {
        ...definition,
        repo: `id:${repo.id}`,
        destination: { selector: { kind: 'self' } }
      })
    ).result.automation
    const request = {
      runtimeId: status.runtimeId,
      automationId: created.id,
      expectedOwner: { selector: { kind: 'self' } },
      expectedDefinitionRevision: 1,
      idempotencyKey: 'isolated-app-lifecycle'
    }
    const started = (
      await client.call<CoordinatedFakeRunStartResponse>(
        'automation.startCoordinatedFakeRun',
        request
      )
    ).result
    expect(started.state).toBe('completed')
    expect(started.view.inspection.receipt.kind).toBe('available')
    expect(started.view.inspection.stages[0].sessionTarget.kind).toBe('unavailable')
    expect(started.view.actions.stop.available).toBe(false)
    expect(started.view.actions.retry.available).toBe(false)
    expect(started.view.actions.humanResolution.available).toBe(false)
    await session.close(app)
    app = undefined
    const second = await session.launch()
    app = second.app
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
    const restarted = new RuntimeClient(session.userDataDir, 30_000, null, null)
    await expect
      .poll(async () =>
        (await restarted.call<RuntimeStatus>('status.get')).result.capabilities?.includes(FAKE)
      )
      .toBe(true)
    const current = (await restarted.call<RuntimeStatus>('status.get')).result
    const inspected = (
      await restarted.call<{ view: CoordinatedRunView }>('automation.inspectCoordinatedRun', {
        runtimeId: current.runtimeId,
        automationId: created.id,
        automationRunId: started.view.inspection.automationRunId,
        expectedOwner: request.expectedOwner
      })
    ).result.view
    expect(inspected.inspection).toEqual(started.view.inspection)
    const replay = (
      await restarted.call<CoordinatedFakeRunStartResponse>('automation.startCoordinatedFakeRun', {
        ...request,
        runtimeId: current.runtimeId
      })
    ).result
    expect(replay.created).toBe(false)
    expect(replay.view.inspection).toEqual(inspected.inspection)
  } finally {
    await session.dispose(app)
  }
})
