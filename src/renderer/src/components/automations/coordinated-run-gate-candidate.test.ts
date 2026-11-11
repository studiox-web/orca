import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../../shared/automation-runtime-capabilities'
import { sampleCompletedVerifiedRun as run } from './AutomationCoordinatedRunPanel.fixture'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'
import {
  captureCoordinatedGateCandidate,
  type CoordinatedGateAction
} from './coordinated-run-gate-candidate'
import { submitCoordinatedRunOperatorAction } from './coordinated-run-operator-client'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
const binding = {
  automation: { ...sampleCoordinatedArticleAutomation, enabled: false },
  owner: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
}
let view: ReturnType<typeof coordinatedHostActiveViewFixture>
let action: CoordinatedGateAction
let disposition: 'recorded' | 'already_recorded'
const writes = () =>
  vi
    .mocked(callRuntimeRpc)
    .mock.calls.filter(([, method]) => method === 'automation.resolveCoordinatedGate')
beforeEach(() => {
  view = coordinatedHostActiveViewFixture()
  disposition = 'recorded'
  const gate = {
    gateId: 'gate-editorial-signoff',
    scope: 'stage' as const,
    childDefinitionId: 'child-reviewer'
  }
  action = {
    ...gate,
    kind: 'gate',
    decision: 'approve',
    candidate: captureCoordinatedGateCandidate(binding, view, gate)
  }
  vi.mocked(callRuntimeRpc).mockReset()
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method) => {
    if (method === 'status.get') {
      return {
        runtimeId: view.runtimeId,
        capabilities: [FAKE],
        coordinatedFakeRuns: { available: true }
      }
    }
    if (method === 'automation.inspectCoordinatedRun') {
      return { view }
    }
    return { disposition, state: 'awaiting_approval', reason: null, view }
  })
})

describe('captured gate scope and consent', () => {
  it.each([
    'runtime',
    'run',
    'revision',
    'orchestration',
    'authority',
    'definition',
    'task',
    'owner',
    'gate',
    'child',
    'parent'
  ] as const)('refuses changed %s scope before sending an approval', async (field) => {
    if (field === 'runtime') {
      view.runtimeId = 'other-runtime'
    }
    if (field === 'run') {
      view.inspection.automationRunId = 'other-run'
    }
    if (field === 'revision') {
      view.inspection.definitionRevision++
    }
    if (field === 'orchestration') {
      view.inspection.orchestrationRunId = 'other-orchestration'
    }
    if (field === 'authority') {
      view.inspection.targetExecutionAuthority = 'local:other'
    }
    if (field === 'definition') {
      view.inspection.canonicalDigest = 'sha256:changed'
    }
    if (field === 'task') {
      view.inspection.stages[2].taskId = 'other-task'
    }
    if (field === 'owner') {
      action.candidate.bindingKey = 'other-owner'
    }
    if (field === 'gate') {
      action.gateId = 'other-gate'
    }
    if (field === 'child') {
      action.childDefinitionId = 'child-writer'
    }
    if (field === 'parent') {
      action.scope = 'parent'
      action.childDefinitionId = null
    }
    await expect(submitCoordinatedRunOperatorAction(binding, run, action)).rejects.toThrow()
    expect(writes()).toHaveLength(0)
  })

  it.each([
    'missing',
    'unavailable',
    'digest',
    'dispatch',
    'report',
    'gate',
    'eligibility'
  ] as const)(
    'does not let a reused gate inherit approval after %s evidence changes',
    async (field) => {
      const stage = view.inspection.stages[2]
      const held = stage.pendingApproval!
      if (field === 'missing') {
        delete stage.pendingApproval
      }
      if (field === 'unavailable') {
        held.report = { kind: 'unavailable', reason: 'Report bytes changed.' }
      }
      if (field === 'digest') {
        held.reportDigest = 'sha256:changed'
      }
      if (field === 'dispatch') {
        held.dispatchId = 'ctx_rev_2'
        stage.gateResolutionEligibility.approvableDispatchId = held.dispatchId
      }
      if (field === 'report' && held.report.kind === 'available') {
        held.report.summary = 'Different report with a dishonest unchanged digest'
      }
      if (field === 'gate') {
        held.gateIds = ['other-gate']
      }
      if (field === 'eligibility') {
        stage.gateResolutionEligibility.canResolve = false
      }
      await expect(submitCoordinatedRunOperatorAction(binding, run, action)).rejects.toThrow(
        'Nothing was submitted'
      )
      expect(writes()).toHaveLength(0)
    }
  )

  it('refuses an unconfirmed replay when a new attempt is held under the same gate id', async () => {
    const held = view.inspection.stages[2].pendingApproval!
    held.dispatchId = 'ctx_rev_2'
    view.inspection.stages[2].gateResolutionEligibility.approvableDispatchId = held.dispatchId
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, action, { replay: true })
    ).rejects.toThrow('held report changed')
    expect(action.candidate.heldReport?.dispatchId).toBe('ctx_rev_1')
    expect(writes()).toHaveLength(0)
  })

  it('asks for the same-candidate receipt when that gate is resolved but another approval still holds the report', async () => {
    const stage = view.inspection.stages[2]
    const held = stage.pendingApproval!
    held.gateIds = ['another-approval']
    stage.gateResolutionEligibility.pendingGateIds = ['another-approval']
    view.inspection.humanResolution.pendingDecisions = []
    disposition = 'already_recorded'
    const result = await submitCoordinatedRunOperatorAction(binding, run, action, { replay: true })
    expect(result.disposition).toBe('already_recorded')
    expect(writes()[0][2]).toMatchObject({
      gateId: action.gateId,
      dispatchId: 'ctx_rev_1',
      expectedReportDigest: held.reportDigest
    })
  })

  it('refuses a replay when a newer attempt has started without a held report', async () => {
    const stage = view.inspection.stages[2]
    delete stage.pendingApproval
    if (stage.native.kind === 'available') {
      stage.native.latestDispatchId = 'ctx_rev_2'
    }
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, action, { replay: true })
    ).rejects.toThrow('different attempt')
    expect(writes()).toHaveLength(0)
  })

  it.each(['reject', 'escalate'] as const)(
    'does not add approval fields to %s',
    async (decision) => {
      await submitCoordinatedRunOperatorAction(binding, run, { ...action, decision })
      expect(writes()[0][2]).toMatchObject({
        gateScope: 'stage',
        decision,
        childDefinitionId: 'child-reviewer',
        taskId: 'task_rev_3'
      })
      expect(writes()[0][2]).not.toHaveProperty('dispatchId')
      expect(writes()[0][2]).not.toHaveProperty('expectedReportDigest')
    }
  )
})
