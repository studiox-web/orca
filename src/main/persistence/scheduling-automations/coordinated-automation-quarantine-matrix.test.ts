import { describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../shared/automations-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { SemanticCompletionReceipt } from '../../../shared/coordinated-automation-receipt-types'
import type { CoordinatedCompletionTrust } from '../../../shared/coordinated-automation-types'
import {
  detachCoordinatedRun,
  sealLoadedCoordinatedRun
} from '../../../shared/coordinated-automation-run-seal'
import { COORDINATED_PHASE_LINKS } from '../../../shared/coordinated-automation-run-validation'
import { normalizeLoadedAutomationRuns } from '../loading-store/normalize-loaded-state-collections'
import { createCoordinatedAutomation } from './coordinated-automation-definition-operations'
import { createCoordinatedAutomationRun } from './coordinated-automation-run-operations'
import {
  linkCoordinatedOrchestrationRun,
  markCoordinatedRunReadyForDispatch,
  persistCoordinatedChildMappings
} from './coordinated-automation-run-links'
import { isCoordinatedRunDispatchable } from './coordinated-automation-run-records'
import {
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness,
  fakeOrchestration
} from './coordinated-automation-persistence.test-support'

/** A ready, fully linked run as the store holds it. */
function readyRun(): AutomationRun {
  const harness = durableHarness(coordinatedTestState())
  const orchestration = fakeOrchestration()
  const parent = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
  const run = createCoordinatedAutomationRun(harness.runs(), {
    automationId: parent.id,
    scheduledFor: 1
  }).run!
  orchestration.createRun('orun-1')
  linkCoordinatedOrchestrationRun(harness.runs(), {
    automationRunId: run.id,
    orchestrationRunId: 'orun-1',
    probe: orchestration
  })
  orchestration.createTask('orun-1', 't1')
  orchestration.createTask('orun-1', 't2')
  persistCoordinatedChildMappings(harness.runs(), {
    automationRunId: run.id,
    mappings: [
      { childDefinitionId: 'research', taskId: 't1' },
      { childDefinitionId: 'writer', taskId: 't2' }
    ],
    probe: orchestration
  })
  markCoordinatedRunReadyForDispatch(harness.runs(), {
    automationRunId: run.id,
    probe: orchestration
  })
  return structuredClone(harness.state.automationRuns[0])
}

function reload(runs: AutomationRun[], markNeedsSave = vi.fn()) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: run normalization reads only automationRuns.
  const parsed = { automationRuns: JSON.parse(JSON.stringify(runs)) } as PersistedState
  return { runs: normalizeLoadedAutomationRuns(parsed, markNeedsSave), markNeedsSave }
}

describe('pre-marked quarantine is never trusted', () => {
  it('re-quarantines a fully linked row that merely carries a quarantine marker', () => {
    const ready = readyRun()
    expect(isCoordinatedRunDispatchable(ready)).toBe(true)
    const marked: AutomationRun = {
      ...ready,
      coordinatedQuarantine: {
        reason: 'looks fine',
        payloadDigest: `sha256:${'0'.repeat(64)}`,
        payload: null
      }
    }
    // Same object, still marked: dispatch is explicitly rejected before any link check.
    expect(isCoordinatedRunDispatchable(marked)).toBe(false)

    const { runs, markNeedsSave } = reload([marked])
    expect(markNeedsSave).toHaveBeenCalled()
    expect(runs[0]).toMatchObject({
      resolvedSnapshot: null,
      childMappings: [],
      orchestrationRunId: null,
      materializationPhase: 'materialization_failed',
      coordinatedQuarantine: { reason: 'Stored quarantine record is malformed or not inert.' }
    })
    expect(isCoordinatedRunDispatchable(runs[0])).toBe(false)
  })

  it.each([
    ['a public summary persisted as if it were the record', { payloadRetained: true }],
    ['a payload whose digest does not match', { payload: '{"forged":true}' }],
    ['an oversized reason', { reason: 'x'.repeat(513) }]
  ])('repairs %s', (_label, change) => {
    const [canonical] = reload([{ ...readyRun(), materializationPhase: 'intent_persisted' }]).runs
    const record: Record<string, unknown> = { ...canonical.coordinatedQuarantine, ...change }
    if ('payloadRetained' in change) {
      delete record.payload
    }
    const tampered = { ...canonical, coordinatedQuarantine: record }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deliberately malformed stored JSON for the loader.
    const { runs, markNeedsSave } = reload([tampered as AutomationRun])
    expect(markNeedsSave).toHaveBeenCalled()
    expect(runs[0].coordinatedQuarantine?.reason).toBe(
      'Stored quarantine record is malformed or not inert.'
    )
  })

  it('keeps a canonical quarantine idempotent and does not ask to save it again', () => {
    const first = reload([{ ...readyRun(), orchestrationRunId: null }])
    expect(first.markNeedsSave).toHaveBeenCalledTimes(1)
    const second = reload(first.runs)
    expect(second.runs).toEqual(first.runs)
    expect(second.markNeedsSave).not.toHaveBeenCalled()
  })

  it('never hands out the private payload', () => {
    const [quarantined] = reload([{ ...readyRun(), orchestrationRunId: null }]).runs
    expect(quarantined.coordinatedQuarantine).toHaveProperty('payload')
    const detached = detachCoordinatedRun(quarantined)
    expect(detached.coordinatedQuarantine).toEqual({
      reason: expect.stringMatching(/requires an orchestration Run/),
      payloadDigest: expect.stringMatching(/^sha256:/),
      payloadRetained: true
    })
    expect(JSON.stringify(detached)).not.toContain('"payload"')
  })
})

describe('phase / link invariant matrix', () => {
  it('names every phase', () => {
    expect(Object.keys(COORDINATED_PHASE_LINKS).sort()).toEqual([
      'compensation_failed',
      'intent_persisted',
      'mappings_persisted',
      'materialization_failed',
      'orchestration_run_created',
      'orphaned_reconciling',
      'ready_for_dispatch',
      'tasks_created'
    ])
  })

  const dispatched = (run: AutomationRun) =>
    run.childMappings!.map((m, index) => ({ ...m, dispatchId: `d${index}` }))

  it.each<[string, (run: AutomationRun) => Partial<AutomationRun>, RegExp]>([
    [
      'intent with a Run link',
      () => ({ materializationPhase: 'intent_persisted', childMappings: [] }),
      /forbids an orchestration Run/
    ],
    [
      'Run created without its link',
      () => ({
        materializationPhase: 'orchestration_run_created',
        orchestrationRunId: null,
        childMappings: []
      }),
      /requires an orchestration Run/
    ],
    [
      'tasks created with mappings',
      () => ({ materializationPhase: 'tasks_created' }),
      /forbids Task mappings/
    ],
    [
      'mappings persisted with a missing link',
      (run) => ({
        materializationPhase: 'mappings_persisted',
        childMappings: run.childMappings!.slice(1)
      }),
      /exactly one Task mapping/
    ],
    [
      'mappings persisted with a Dispatch',
      (run) => ({ materializationPhase: 'mappings_persisted', childMappings: dispatched(run) }),
      /forbids Dispatch IDs/
    ],
    [
      'ready with a shared Dispatch',
      (run) => ({ childMappings: run.childMappings!.map((m) => ({ ...m, dispatchId: 'same' })) }),
      /more than one child/
    ],
    [
      'ready without its Run link',
      () => ({ orchestrationRunId: null }),
      /requires an orchestration Run/
    ],
    [
      'failed with partial links',
      (run) => ({
        materializationPhase: 'materialization_failed',
        childMappings: run.childMappings!.slice(1)
      }),
      /exactly one Task mapping/
    ],
    [
      'failed with mappings but no Run',
      () => ({ materializationPhase: 'compensation_failed', orchestrationRunId: null }),
      /without an orchestration Run/
    ]
  ])('quarantines %s', (_label, change, reason) => {
    const ready = readyRun()
    const { runs } = reload([{ ...ready, ...change(ready) }])
    expect(runs[0].coordinatedQuarantine?.reason).toMatch(reason)
  })

  it.each<[string, (run: AutomationRun) => Partial<AutomationRun>]>([
    ['ready with dispatched links', (run) => ({ childMappings: dispatched(run) })],
    [
      'failed after its Run was created',
      () => ({ materializationPhase: 'orphaned_reconciling', childMappings: [] })
    ],
    ['failed with complete links', () => ({ materializationPhase: 'materialization_failed' })]
  ])('accepts %s', (_label, change) => {
    const ready = readyRun()
    const { runs, markNeedsSave } = reload([{ ...ready, ...change(ready) }])
    expect(runs[0].coordinatedQuarantine).toBeUndefined()
    expect(markNeedsSave).not.toHaveBeenCalled()
  })
})

describe('completion receipts', () => {
  const TRUST: CoordinatedCompletionTrust = {
    authorIdentity: 'author',
    activeAttempt: { taskId: 'coordinator-task', dispatchId: 'coordinator-dispatch' }
  }

  function withReceipt(
    chain: Partial<SemanticCompletionReceipt['identityChain']> = {},
    trust: CoordinatedCompletionTrust | null = TRUST
  ): AutomationRun {
    const ready = readyRun()
    const mappings = ready.childMappings!.map((m, index) => ({ ...m, dispatchId: `d${index}` }))
    const snapshot = ready.resolvedSnapshot!
    const receipt: SemanticCompletionReceipt = {
      schemaVersion: 1,
      identityChain: {
        automationId: ready.automationId,
        definitionRevision: snapshot.definitionRevision,
        automationRunId: ready.id,
        orchestrationRunId: ready.orchestrationRunId!,
        hostId: snapshot.executionTarget.id,
        targetExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`,
        activeAttempt: { ...TRUST.activeAttempt },
        taskMappings: mappings.map((m) => ({ ...m })),
        ...chain
      },
      frozenConfigDigest: snapshot.canonicalDigest,
      finalState: 'completed',
      completedAt: 2,
      acceptanceResults: [
        { criterionId: 'draft-ready', status: 'satisfied', evidence: ['e'], evaluatedAt: 2 }
      ],
      approvals: [],
      effectReceipts: [],
      unresolvedWarnings: []
    }
    return { ...ready, childMappings: mappings, completionReceipt: receipt, completionTrust: trust }
  }

  it('accepts a receipt that belongs to this exact run', () => {
    const { runs } = reload([withReceipt()])
    expect(runs[0].coordinatedQuarantine).toBeUndefined()
    expect(Object.isFrozen(runs[0].completionReceipt)).toBe(true)
  })

  it.each<[string, AutomationRun, RegExp]>([
    ['from another run', withReceipt({ automationRunId: 'other-run' }), /not this run's/],
    [
      'from another orchestration Run',
      withReceipt({ orchestrationRunId: 'orun-9' }),
      /not this run's/
    ],
    [
      'from another authority',
      withReceipt({ targetExecutionAuthority: 'ssh:elsewhere' }),
      /not this run's/
    ],
    ['with different Task mappings', withReceipt({ taskMappings: [] }), /not this run's/],
    ['without host-recorded trust', withReceipt({}, null), /completion trust record/]
  ])('quarantines a schema-valid receipt %s', (_label, run, reason) => {
    const { runs } = reload([run])
    expect(runs[0].coordinatedQuarantine?.reason).toMatch(reason)
    expect(runs[0].completionReceipt).toBeNull()
  })

  it('quarantines a receipt on a phase that cannot have one', () => {
    const run = { ...withReceipt(), materializationPhase: 'mappings_persisted' as const }
    expect(reload([run]).runs[0].coordinatedQuarantine?.reason).toMatch(
      /forbids Dispatch IDs|forbids a completion receipt/
    )
  })

  it('refuses trust recorded without a receipt', () => {
    const run = { ...readyRun(), completionTrust: TRUST }
    expect(sealLoadedCoordinatedRun(run).run.coordinatedQuarantine?.reason).toMatch(
      /without a receipt/
    )
  })
})
