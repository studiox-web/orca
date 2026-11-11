import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { OrchestrationDb } from '../runtime/orchestration/db'
import type { AutomationRun } from '../../shared/automations-types'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import {
  CoordinatedAutomationAdapter,
  type CoordinatedWorkerIdentity
} from './coordinated-automation-adapter'
import {
  stageGateResolutionEligibility,
  stageRetryEligibility
} from './coordinated-automation-operator-eligibility'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => null }))

function makeWorkerResult(
  identity: CoordinatedWorkerIdentity,
  store: ReturnType<typeof createStore>,
  overrides: Partial<StructuredWorkerResult> = {}
): StructuredWorkerResult {
  const run = store.listAutomationRuns().find((r) => r.id === identity.automationRunId)
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
    resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} ok`,
    reportMarkdown: 'report',
    artifacts: [],
    checks: (run?.resolvedSnapshot?.outcomeContract.acceptanceCriteria ?? []).map((c) => ({
      id: c.id,
      outcome: 'passed' as const,
      evidence: [`${c.id} passed`]
    })),
    effects: [],
    blockers: [],
    ...overrides
  }
}

function operatorScope(run: AutomationRun) {
  return {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? null,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    targetExecutionAuthority: `${run.resolvedSnapshot!.executionTarget.type}:${run.resolvedSnapshot!.executionTarget.id}`
  }
}

describe('Coordinated Run Operator Actions', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-operator-test-'))
    writeDataFile(
      coordinatedTestState({
        repos: [
          {
            id: 'repo-local',
            path: testState.dir,
            displayName: 'Local',
            badgeColor: '#000',
            addedAt: 1
          }
        ]
      })
    )
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('stops a quiet run final as a dispatch failure and replays without new writes', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider: { capability: 'fake_no_effects', run: async () => ({}) }
    })
    const materialized = await adapter.materializeRun(run!.id)

    const stopped = await adapter.stopRun({ ...operatorScope(materialized), note: 'enough' })
    expect(stopped.state).toBe('failed')
    expect(stopped.reason).toContain('Operator stop requested')
    expect(stopped.reason).toContain('enough')
    const settled = store.listAutomationRuns().find((r) => r.id === run!.id)!
    expect(settled.status).toBe('dispatch_failed')
    const progress = adapter.inspectProgress(run!.id)!
    expect(progress.operatorStop).toMatchObject({ reason: 'enough' })
    expect(progress.operatorDecisions).toHaveLength(1)
    expect(stopped.disposition).toBe('recorded')
    // A replay after the stop settled the run is acknowledged and writes nothing further.
    const replay = await adapter.stopRun(operatorScope(settled))
    expect(replay.disposition).toBe('already_recorded')
    expect(adapter.inspectProgress(run!.id)!.operatorDecisions).toHaveLength(1)
    expect(adapter.inspectProgress(run!.id)!.operatorStop).toEqual(progress.operatorStop)
    db.close()
  })

  it('refuses a mismatched frozen scope before any progress write', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const adapter = new CoordinatedAutomationAdapter({ store, orchestrationDb: db })
    const materialized = await adapter.materializeRun(run!.id)

    await expect(
      adapter.stopRun({
        ...operatorScope(materialized),
        definitionRevision: materialized.resolvedSnapshot!.definitionRevision + 1
      })
    ).rejects.toThrow(/frozen revision/)
    await expect(
      adapter.stopRun({ ...operatorScope(materialized), targetExecutionAuthority: 'ssh:elsewhere' })
    ).rejects.toThrow(/frozen authority/)
    await expect(
      adapter.stopRun({ ...operatorScope(materialized), orchestrationRunId: 'run_foreign' })
    ).rejects.toThrow(/orchestration Run/)
    expect(adapter.inspectProgress(run!.id)).toBeNull()
    db.close()
  })

  it('fences retry and further dispatch after an operator stop settled the run', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('writer', { launchConfig: { maxRetries: 2 } })]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider: { capability: 'fake_no_effects', run: async () => ({}) }
    })
    const materialized = await adapter.materializeRun(run!.id)
    const stopped = await adapter.stopRun(operatorScope(materialized))
    expect(stopped.state).toBe('failed')

    const mapping = materialized.childMappings!.find((m) => m.childDefinitionId === 'writer')!
    await expect(
      adapter.retryStage({
        ...operatorScope(materialized),
        childDefinitionId: 'writer',
        taskId: mapping.taskId,
        retryOfDispatchId: 'dispatch_none'
      })
    ).rejects.toThrow(/already settled/)
    const again = await adapter.reconcileRun(run!.id)
    expect(['failed', 'outcome_uncertain']).toContain(again.state)
    const progress = adapter.inspectProgress(run!.id)!
    expect(progress.stages['writer'].lineage).toHaveLength(0)
    expect(db.getDispatchContext(mapping.taskId)).toBeUndefined()
    db.close()
  })

  it('retries exactly the named latest attempt within the bounded policy', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    let attempt = 0
    let holdLane = false
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider: {
        capability: 'fake_no_effects',
        run: async (identity) => {
          attempt += 1
          if (attempt === 1) {
            // Block the automatic retry inside the same reconcile so the operator retry owns it.
            holdLane = true
          }
          return makeWorkerResult(identity, store, {
            outcome: attempt === 1 ? 'failed' : 'succeeded',
            summary: attempt === 1 ? 'first attempt failed' : 'retry succeeded'
          })
        }
      },
      laneLocks: {
        tryAcquire: () =>
          holdLane
            ? { acquired: false, holder: 'foreign-owner' }
            : { acquired: true, release: () => {} }
      }
    })
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('writer', {
            mutationClass: 'exclusive_writer',
            launchConfig: { maxRetries: 2 }
          })
        ]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const materialized = await adapter.materializeRun(run!.id)
    const mapping = materialized.childMappings!.find((m) => m.childDefinitionId === 'writer')!

    const first = await adapter.reconcileRun(run!.id)
    expect(first.state).toBe('waiting')
    const firstDispatchId = db.getDispatchContext(mapping.taskId)!.id
    holdLane = false

    await expect(
      adapter.retryStage({
        ...operatorScope(materialized),
        childDefinitionId: 'writer',
        taskId: mapping.taskId,
        retryOfDispatchId: 'dispatch_stale'
      })
    ).rejects.toThrow(/latest attempt/)

    const retried = await adapter.retryStage({
      ...operatorScope(materialized),
      childDefinitionId: 'writer',
      taskId: mapping.taskId,
      retryOfDispatchId: firstDispatchId
    })
    expect(retried.state).toBe('completed')
    expect(retried.disposition).toBe('recorded')
    const progress = adapter.inspectProgress(run!.id)!
    expect(progress.stages['writer'].status).toBe('accepted')
    expect(progress.stages['writer'].lineage).toHaveLength(2)
    expect(
      progress.operatorDecisions!.some(
        (d) => d.kind === 'retry' && d.dispatchId === firstDispatchId
      )
    ).toBe(true)
    const retryDispatch = db.getDispatchContext(mapping.taskId)!
    expect(retryDispatch.id).not.toBe(firstDispatchId)
    db.close()
  })

  it('does not start a dependent reviewer when the writer is technically settled but semantically rejected', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('writer', {
            stageAcceptance: {
              requiredChecks: [{ id: 'quality-gate', description: 'Quality bar', required: true }]
            }
          }),
          child('reviewer', { dependencies: [{ childId: 'writer' }] })
        ]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const reviewer = vi.fn()
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider: {
        capability: 'fake_no_effects',
        run: async (identity) => {
          if (identity.childDefinitionId === 'reviewer') {
            reviewer(identity)
          }
          // The writer technically succeeds (valid envelope, succeeded outcome) but fails the
          // required stage check, so admission must reject it without unblocking the reviewer.
          return makeWorkerResult(identity, store, {
            checks: [{ id: 'quality-gate', outcome: 'failed', evidence: ['Below the bar'] }]
          })
        }
      }
    })
    const materialized = await adapter.materializeRun(run!.id)
    const outcome = await adapter.reconcileRun(materialized.id)
    expect(['failed', 'outcome_uncertain', 'waiting']).toContain(outcome.state)
    expect(reviewer).not.toHaveBeenCalled()
    const reviewerMapping = materialized.childMappings!.find(
      (m) => m.childDefinitionId === 'reviewer'
    )!
    expect(db.getDispatchContext(reviewerMapping.taskId)).toBeUndefined()
    expect(outcome.run.status).not.toBe('completed')
    db.close()
  })

  it('computes retry and gate eligibility from durable progress only', async () => {
    const store = createStore()
    const db = new OrchestrationDb(':memory:')
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('writer', {
            stageAcceptance: {
              requiredApprovals: [{ id: 'gate-1', role: 'reviewer', required: true }]
            }
          })
        ]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const adapter = new CoordinatedAutomationAdapter({ store, orchestrationDb: db })
    const materialized = await adapter.materializeRun(run!.id)
    db.close()
    // The frozen snapshot child is the only input eligibility accepts; never a live definition.
    const gatedChild = materialized.resolvedSnapshot!.resolvedChildren[0]
    const base = {
      schemaVersion: 1 as const,
      automationId: 'auto',
      definitionRevision: 1,
      executionAuthority: 'local:x',
      automationRunId: 'run',
      orchestrationRunId: 'orch',
      canonicalDigest: 'sha256:digest',
      sequence: 1,
      generation: 1,
      startedAt: 0,
      spentCostUsd: 0,
      dispatchStartFailures: 0,
      stages: {},
      reports: [],
      effects: {},
      escalations: [],
      halt: null
    }
    const progress = {
      ...base,
      stages: {
        writer: {
          status: 'pending' as const,
          activeDispatchId: null,
          acceptedDispatchId: null,
          acceptedReportDigest: null,
          acceptedArtifacts: [],
          attempts: 0,
          reopenings: 0,
          lineage: [],
          reviewIterations: 0,
          findings: [],
          lastError: null
        }
      }
    }
    expect(stageRetryEligibility({ progress, child: gatedChild, runSettled: false })).toEqual({
      canRetry: false,
      reason: 'This stage has no attempt to retry.',
      retryOfDispatchId: null
    })
    expect(
      stageGateResolutionEligibility({ progress, child: gatedChild, runSettled: false })
    ).toEqual({
      canResolve: true,
      reason: null,
      pendingGateId: 'gate-1',
      pendingGateIds: ['gate-1'],
      approvableDispatchId: null
    })
    const stopped = { ...progress, operatorStop: { at: 5, reason: null } }
    expect(
      stageRetryEligibility({ progress: stopped, child: gatedChild, runSettled: false })
    ).toEqual({
      canRetry: false,
      reason: 'The run is stopping; a retry could fork unknown side effects.',
      retryOfDispatchId: null
    })
    // An approval speaks for one attempt: it resolves the gate only while that attempt is current.
    const attempt = (dispatchId: string, attemptNumber: number) => ({
      attemptNumber,
      kind: 'initial' as const,
      dispatchId,
      retryOfDispatchId: null,
      previousLatestDispatchId: null,
      startedAt: 1,
      deadlineAt: 2,
      leaseKeys: [],
      status: 'active' as const
    })
    const approval = {
      scope: 'stage' as const,
      approvalId: 'gate-1',
      role: 'reviewer',
      approverIdentity: 'local_operator',
      approvedAt: 9,
      automationId: 'auto',
      definitionRevision: 1,
      automationRunId: 'run',
      orchestrationRunId: 'orch',
      childDefinitionId: 'writer',
      taskId: 'task',
      dispatchId: 'ctx_first'
    }
    const held = (dispatchId: string, reportDigest: string) => ({
      dispatchId,
      reportDigest,
      gateIds: ['gate-1'],
      since: 3
    })
    const digest = `sha256:${'a'.repeat(64)}`
    // A held report is the only thing an approval can bind.
    const waiting = {
      ...progress,
      stages: {
        writer: {
          ...progress.stages.writer,
          lineage: [attempt('ctx_first', 1)],
          pendingApproval: held('ctx_first', digest)
        }
      }
    }
    expect(
      stageGateResolutionEligibility({ progress: waiting, child: gatedChild, runSettled: false })
    ).toEqual({
      canResolve: true,
      reason: null,
      pendingGateId: 'gate-1',
      pendingGateIds: ['gate-1'],
      approvableDispatchId: 'ctx_first'
    })
    const approved = { ...waiting, approvals: [{ ...approval, reportDigest: digest }] }
    expect(
      stageGateResolutionEligibility({ progress: approved, child: gatedChild, runSettled: false })
    ).toMatchObject({ canResolve: false, pendingGateIds: [] })
    // The same attempt now holds different report bytes: the approval no longer speaks for it.
    const changedReport = {
      ...approved,
      stages: {
        writer: {
          ...waiting.stages.writer,
          pendingApproval: held('ctx_first', `sha256:${'b'.repeat(64)}`)
        }
      }
    }
    expect(
      stageGateResolutionEligibility({
        progress: changedReport,
        child: gatedChild,
        runSettled: false
      })
    ).toMatchObject({ canResolve: true, pendingGateIds: ['gate-1'] })
    // A later attempt supersedes the approved one entirely.
    const superseded = {
      ...approved,
      stages: {
        writer: {
          ...progress.stages.writer,
          lineage: [
            { ...attempt('ctx_first', 1), status: 'admitted' as const },
            attempt('ctx_second', 2)
          ]
        }
      }
    }
    expect(
      stageGateResolutionEligibility({ progress: superseded, child: gatedChild, runSettled: false })
    ).toMatchObject({
      canResolve: true,
      pendingGateIds: ['gate-1'],
      approvableDispatchId: null
    })
  })
})
