import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  closeTestStores,
  createStore,
  dataFile,
  readPersistedStateJson,
  testState,
  writeDataFile,
  writePersistedStateJson
} from '../persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { OrchestrationDb } from '../runtime/orchestration/db'
import {
  CoordinatedAutomationAdapter,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider
} from './coordinated-automation-adapter'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { PersistedState } from '../../shared/persisted-state-types'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

function makeWorkerResult(
  identity: CoordinatedWorkerIdentity,
  store: ReturnType<typeof createStore>,
  overrides?: Partial<StructuredWorkerResult> & Record<string, unknown>
): StructuredWorkerResult {
  const run = store.listAutomationRuns().find((r) => r.id === identity.automationRunId)
  const criteria = run?.resolvedSnapshot?.outcomeContract.acceptanceCriteria ?? []
  const defaultChecks = criteria.map((c) => ({
    id: c.id,
    outcome: 'passed' as const,
    evidence: [`Criterion ${c.id} verified passed`]
  }))
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
    resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} completed`,
    reportMarkdown: `Report for ${identity.childDefinitionId}`,
    artifacts: [],
    checks: defaultChecks,
    effects: [],
    blockers: [],
    ...overrides
  } as StructuredWorkerResult
}

describe('Coordinated Parent Completion Receipt and Trust Persistence', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-receipt-test-'))
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
    db = new OrchestrationDb(':memory:')
  })

  afterEach(async () => {
    db.close()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('persists completionReceipt and completionTrust on parent completion and survives disk reload intact', async () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('worker_1', { name: 'Worker 1' })],
        outcomeContract: {
          humanStatement: 'Reviewed article is ready.',
          acceptanceCriteria: [
            {
              id: 'article-reviewed',
              description: 'Article reviewed',
              required: true,
              kind: 'custom'
            }
          ],
          requiredApprovals: [],
          allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
        }
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 8000
    })

    const workerProvider: CoordinatedWorkerProvider = {
      capability: 'fake_no_effects',
      run: async (id) =>
        makeWorkerResult(id, store, {
          outcome: 'succeeded',
          checks: [
            {
              id: 'article-reviewed',
              outcome: 'passed',
              evidence: ['Article reviewed and verified']
            }
          ]
        })
    }

    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider
    })

    const completedRun = await adapter.runUntilSettled(run!.id)
    expect(completedRun.status).toBe('completed')
    expect(completedRun.error).toBeNull()
    expect(completedRun.completionReceipt).toBeDefined()
    expect(completedRun.completionTrust).toBeDefined()
    expect(completedRun.completionTrust?.authorIdentity).toBe('host_service')
    expect(completedRun.completionReceipt?.finalState).toBe('completed')
    expect(completedRun.coordinatedQuarantine).toBeUndefined()

    // Now reload the store from disk to prove survival
    await closeTestStores()
    const reloadedStore = createStore()
    const reloadedRun = reloadedStore.listAutomationRuns().find((r) => r.id === run!.id)!

    expect(reloadedRun.status).toBe('completed')
    expect(reloadedRun.completionReceipt).toEqual(completedRun.completionReceipt)
    expect(reloadedRun.completionTrust).toEqual(completedRun.completionTrust)
    expect(reloadedRun.coordinatedQuarantine).toBeUndefined()
  })

  it('fails closed and refuses settlement as completed without trusted receipt and trust', () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('w1', { name: 'W1' })]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 9000
    })

    // Advance to ready_for_dispatch
    const probe = {
      hasRun: () => true,
      hasTask: () => true
    }
    store.linkCoordinatedOrchestrationRun({
      automationRunId: run!.id,
      orchestrationRunId: 'run_test_settle',
      probe
    })
    store.recordCoordinatedTasksCreated({
      automationRunId: run!.id,
      taskIds: ['task_test_settle'],
      probe
    })
    store.persistCoordinatedChildMappings({
      automationRunId: run!.id,
      mappings: [{ childDefinitionId: 'w1', taskId: 'task_test_settle' }],
      probe
    })
    store.markCoordinatedRunReadyForDispatch({
      automationRunId: run!.id,
      probe
    })

    expect(() =>
      store.recordCoordinatedRunSettlement({
        automationRunId: run!.id,
        status: 'completed'
      })
    ).toThrow('without trusted completionReceipt and completionTrust')
  })

  it('fails closed and quarantines run on reload when completionReceipt is foreign or tampered', async () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('worker_1', { name: 'Worker 1' })]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 10000
    })

    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db
    })

    const completed = await adapter.runUntilSettled(run!.id)
    expect(completed.status).toBe('completed')
    await closeTestStores()

    // Tamper with completion receipt in the persisted state file
    const raw = JSON.parse(readPersistedStateJson()) as PersistedState
    const targetRun = raw.automationRuns.find((r) => r.id === run!.id)!
    targetRun.completionReceipt!.frozenConfigDigest = `sha256:${'f'.repeat(64)}`
    writePersistedStateJson(dataFile(), JSON.stringify(raw, null, 2))

    // Reload store
    const reloadedStore = createStore()
    const quarantined = reloadedStore.listAutomationRuns().find((r) => r.id === run!.id)!
    expect(quarantined.coordinatedQuarantine).toBeDefined()
    expect(quarantined.coordinatedQuarantine?.reason).toContain(
      "Completion receipt is not this run's"
    )
  })

  it('fails closed and quarantines run on reload when completionTrust is missing on a completed run', async () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('worker_1', { name: 'Worker 1' })]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 11000
    })

    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db
    })

    const completed = await adapter.runUntilSettled(run!.id)
    expect(completed.status).toBe('completed')
    await closeTestStores()

    // Delete completionTrust from persisted state file
    const raw = JSON.parse(readPersistedStateJson()) as PersistedState
    const targetRun = raw.automationRuns.find((r) => r.id === run!.id)!
    delete targetRun.completionTrust
    writePersistedStateJson(dataFile(), JSON.stringify(raw, null, 2))

    // Reload store
    const reloadedStore = createStore()
    const quarantined = reloadedStore.listAutomationRuns().find((r) => r.id === run!.id)!
    expect(quarantined.coordinatedQuarantine).toBeDefined()
    expect(quarantined.coordinatedQuarantine?.reason).toContain(
      'A completion receipt needs a valid host-recorded completion trust record'
    )
  })
})
