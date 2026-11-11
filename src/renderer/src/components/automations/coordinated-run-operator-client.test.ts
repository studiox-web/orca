import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../../shared/automation-runtime-capabilities'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { sampleCompletedVerifiedRun } from './AutomationCoordinatedRunPanel.fixture'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'

import { captureCoordinatedGateCandidate } from './coordinated-run-gate-candidate'
import {
  CoordinatedOperatorUnconfirmedError,
  describePendingGates,
  matchingFrozenSnapshot,
  submitCoordinatedRunOperatorAction
} from './coordinated-run-operator-client'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))

const binding = {
  automation: { ...sampleCoordinatedArticleAutomation, enabled: false },
  owner: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
}
const run = sampleCompletedVerifiedRun
const scope = {
  runtimeId: 'isolated-runtime',
  automationId: run.automationId,
  automationRunId: run.id,
  expectedOwner: { selector: { kind: 'self' } },
  orchestrationRunId: 'orch_run_verified_202',
  definitionRevision: 2,
  targetExecutionAuthority: 'local:local-host'
}
let inspected: CoordinatedRunView
let answered: CoordinatedRunView
let disposition: string | undefined
const stageGateScope = {
  kind: 'gate' as const,
  gateId: 'gate-editorial-signoff',
  scope: 'stage' as const,
  childDefinitionId: 'child-reviewer'
}

function stageGate() {
  return {
    ...stageGateScope,
    candidate: captureCoordinatedGateCandidate(binding, inspected, stageGateScope)
  }
}
function actionCalls(): [string, unknown][] {
  return vi
    .mocked(callRuntimeRpc)
    .mock.calls.map(([, method, params]): [string, unknown] => [method, params])
    .filter(([method]) => method !== 'status.get' && method !== 'automation.inspectCoordinatedRun')
}

beforeEach(() => {
  inspected = coordinatedHostActiveViewFixture()
  answered = coordinatedHostActiveViewFixture()
  disposition = 'recorded'
  vi.mocked(callRuntimeRpc).mockReset()
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method) => {
    if (method === 'status.get') {
      return {
        runtimeId: inspected.runtimeId,
        capabilities: [FAKE],
        coordinatedFakeRuns: { available: true }
      }
    }
    if (method === 'automation.inspectCoordinatedRun') {
      return { view: inspected }
    }
    return {
      state: 'outcome_uncertain',
      reason: 'Awaiting exit evidence.',
      disposition,
      view: answered
    }
  })
})

describe('coordinated run operator client', () => {
  it('submits a stop with the exact frozen scope and reports only the host answer', async () => {
    const outcome = await submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    expect(actionCalls()).toEqual([['automation.stopCoordinatedRun', scope]])
    expect(outcome.state).toBe('outcome_uncertain')
    expect(outcome.reason).toBe('Awaiting exit evidence.')
  })

  it('uses the host authority without frozen history and refuses an absent or contradicted one', async () => {
    const unmatched = {
      ...run,
      resolvedSnapshot: { ...run.resolvedSnapshot!, canonicalDigest: 'sha256:other' }
    }
    await submitCoordinatedRunOperatorAction(binding, unmatched, { kind: 'stop' })
    expect(actionCalls()).toEqual([['automation.stopCoordinatedRun', scope]])
    const contradicted = {
      ...run,
      resolvedSnapshot: {
        ...run.resolvedSnapshot!,
        executionTarget: { ...run.resolvedSnapshot!.executionTarget, id: 'other-host' }
      }
    }
    await expect(
      submitCoordinatedRunOperatorAction(binding, contradicted, { kind: 'stop' })
    ).rejects.toThrow('different execution authority')
    inspected.inspection.targetExecutionAuthority = null
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toThrow('no frozen execution authority')
    expect(actionCalls()).toHaveLength(1)
  })

  it('submits nothing when the host refuses the action on fresh inspection', async () => {
    inspected.actions.stop = {
      available: false,
      state: 'refused',
      reason: 'Operator stop is already recorded; awaiting exit evidence.'
    }
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toThrow('already recorded')
    expect(actionCalls()).toEqual([])
  })

  it('names the exact Task and confirmed latest attempt on retry', async () => {
    await submitCoordinatedRunOperatorAction(binding, run, {
      kind: 'retry',
      childDefinitionId: 'child-writer',
      retryOfDispatchId: 'ctx_writer_2'
    })
    expect(actionCalls()).toEqual([
      [
        'automation.retryCoordinatedStage',
        {
          ...scope,
          childDefinitionId: 'child-writer',
          taskId: 'task_writer_2',
          retryOfDispatchId: 'ctx_writer_2'
        }
      ]
    ])
  })

  it('does not replay a retry once the host records a newer attempt', async () => {
    inspected.inspection.stages[1].retryEligibility = {
      canRetry: true,
      reason: null,
      retryOfDispatchId: 'ctx_writer_3'
    }
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, {
        kind: 'retry',
        childDefinitionId: 'child-writer',
        retryOfDispatchId: 'ctx_writer_2'
      })
    ).rejects.toThrow('newer attempt')
    expect(actionCalls()).toEqual([])
  })

  it('keeps a shared gate id bound to the exact scope the operator chose', async () => {
    await submitCoordinatedRunOperatorAction(binding, run, {
      ...stageGate(),
      decision: 'approve',
      note: 'Reviewed draft 4'
    })
    await submitCoordinatedRunOperatorAction(binding, run, {
      kind: 'gate',
      gateId: 'gate-editorial-signoff',
      candidate: captureCoordinatedGateCandidate(binding, inspected, {
        scope: 'parent',
        gateId: stageGateScope.gateId,
        childDefinitionId: null
      }),
      scope: 'parent',
      childDefinitionId: null,
      decision: 'reject'
    })
    expect(actionCalls()).toEqual([
      [
        'automation.resolveCoordinatedGate',
        {
          ...scope,
          gateId: 'gate-editorial-signoff',
          gateScope: 'stage',
          decision: 'approve',
          note: 'Reviewed draft 4',
          childDefinitionId: 'child-reviewer',
          taskId: 'task_rev_3',
          dispatchId: 'ctx_rev_1',
          expectedReportDigest: inspected.inspection.stages[2].pendingApproval!.reportDigest
        }
      ],
      [
        'automation.resolveCoordinatedGate',
        { ...scope, gateId: 'gate-editorial-signoff', gateScope: 'parent', decision: 'reject' }
      ]
    ])
  })

  it('refuses an ineligible held report but still submits a reject', async () => {
    inspected.inspection.stages[2].gateResolutionEligibility.approvableDispatchId = null
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { ...stageGate(), decision: 'approve' })
    ).rejects.toThrow('held report is not eligible')
    expect(actionCalls()).toEqual([])
    await submitCoordinatedRunOperatorAction(binding, run, { ...stageGate(), decision: 'reject' })
    expect(actionCalls()).toHaveLength(1)
  })

  it('refuses a decision the host does not report pending in that exact scope', async () => {
    const action = { ...stageGate(), decision: 'reject' as const }
    inspected.inspection.humanResolution.pendingDecisions = []
    await expect(submitCoordinatedRunOperatorAction(binding, run, action)).rejects.toThrow(
      'no longer reports this decision as pending in this scope'
    )
    expect(actionCalls()).toEqual([])
  })

  it('replays an unconfirmed request on its natural key and reports that nothing new was written', async () => {
    inspected.actions.stop = {
      available: false,
      state: 'refused',
      reason: 'Operator stop is already recorded; awaiting exit evidence.'
    }
    inspected.inspection.stages[1].retryEligibility = {
      canRetry: false,
      reason: 'Attempt ctx_writer_3 is still open.',
      retryOfDispatchId: null
    }
    disposition = 'already_recorded'
    const stop = await submitCoordinatedRunOperatorAction(
      binding,
      run,
      { kind: 'stop' },
      { replay: true }
    )
    await submitCoordinatedRunOperatorAction(
      binding,
      run,
      { kind: 'retry', childDefinitionId: 'child-writer', retryOfDispatchId: 'ctx_writer_2' },
      { replay: true }
    )
    expect(stop.disposition).toBe('already_recorded')
    expect(actionCalls().map(([method]) => method)).toEqual([
      'automation.stopCoordinatedRun',
      'automation.retryCoordinatedStage'
    ])
    expect(actionCalls()[1][1]).toMatchObject({ retryOfDispatchId: 'ctx_writer_2' })
  })

  it('treats an answer without a disposition or for another authority as unconfirmed', async () => {
    disposition = undefined
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toBeInstanceOf(CoordinatedOperatorUnconfirmedError)
    disposition = 'recorded'
    answered.inspection.targetExecutionAuthority = 'ssh:other'
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toBeInstanceOf(CoordinatedOperatorUnconfirmedError)
  })

  it('rejects an answer that names a different run', async () => {
    answered.inspection.automationRunId = 'another-run'
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toBeInstanceOf(CoordinatedOperatorUnconfirmedError)
  })

  it('lists every host decision once per scope, with or without frozen history', () => {
    expect(matchingFrozenSnapshot(inspected, { ...run, id: 'other' })).toBeNull()
    const gates = describePendingGates(inspected, null)
    expect(gates.map((gate) => [gate.gateId, gate.scope, gate.childDefinitionId])).toEqual([
      ['gate-editorial-signoff', 'stage', 'child-reviewer'],
      ['gate-editorial-signoff', 'parent', null],
      ['escalation:uncertain-effect', 'escalation', null]
    ])
    expect(new Set(gates.map((gate) => gate.key)).size).toBe(3)
  })
})
