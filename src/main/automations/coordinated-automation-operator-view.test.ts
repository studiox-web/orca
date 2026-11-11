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
import { createMemoryCoordinatedRunProgressStore } from './coordinated-automation-progress-store'
import { inspectCoordinatedRun } from './coordinated-automation-run-inspection'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => null }))

type TestStore = ReturnType<typeof createStore>

function report(
  identity: CoordinatedWorkerIdentity,
  store: TestStore,
  overrides: Partial<StructuredWorkerResult> = {}
): StructuredWorkerResult {
  const snapshot = store
    .listAutomationRuns()
    .find((r) => r.id === identity.automationRunId)!.resolvedSnapshot!
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: snapshot.definitionRevision,
    resolvedConfigDigest: snapshot.canonicalDigest,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} ok`,
    reportMarkdown: 'report',
    artifacts: [],
    checks: snapshot.outcomeContract.acceptanceCriteria.map((c) => ({
      id: c.id,
      outcome: 'passed' as const,
      evidence: [`${c.id} passed`]
    })),
    effects: [],
    blockers: [],
    ...overrides
  }
}

function scope(run: AutomationRun) {
  return {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? null,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    targetExecutionAuthority: `${run.resolvedSnapshot!.executionTarget.type}:${run.resolvedSnapshot!.executionTarget.id}`
  }
}

describe('coordinated operator view and scoped decisions', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-operator-view-'))
    writeDataFile(
      coordinatedTestState({
        repos: [
          {
            id: 'repo-local',
            path: testState.dir,
            displayName: 'L',
            badgeColor: '#000',
            addedAt: 1
          }
        ]
      })
    )
    db = new OrchestrationDb(':memory:')
  })

  afterEach(async () => {
    db.close()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  async function start(
    store: TestStore,
    input: Parameters<typeof coordinatedCreateInput>[0],
    run: (identity: CoordinatedWorkerIdentity) => Promise<unknown>
  ) {
    const progressStore = createMemoryCoordinatedRunProgressStore()
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      progressStore,
      workerProvider: { capability: 'fake_no_effects', run }
    })
    const automation = store.createCoordinatedAutomation(coordinatedCreateInput(input))
    const created = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const materialized = await adapter.materializeRun(created.run!.id)
    const inspect = () =>
      inspectCoordinatedRun({
        run: store.listAutomationRuns().find((r) => r.id === materialized.id)!,
        orchestrationDb: db,
        progressStore
      })
    return { adapter, run: materialized, inspect, progressStore }
  }

  it('binds one gate id per scope and lists pending decisions with their scope', async () => {
    const store = createStore()
    const base = coordinatedCreateInput()
    const laneHeld = true
    const progressStore = createMemoryCoordinatedRunProgressStore()
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      progressStore,
      workerProvider: {
        capability: 'fake_no_effects',
        run: async (identity) => report(identity, store)
      },
      // The writer cannot start until both decisions are in, so the run stays open for them.
      laneLocks: {
        tryAcquire: () =>
          laneHeld
            ? { acquired: false, holder: 'foreign-owner' }
            : { acquired: true, release: () => {} }
      }
    })
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        outcomeContract: {
          humanStatement: 'One reviewed article is ready.',
          acceptanceCriteria: base.outcomeContract?.acceptanceCriteria ?? [],
          requiredApprovals: [{ id: 'signoff', role: 'editor' }],
          allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
        },
        children: [
          child('writer', {
            mutationClass: 'exclusive_writer',
            stageAcceptance: { requiredApprovals: [{ id: 'signoff', role: 'reviewer' }] }
          })
        ]
      })
    )
    const created = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const run = await adapter.materializeRun(created.run!.id)
    const inspect = () =>
      inspectCoordinatedRun({
        run: store.listAutomationRuns().find((r) => r.id === run.id)!,
        orchestrationDb: db,
        progressStore
      })
    expect((await adapter.reconcileRun(run.id)).state).toBe('waiting')
    expect(inspect().humanResolution.pendingDecisions).toEqual([
      { gateId: 'signoff', scope: 'parent', childDefinitionId: null },
      { gateId: 'signoff', scope: 'stage', childDefinitionId: 'writer' }
    ])

    const parent = await adapter.resolveGate({
      ...scope(run),
      gateId: 'signoff',
      gateScope: 'parent',
      decision: 'approve'
    })
    expect(parent.disposition).toBe('recorded')
    const afterParent = inspect()
    expect(afterParent.approvals.parent[0].status).toBe('approved')
    expect(afterParent.approvals.stage[0].status).toBe('pending')
    expect(afterParent.humanResolution.pendingDecisions).toEqual([
      { gateId: 'signoff', scope: 'stage', childDefinitionId: 'writer' }
    ])
    expect(afterParent.stages[0].gateResolutionEligibility.pendingGateIds).toEqual(['signoff'])

    expect(afterParent.stages[0].gateResolutionEligibility.approvableDispatchId).toBeNull()

    // Without a scope the host binds stage-first, which still requires the exact stage.
    await expect(
      adapter.resolveGate({ ...scope(run), gateId: 'signoff', decision: 'approve' })
    ).rejects.toThrow(/belongs to stage "writer"/)
    // A stage approval that names no exact Dispatch and report digest fails closed.
    await expect(
      adapter.resolveGate({
        ...scope(run),
        gateId: 'signoff',
        decision: 'approve',
        childDefinitionId: 'writer'
      })
    ).rejects.toThrow(/must name the exact Dispatch and report digest/)
    // Naming evidence the host does not hold is refused too: nothing has reported yet.
    await expect(
      adapter.resolveGate({
        ...scope(run),
        gateId: 'signoff',
        decision: 'approve',
        childDefinitionId: 'writer',
        dispatchId: 'ctx_never_launched',
        expectedReportDigest: `sha256:${'0'.repeat(64)}`
      })
    ).rejects.toThrow(/binds Dispatch|awaiting approval/)
    const replay = await adapter.resolveGate({
      ...scope(run),
      gateId: 'signoff',
      gateScope: 'parent',
      decision: 'approve'
    })
    expect(replay.disposition).toBe('already_recorded')
    expect(adapter.inspectProgress(run.id)!.approvals!.map((a) => a.scope)).toEqual(['parent'])
    expect(laneHeld).toBe(true)
  })

  it('acknowledges a replayed exact retry without dispatching a second retry', async () => {
    const store = createStore()
    let attempt = 0
    let holdLane = true
    const progressStore = createMemoryCoordinatedRunProgressStore()
    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      progressStore,
      workerProvider: {
        capability: 'fake_no_effects',
        run: async (identity) => {
          attempt += 1
          return report(identity, store, { outcome: attempt === 1 ? 'failed' : 'succeeded' })
        }
      },
      // Released for the first attempt only, so the automatic retry waits for the operator.
      laneLocks: {
        tryAcquire: () => {
          if (attempt === 0 || !holdLane) {
            return { acquired: true, release: () => {} }
          }
          return { acquired: false, holder: 'foreign-owner' }
        }
      }
    })
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('writer', { mutationClass: 'exclusive_writer', launchConfig: { maxRetries: 2 } })
        ]
      })
    )
    const created = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const run = await adapter.materializeRun(created.run!.id)
    const taskId = run.childMappings![0].taskId
    await adapter.reconcileRun(run.id)
    const firstDispatchId = db.getDispatchContext(taskId)!.id
    holdLane = false

    const retry = {
      ...scope(run),
      childDefinitionId: 'writer',
      taskId,
      retryOfDispatchId: firstDispatchId
    }
    const retried = await adapter.retryStage(retry)
    expect(retried.disposition).toBe('recorded')
    const retryDispatchId = db.getDispatchContext(taskId)!.id
    expect(retryDispatchId).not.toBe(firstDispatchId)

    const replay = await adapter.retryStage(retry)
    expect(replay.disposition).toBe('already_recorded')
    expect(db.getDispatchContext(taskId)!.id).toBe(retryDispatchId)
    expect(attempt).toBe(2)
    expect(
      adapter.inspectProgress(run.id)!.operatorDecisions!.filter((d) => d.kind === 'retry')
    ).toHaveLength(1)
  })

  it('shows the latest admitted report evidence only while the native result still matches', async () => {
    const store = createStore()
    const { adapter, run, inspect } = await start(
      store,
      {
        children: [
          child('writer', {
            stageAcceptance: {
              requiredChecks: [{ id: 'quality-gate', description: 'Quality bar', required: true }]
            }
          })
        ]
      },
      async (identity) =>
        report(identity, store, {
          artifacts: [
            { kind: 'draft', uri: 'drafts/article.md', sha256: `sha256:${'a'.repeat(64)}` }
          ],
          checks: [{ id: 'quality-gate', outcome: 'failed', evidence: ['Below the bar'] }],
          blockers: [{ code: 'needs_sources', message: 'Two sources missing.' }]
        })
    )
    expect(inspect().stages[0].evidence.kind).toBe('absent')
    await adapter.reconcileRun(run.id)

    const view = inspect()
    expect(view.targetExecutionAuthority).toBe(scope(run).targetExecutionAuthority)
    expect(view.activeStageIds).toEqual([])
    const stage = view.stages[0]
    expect(stage.evidence).toMatchObject({
      kind: 'available',
      disposition: 'rejected',
      outcome: 'succeeded',
      artifacts: [{ kind: 'draft', uri: 'drafts/article.md', sha256: `sha256:${'a'.repeat(64)}` }],
      checks: [{ id: 'quality-gate', outcome: 'failed', evidence: ['Below the bar'] }],
      blockers: [{ code: 'needs_sources', message: 'Two sources missing.' }]
    })
    expect(stage.semantic).toMatchObject({ kind: 'available', acceptedDispatchId: null })

    // Bytes that no longer match the admitted digest are never re-described.
    db.updateTaskStatus(run.childMappings![0].taskId, 'failed', 'rewritten result')
    expect(inspect().stages[0].evidence).toMatchObject({ kind: 'unavailable' })
  })
})
