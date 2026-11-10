// @vitest-environment happy-dom
import {
  api,
  installAutomationsPageHarness,
  mocks,
  renderPage,
  scopedList,
  settleHostQueries
} from './automations-page-test-harness'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { draftRecord, openCreateDialogFor, save } from './automations-page-actions-test-harness'
import { listedRow } from './automations-page-listed-items'
import { makeAutomation, REPO_ID, WORKSPACE_ID } from './automations-page-fixtures'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'
import { COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY } from '../../../../shared/automation-runtime-capabilities'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Automation } from '../../../../shared/automations-types'
import type { AutomationAuthorityRef } from '../../../../shared/automation-owner-ref'
import {
  assertCoordinatedDefinitionWritesSupported,
  dispatchCoordinatedAutomationUpdate
} from './automation-coordinated-definition-client'

installAutomationsPageHarness()

function installDefinitionHost(initial: Automation[] = []) {
  let records = initial
  let refusal: string | null = null
  let capable = true
  const previous = mocks.callRuntimeRpc.getMockImplementation()
  const publish = (): void => {
    scopedList(records)
    api.automations.list.mockResolvedValue(records)
  }
  publish()
  mocks.state.settings = {
    ...getDefaultSettings('/tmp'),
    experimentalCoordinatedAutomations: true
  }
  mocks.callRuntimeRpc.mockImplementation(async (target, method, params, options) => {
    if (method === 'status.get') {
      return {
        capabilities: capable ? [COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY] : []
      }
    }
    if (method === 'automation.createCoordinated' || method === 'automation.updateCoordinated') {
      if (refusal) {
        throw new Error(refusal)
      }
      const current = records.find((record) => record.id === params.id)
      const fields = params.updates ?? params
      const automation = makeAutomation({
        ...current,
        ...fields,
        id: params.id ?? 'created-coordinated',
        projectId: REPO_ID,
        workspaceId: WORKSPACE_ID,
        kind: 'coordinated',
        enabled: false,
        definitionRevision: (current?.definitionRevision ?? 0) + 1
      })
      records = [...records.filter((record) => record.id !== automation.id), automation]
      publish()
      return { automation }
    }
    return await previous?.(target, method, params, options)
  })
  return {
    refuse(message: string | null) {
      refusal = message
    },
    revokeCapability() {
      capable = false
    },
    replace(automation: Automation) {
      records = [automation]
      publish()
    }
  }
}

async function configureDraft(): Promise<void> {
  await openCreateDialogFor(REPO_ID, WORKSPACE_ID)
  await act(async () => {
    mocks.editorDialog?.onDraftChange((current) => ({
      ...draftRecord(current),
      kind: 'coordinated',
      surface: 'terminal',
      outcomeContract: sampleCoordinatedArticleAutomation.outcomeContract,
      children: sampleCoordinatedArticleAutomation.children,
      inheritedDefaults: sampleCoordinatedArticleAutomation.inheritedDefaults,
      globalCeilings: sampleCoordinatedArticleAutomation.globalCeilings,
      publicationPolicy: sampleCoordinatedArticleAutomation.publicationPolicy,
      retentionPolicy: sampleCoordinatedArticleAutomation.retentionPolicy
    }))
  })
}

function writes() {
  return mocks.callRuntimeRpc.mock.calls.filter((call) =>
    ['automation.createCoordinated', 'automation.updateCoordinated'].includes(call[1])
  )
}

function expectNoSingleWrite(): void {
  expect(api.automations.create).not.toHaveBeenCalled()
  expect(api.automations.update).not.toHaveBeenCalled()
  expect(api.automations.runNow).not.toHaveBeenCalled()
}

describe('coordinated definition save transaction', () => {
  it.each([
    {
      authority: { kind: 'runtime', environmentId: 'remote', pairingRevision: 1 },
      selector: { kind: 'self' }
    },
    {
      authority: { kind: 'desktop' },
      selector: { kind: 'ssh', targetId: 'editorial', targetGeneration: 2 }
    }
  ] as const)(
    'refuses unsupported owner $authority.kind / $selector.kind before probing or writing',
    async ({ authority, selector }) => {
      await expect(assertCoordinatedDefinitionWritesSupported(authority, selector)).rejects.toThrow(
        'Remote and SSH hosts are not supported'
      )
      expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    }
  )

  it('refuses an uncaptured owner without falling back to unfenced update', async () => {
    const authority: AutomationAuthorityRef = { kind: 'desktop' }
    const result = await dispatchCoordinatedAutomationUpdate(
      { capturedOwners: new Map(), authority },
      { rowKey: 'uncaptured', automationId: 'a-1' },
      { name: 'Keep my edits' },
      {
        outcomeContract: sampleCoordinatedArticleAutomation.outcomeContract!,
        children: sampleCoordinatedArticleAutomation.children!
      },
      1,
      undefined
    )
    expect(result).toMatchObject({
      ok: false,
      notice: { message: expect.stringContaining('no confirmed local owner') }
    })
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    expectNoSingleWrite()
  })
  it('creates disabled, reopens with stable child IDs, and updates with owner and revision fences', async () => {
    installDefinitionHost()
    await renderPage()
    await settleHostQueries()
    await configureDraft()
    await save()
    expect(writes()).toHaveLength(1)
    expect(writes()[0]?.[0]).toEqual({ kind: 'local' })
    expect(writes()[0]?.[2]).toMatchObject({
      kind: 'coordinated',
      enabled: false,
      destination: { selector: { kind: 'self' } },
      children: sampleCoordinatedArticleAutomation.children,
      outcomeContract: sampleCoordinatedArticleAutomation.outcomeContract
    })
    expect(mocks.editorDialog?.open).toBe(false)
    await act(async () => {
      mocks.listPanel?.openEditDialog(listedRow('created-coordinated'))
    })
    expect(mocks.editorDialog?.draft).toMatchObject({
      definitionRevision: 1,
      children: sampleCoordinatedArticleAutomation.children,
      inheritedDefaults: sampleCoordinatedArticleAutomation.inheritedDefaults
    })
    await act(async () => {
      mocks.editorDialog?.onDraftChange((current) => ({ ...draftRecord(current), name: 'Renamed' }))
    })
    await save()
    expect(writes()).toHaveLength(2)
    expect(writes()[1]?.[2]).toMatchObject({
      id: 'created-coordinated',
      expectedOwner: { selector: { kind: 'self' } },
      updates: {
        name: 'Renamed',
        expectedDefinitionRevision: 1,
        children: sampleCoordinatedArticleAutomation.children
      }
    })
    expect(writes()[1]?.[2].updates).not.toHaveProperty('enabled')
    await act(async () => {
      mocks.listPanel?.openEditDialog(listedRow('created-coordinated'))
    })
    expect(mocks.editorDialog?.draft).toMatchObject({ name: 'Renamed', definitionRevision: 2 })
    expectNoSingleWrite()
  })

  it('preserves the complete draft and creation key after an uncertain create response', async () => {
    const host = installDefinitionHost()
    host.refuse('Connection lost after request')
    await renderPage()
    await settleHostQueries()
    await configureDraft()
    const draft = mocks.editorDialog?.draft
    await save()
    expect(mocks.editorDialog?.open).toBe(true)
    expect(mocks.editorDialog?.draft).toEqual(draft)
    expect(mocks.editorDialog?.notice?.message).toContain('Connection lost')
    host.refuse(null)
    await save()
    expect(writes()).toHaveLength(2)
    expect(writes()[0]?.[2].creationKey).toBeTruthy()
    expect(writes()[1]?.[2].creationKey).toBe(writes()[0]?.[2].creationKey)
    expectNoSingleWrite()
  })

  it('rechecks capability at save time and keeps edits without a legacy fallback', async () => {
    const host = installDefinitionHost()
    await renderPage()
    await settleHostQueries()
    await configureDraft()
    const draft = mocks.editorDialog?.draft
    host.revokeCapability()
    await save()
    expect(writes()).toHaveLength(0)
    expect(mocks.editorDialog?.open).toBe(true)
    expect(mocks.editorDialog?.draft).toEqual(draft)
    expect(mocks.editorDialog?.notice?.message).toContain('not accepting coordinated')
    expectNoSingleWrite()
  })

  it.each(['reread', 'write'] as const)(
    'keeps draft changes on a revision conflict at %s',
    async (when) => {
      const original = makeAutomation({
        ...sampleCoordinatedArticleAutomation,
        projectId: REPO_ID,
        workspaceId: WORKSPACE_ID,
        definitionRevision: 4,
        surface: 'terminal'
      })
      const host = installDefinitionHost([original])
      await renderPage()
      await settleHostQueries()
      await act(async () => {
        mocks.listPanel?.openEditDialog(listedRow(original.id))
      })
      await act(async () => {
        mocks.editorDialog?.onDraftChange((current) => ({
          ...draftRecord(current),
          name: 'Keep my edits'
        }))
      })
      const draft = mocks.editorDialog?.draft
      if (when === 'reread') {
        host.replace({ ...original, definitionRevision: 5 })
      } else {
        host.refuse('Definition revision conflict: expected 4, current 5')
      }
      await save()
      expect(writes()).toHaveLength(when === 'reread' ? 0 : 1)
      expect(mocks.editorDialog?.open).toBe(true)
      expect(mocks.editorDialog?.draft).toEqual(draft)
      expect(mocks.editorDialog?.notice?.message).toMatch(/Rev 5|revision conflict/)
      expectNoSingleWrite()
    }
  )
})
