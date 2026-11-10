import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../../shared/automation-runtime-capabilities'
import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { sampleCompletedVerifiedRun } from './AutomationCoordinatedRunPanel.fixture'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { sampleCoordinatedArticleAutomation } from './coordinated-automation-run-fixture-data'

import {
  classifyPendingGates,
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

function actionCalls(): [string, unknown][] {
  return vi
    .mocked(callRuntimeRpc)
    .mock.calls.map(([, method, params]): [string, unknown] => [method, params])
    .filter(([method]) => method !== 'status.get' && method !== 'automation.inspectCoordinatedRun')
}

beforeEach(() => {
  inspected = coordinatedHostActiveViewFixture()
  answered = coordinatedHostActiveViewFixture()
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
    return { state: 'outcome_uncertain', reason: 'Awaiting exit evidence.', view: answered }
  })
})

describe('coordinated run operator client', () => {
  it('submits a stop with the exact frozen scope and reports only the host answer', async () => {
    const outcome = await submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    expect(actionCalls()).toEqual([['automation.stopCoordinatedRun', scope]])
    expect(outcome.state).toBe('outcome_uncertain')
    expect(outcome.reason).toBe('Awaiting exit evidence.')
  })

  it('submits nothing when run history is not the frozen definition the host inspected', async () => {
    const stale = {
      ...run,
      resolvedSnapshot: { ...run.resolvedSnapshot!, canonicalDigest: 'sha256:other' }
    }
    await expect(
      submitCoordinatedRunOperatorAction(binding, stale, { kind: 'stop' })
    ).rejects.toThrow('frozen run scope is unavailable')
    expect(actionCalls()).toEqual([])
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

  it('binds a stage gate to its stage and Task and leaves the Dispatch to the host', async () => {
    await submitCoordinatedRunOperatorAction(binding, run, {
      kind: 'gate',
      gateId: 'gate-editorial-signoff',
      decision: 'approve',
      note: 'Reviewed draft 4'
    })
    expect(actionCalls()).toEqual([
      [
        'automation.resolveCoordinatedGate',
        {
          ...scope,
          gateId: 'gate-editorial-signoff',
          decision: 'approve',
          note: 'Reviewed draft 4',
          childDefinitionId: 'child-reviewer',
          taskId: 'task_rev_3'
        }
      ]
    ])
  })

  it('sends a run-level escalation without stage scope and refuses an unreported gate', async () => {
    await submitCoordinatedRunOperatorAction(binding, run, {
      kind: 'gate',
      gateId: 'escalation:uncertain-effect',
      decision: 'escalate'
    })
    expect(actionCalls()).toEqual([
      [
        'automation.resolveCoordinatedGate',
        { ...scope, gateId: 'escalation:uncertain-effect', decision: 'escalate' }
      ]
    ])
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, {
        kind: 'gate',
        gateId: 'gate-not-pending',
        decision: 'approve'
      })
    ).rejects.toThrow('no longer reports this decision')
    expect(actionCalls()).toHaveLength(1)
  })

  it('rejects an answer that names a different run', async () => {
    answered.inspection.automationRunId = 'another-run'
    await expect(
      submitCoordinatedRunOperatorAction(binding, run, { kind: 'stop' })
    ).rejects.toThrow('different runtime, parent, run')
  })

  it('leaves a pending key unclassified without matching frozen history', () => {
    expect(matchingFrozenSnapshot(inspected, { ...run, id: 'other' })).toBeNull()
    expect(classifyPendingGates(inspected, null).map((gate) => gate.scope)).toEqual([
      'unclassified',
      'escalation'
    ])
  })
})
