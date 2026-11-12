import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication } from '@stablyai/playwright-test'
import { createRestartSession } from '../helpers/orca-restart'
import { getE2ECompletedOnboardingProfile } from '../helpers/e2e-completed-onboarding-profile'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { Automation } from '../../../src/shared/automations-types'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import type { CoordinatedRunView } from '../../../src/shared/coordinated-automation-run-view'
import {
  ARTICLE_STAGES,
  buildArticlePilotCreateRequest,
  loadArticlePilotInputs
} from './coordinated-article-pilot-package'
import { prepareArticlePilotApproval } from './coordinated-article-pilot-acceptance'

// Opt-in only: this spends the explicitly selected provider account on four synthetic roles.
test('one isolated native article reaches the independent review gate', async ({
  browserName: _browserName
}, testInfo) => {
  test.skip(
    process.env.ORCA_RUN_NATIVE_ARTICLE_PILOT !== '1',
    'Requires explicit manual provider-test opt-in'
  )
  // Four real provider turns and a persisted-profile restart need a bounded multi-minute window.
  test.setTimeout(1_200_000)
  const authFile = process.env.ORCA_PILOT_AUTH_FILE
  const codexBinary = process.env.ORCA_PILOT_CODEX_BINARY
  const nodeBinary = process.env.ORCA_PILOT_NODE_BINARY
  if (!authFile || !codexBinary || !nodeBinary) {
    throw new Error('Explicit provider binary, Node and account file required')
  }
  const session = createRestartSession(
    testInfo,
    {
      ORCA_PILOT_AUTH_FILE: authFile,
      ORCA_PILOT_CODEX_BINARY: codexBinary,
      ORCA_PILOT_NODE_BINARY: nodeBinary,
      ORCA_PILOT_REPORT_HELPER: resolve('out-coordinated/native-report/entry.cjs')
    },
    {
      mainPath: resolve('out-coordinated-native/main/index.js'),
      appRoot: resolve('out-coordinated-native/main')
    }
  )
  const workspace = join(session.userDataDir, 'article')
  mkdirSync(join(workspace, 'outputs/revisions'), { recursive: true })
  cpSync(resolve('docs/pilots/djvibe-article-shadow/inputs-v1'), join(workspace, 'inputs'), {
    recursive: true
  })
  const inputs = loadArticlePilotInputs(join(workspace, 'inputs'))
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    join(session.userDataDir, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: { ...profile.settings, experimentalCoordinatedAutomations: true, theme: 'dark' }
    })
  )
  writeFileSync(resolve('.cache/article-pilot-active-profile.txt'), session.userDataDir)
  let app: ElectronApplication | undefined
  let last: { view: CoordinatedRunView } | undefined
  const diagnostics: string[] = []
  try {
    const launched = await session.launch({ onStderr: (chunk) => diagnostics.push(chunk) })
    app = launched.app
    await launched.page.setViewportSize({ width: 1280, height: 900 })
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
    const client = new RuntimeClient(session.userDataDir, 120_000, null, null)
    const status = (await client.call<RuntimeStatus>('status.get')).result
    const configured = JSON.parse(
      readFileSync(join(session.userDataDir, 'article-pilot.json'), 'utf8')
    )
    const selection = {
      workspaceId: configured.workspaceId,
      promptAuthority: configured.promptAuthority,
      maxEstimatedCostUsd: 6,
      models: {
        'brief-review': { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
        'media-context': { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
        'write-draft': { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
        'editor-review': { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }
      }
    }
    const created = (
      await client.call<{ automation: Automation }>(
        'automation.createCoordinated',
        buildArticlePilotCreateRequest(inputs, selection, 'native-article-definition-001')
      )
    ).result.automation
    expect(created.enabled).toBe(false)
    expect(created.triggerPolicy).toBe('manual_only')
    await launched.page.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('Missing renderer store')
      }
      await store.getState().fetchRepos({ runtimeEnvironmentId: null })
      await store.getState().fetchAllWorktrees()
      window.localStorage.setItem('orca.xos.automationsView', 'native')
      store.getState().openAutomationsPage()
    })
    await launched.page.getByText(created.name, { exact: true }).first().click()
    last = (
      await client.call<{ view: CoordinatedRunView }>('automation.startCoordinatedNativeRun', {
        runtimeId: status.runtimeId,
        automationId: created.id,
        expectedOwner: { selector: { kind: 'self' } },
        expectedDefinitionRevision: created.definitionRevision,
        idempotencyKey: configured.idempotencyKey
      })
    ).result
    writeFileSync(
      resolve('.cache/article-pilot-native-current.json'),
      JSON.stringify(last, null, 2)
    )
    const selected = {
      runtimeId: last.view.runtimeId,
      automationId: created.id,
      expectedOwner: { selector: { kind: 'self' } },
      automationRunId: last.view.inspection.automationRunId
    }
    let openedLiveWorker = false
    await expect
      .poll(
        async () => {
          last = (
            await client.call<{ view: CoordinatedRunView }>(
              'automation.inspectCoordinatedRun',
              selected
            )
          ).result
          writeFileSync(
            resolve('.cache/article-pilot-native-current.json'),
            JSON.stringify(last, null, 2)
          )
          const inspection = last.view.inspection
          if (!openedLiveWorker && inspection.stages[0]?.sessionTarget.kind === 'terminal') {
            await launched.page.getByRole('button', { name: 'Refresh runs', exact: true }).click()
            const stageRow = launched.page
              .getByRole('list', { name: 'Host-observed stages', exact: true })
              .locator(':scope > li')
              .first()
            const openWorker = stageRow.getByRole('button', { name: 'Open worker terminal' })
            await expect(openWorker).toBeEnabled()
            await openWorker.click()
            await expect(launched.page.locator('.xterm:visible').first()).toBeVisible()
            await launched.page.screenshot({ path: testInfo.outputPath('native-live-worker.png') })
            writeFileSync(
              testInfo.outputPath('opened-live-worker-target.json'),
              JSON.stringify(inspection.stages[0].sessionTarget, null, 2)
            )
            expect(
              await app!.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows().every((window) => !window.isVisible())
              )
            ).toBe(true)
            openedLiveWorker = true
            await launched.page.evaluate(() => window.__store!.getState().openAutomationsPage())
            await launched.page.getByText(created.name, { exact: true }).first().click()
          }
          if (
            inspection.runStatus === 'dispatch_failed' ||
            (inspection.progress.kind === 'available' && inspection.progress.halt)
          ) {
            return true
          }
          return (
            last.view.inspection.stages
              .find((stage) => stage.childDefinitionId === 'editor-review')
              ?.pendingApproval?.gateIds.includes('pilot-artifact-review') ?? false
          )
        },
        { timeout: 900_000, intervals: [2000, 5000] }
      )
      .toBe(true)
    expect(last.view.inspection.runStatus, last.view.inspection.runError ?? undefined).not.toBe(
      'dispatch_failed'
    )
    expect(
      last.view.inspection.progress.kind === 'available' && last.view.inspection.progress.halt
    ).toBeNull()
    expect(last.view.inspection.stages.map((stage) => stage.childDefinitionId)).toEqual([
      ...ARTICLE_STAGES
    ])
    expect(openedLiveWorker).toBe(true)
    loadArticlePilotInputs(join(workspace, 'inputs'))
    const inspected = last.view.inspection
    if (
      !inspected.orchestrationRunId ||
      !inspected.definitionRevision ||
      !inspected.canonicalDigest ||
      !inspected.targetExecutionAuthority
    ) {
      throw new Error('Missing native acceptance identity')
    }
    await launched.page.getByRole('button', { name: 'Refresh runs', exact: true }).click()
    const heldReport = launched.page.getByRole('region', {
      name: 'Independent editorial reviewer held report'
    })
    await expect(heldReport).toBeVisible()
    await heldReport.scrollIntoViewIfNeeded()
    await launched.page.screenshot({ path: testInfo.outputPath('native-article-desktop.png') })
    await launched.page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
    await launched.page.setViewportSize({ width: 390, height: 844 })
    await heldReport.scrollIntoViewIfNeeded()
    expect((await heldReport.boundingBox())!.width).toBeGreaterThanOrEqual(280)
    await launched.page.screenshot({ path: testInfo.outputPath('native-article-mobile.png') })
    const approvalPreview = prepareArticlePilotApproval({
      view: last.view,
      workspacePath: workspace,
      selection: {
        runtimeId: last.view.runtimeId,
        automationId: inspected.automationId,
        automationRunId: inspected.automationRunId,
        orchestrationRunId: inspected.orchestrationRunId,
        definitionRevision: inspected.definitionRevision,
        canonicalDigest: inspected.canonicalDigest,
        targetExecutionAuthority: inspected.targetExecutionAuthority
      }
    })
    writeFileSync(
      testInfo.outputPath('human-approval-preview-not-submitted.json'),
      JSON.stringify(approvalPreview, null, 2)
    )
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
    const beforeRestart = last.view.inspection
    const descriptorBeforeRestart = readFileSync(
      join(session.userDataDir, 'article-pilot.json'),
      'utf8'
    )
    await session.close(app)
    app = undefined
    const restarted = await session.launch({ onStderr: (chunk) => diagnostics.push(chunk) })
    app = restarted.app
    const reopened = new RuntimeClient(session.userDataDir, 120_000, null, null)
    const newStatus = (await reopened.call<RuntimeStatus>('status.get')).result
    last = (
      await reopened.call<{ view: CoordinatedRunView }>('automation.inspectCoordinatedRun', {
        ...selected,
        runtimeId: newStatus.runtimeId
      })
    ).result
    expect(readFileSync(join(session.userDataDir, 'article-pilot.json'), 'utf8')).toBe(
      descriptorBeforeRestart
    )
    expect(last.view.inspection.automationRunId).toBe(beforeRestart.automationRunId)
    expect(
      last.view.inspection.stages.map((stage) => [stage.taskId, stage.mappedDispatchId])
    ).toEqual(beforeRestart.stages.map((stage) => [stage.taskId, stage.mappedDispatchId]))
    expect(
      last.view.inspection.stages.find((stage) => stage.childDefinitionId === 'editor-review')
        ?.pendingApproval?.reportDigest
    ).toBe(
      beforeRestart.stages.find((stage) => stage.childDefinitionId === 'editor-review')
        ?.pendingApproval?.reportDigest
    )
    expect(last.view.inspection.receipt.kind).toBe('absent')
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
    writeFileSync(testInfo.outputPath('native-article-restart.json'), JSON.stringify(last, null, 2))
  } finally {
    writeFileSync(testInfo.outputPath('native-article-app-stderr.log'), diagnostics.join(''))
    if (last) {
      writeFileSync(
        testInfo.outputPath('native-article-result.json'),
        JSON.stringify(last, null, 2)
      )
    }
    cpSync(join(workspace, 'outputs'), testInfo.outputPath('article-outputs'), { recursive: true })
    await session.dispose(app)
  }
})
