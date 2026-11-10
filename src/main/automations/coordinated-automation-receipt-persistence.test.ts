import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  CoordinatedAutomationLaunchRefusedError,
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

  it('returns byte-identical completionReceipt on duplicate coordinator replay across reload with zero side effects and fails closed on missing receipt', async () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [child('worker_1', { name: 'Worker 1' })]
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 12000
    })

    const workerRunSpy = vi.fn(async (id: CoordinatedWorkerIdentity) => makeWorkerResult(id, store))
    const workerProvider: CoordinatedWorkerProvider = {
      capability: 'fake_no_effects',
      run: workerRunSpy
    }

    const adapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider
    })

    const completed = await adapter.runUntilSettled(run!.id)
    expect(completed.status).toBe('completed')
    expect(completed.completionReceipt).toBeDefined()
    expect(completed.completionTrust).toBeDefined()
    expect(workerRunSpy).toHaveBeenCalledTimes(1)

    const originalReceiptBytes = JSON.stringify(completed.completionReceipt)
    const originalTrustBytes = JSON.stringify(completed.completionTrust)

    // In-memory duplicate coordinator replay: no new acceptance, Date.now, promotion, dispatch, or settlement
    const createDispatchSpy = vi.spyOn(db, 'createStartingWorkerDispatch')
    const promoteSpy = vi.spyOn(db, 'promoteReadyTasks')
    const settleReportSpy = vi.spyOn(db, 'settleWorkerReport')
    const recordSettlementSpy = vi.spyOn(store, 'recordCoordinatedRunSettlement')

    const replayedInMemory = await adapter.runUntilSettled(run!.id)
    expect(replayedInMemory.status).toBe('completed')
    expect(JSON.stringify(replayedInMemory.completionReceipt)).toBe(originalReceiptBytes)
    expect(JSON.stringify(replayedInMemory.completionTrust)).toBe(originalTrustBytes)
    expect(await adapter.dispatchReadyTasks(run!.id)).toEqual([])
    expect(workerRunSpy).toHaveBeenCalledTimes(1)
    expect(createDispatchSpy).not.toHaveBeenCalled()
    expect(promoteSpy).not.toHaveBeenCalled()
    expect(settleReportSpy).not.toHaveBeenCalled()
    expect(recordSettlementSpy).not.toHaveBeenCalled()

    // Reload from disk and replay again
    await closeTestStores()
    const reloadedStore = createStore()
    const reloadSettlementSpy = vi.spyOn(reloadedStore, 'recordCoordinatedRunSettlement')
    const reloadedAdapter = new CoordinatedAutomationAdapter({
      store: reloadedStore,
      orchestrationDb: db,
      workerProvider
    })

    const replayedAfterReload = await reloadedAdapter.runUntilSettled(run!.id)
    expect(replayedAfterReload.status).toBe('completed')
    expect(JSON.stringify(replayedAfterReload.completionReceipt)).toBe(originalReceiptBytes)
    expect(JSON.stringify(replayedAfterReload.completionTrust)).toBe(originalTrustBytes)
    expect(workerRunSpy).toHaveBeenCalledTimes(1)
    expect(createDispatchSpy).not.toHaveBeenCalled()
    expect(promoteSpy).not.toHaveBeenCalled()
    expect(settleReportSpy).not.toHaveBeenCalled()
    expect(reloadSettlementSpy).not.toHaveBeenCalled()

    // Missing receipt on a completed run must fail closed on replay
    await closeTestStores()
    const raw = JSON.parse(readPersistedStateJson()) as PersistedState
    const targetRun = raw.automationRuns.find((r) => r.id === run!.id)!
    targetRun.completionReceipt = null
    delete targetRun.completionTrust
    writePersistedStateJson(dataFile(), JSON.stringify(raw, null, 2))

    const brokenStore = createStore()
    const brokenAdapter = new CoordinatedAutomationAdapter({
      store: brokenStore,
      orchestrationDb: db,
      workerProvider
    })
    await expect(brokenAdapter.runUntilSettled(run!.id)).rejects.toThrow(
      CoordinatedAutomationLaunchRefusedError
    )
  })

  it('enforces exact approvalId, role, run identity, and scope for stage and parent approvals (wrong-ID/same-role, wrong-scope, foreign-run, duplicate, missing, and positive)', async () => {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('step_1', {
            name: 'Step 1',
            stageAcceptance: {
              requiredApprovals: [{ id: 'stage_appr_1', role: 'reviewer', required: true }]
            }
          })
        ],
        outcomeContract: {
          humanStatement: 'Approved parent outcome',
          acceptanceCriteria: [],
          requiredApprovals: [{ id: 'parent_appr_1', role: 'publisher', targetChildId: 'step_1' }],
          allowedFinalStates: ['completed', 'failed']
        }
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 13000
    })

    const workerProvider: CoordinatedWorkerProvider = {
      capability: 'fake_no_effects',
      run: async (id) => makeWorkerResult(id, store)
    }

    // 1. Missing stage approval
    const missingStageAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider
    })
    const missingStageRun = await missingStageAdapter.runUntilSettled(run!.id)
    expect(missingStageRun.status).toBe('dispatch_failed')
    const orchRunId = missingStageRun.orchestrationRunId!
    let task = db.listTasks({ runId: orchRunId })[0]
    expect(task.result).toContain(
      'Required stage approval "stage_appr_1" (role "reviewer") missing'
    )

    // 2. Stage wrong-ID / same-role
    const wrongIdStageAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        {
          approvalId: 'wrong_stage_id',
          role: 'reviewer',
          approverIdentity: 'rev@orca.test',
          approvedAt: 1000,
          automationRunId: run!.id,
          orchestrationRunId: orchRunId,
          scope: 'stage',
          childDefinitionId: 'step_1'
        }
      ]
    })
    await wrongIdStageAdapter.retryTask({
      automationRunId: run!.id,
      taskId: task.id,
      retryOfDispatchId: db.getDispatchContext(task.id)!.id
    })
    task = db.getTask(task.id)!
    expect(task.result).toContain(
      'Required stage approval "stage_appr_1" (role "reviewer") missing'
    )

    // 3. Stage wrong-scope (parent scope or wrong childDefinitionId)
    const wrongScopeStageAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        {
          approvalId: 'stage_appr_1',
          role: 'reviewer',
          approverIdentity: 'rev@orca.test',
          approvedAt: 1000,
          automationRunId: run!.id,
          orchestrationRunId: orchRunId,
          scope: 'parent',
          childDefinitionId: 'step_1'
        }
      ]
    })
    await wrongScopeStageAdapter.retryTask({
      automationRunId: run!.id,
      taskId: task.id,
      retryOfDispatchId: db.getDispatchContext(task.id)!.id
    })
    task = db.getTask(task.id)!
    expect(task.result).toContain('Stage approval "stage_appr_1" has wrong scope')

    // 4. Stage foreign-run
    const foreignRunStageAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        {
          approvalId: 'stage_appr_1',
          role: 'reviewer',
          approverIdentity: 'rev@orca.test',
          approvedAt: 1000,
          automationRunId: 'run_foreign_999',
          orchestrationRunId: orchRunId,
          scope: 'stage',
          childDefinitionId: 'step_1'
        }
      ]
    })
    await foreignRunStageAdapter.retryTask({
      automationRunId: run!.id,
      taskId: task.id,
      retryOfDispatchId: db.getDispatchContext(task.id)!.id
    })
    task = db.getTask(task.id)!
    expect(task.result).toContain(
      'Stage approval "stage_appr_1" belongs to foreign or missing automationRunId'
    )

    // 5. Stage duplicate approvalId
    const validStageApproval = {
      approvalId: 'stage_appr_1',
      role: 'reviewer',
      approverIdentity: 'rev@orca.test',
      approvedAt: 1000,
      automationRunId: run!.id,
      orchestrationRunId: orchRunId,
      scope: 'stage' as const,
      childDefinitionId: 'step_1'
    }
    const duplicateStageAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        validStageApproval,
        { ...validStageApproval, approverIdentity: 'rev2@orca.test' }
      ]
    })
    await duplicateStageAdapter.retryTask({
      automationRunId: run!.id,
      taskId: task.id,
      retryOfDispatchId: db.getDispatchContext(task.id)!.id
    })
    task = db.getTask(task.id)!
    expect(task.result).toContain('Duplicate host approval for stage requirement "stage_appr_1"')

    // 6. Stage positive + Parent missing approval
    const stageOnlyAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [validStageApproval]
    })
    await stageOnlyAdapter.retryTask({
      automationRunId: run!.id,
      taskId: task.id,
      retryOfDispatchId: db.getDispatchContext(task.id)!.id
    })
    expect(db.getTask(task.id)?.status).toBe('completed')
    let parentCheck = await stageOnlyAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('dispatch_failed')
    expect(parentCheck.error).toContain(
      'Required approval "parent_appr_1" (role "publisher") is missing from host approvals'
    )

    // 7. Parent wrong-ID / same-role
    const parentWrongIdAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        validStageApproval,
        {
          approvalId: 'wrong_parent_id',
          role: 'publisher',
          approverIdentity: 'pub@orca.test',
          approvedAt: 2000,
          automationRunId: run!.id,
          orchestrationRunId: orchRunId,
          scope: 'parent',
          targetChildId: 'step_1'
        }
      ]
    })
    parentCheck = await parentWrongIdAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('dispatch_failed')
    expect(parentCheck.error).toContain(
      'Required approval "parent_appr_1" (role "publisher") is missing from host approvals'
    )

    // 8. Parent wrong-scope (wrong targetChildId or stage scope)
    const parentWrongScopeAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        validStageApproval,
        {
          approvalId: 'parent_appr_1',
          role: 'publisher',
          approverIdentity: 'pub@orca.test',
          approvedAt: 2000,
          automationRunId: run!.id,
          orchestrationRunId: orchRunId,
          scope: 'parent',
          targetChildId: 'other_child'
        }
      ]
    })
    parentCheck = await parentWrongScopeAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('dispatch_failed')
    expect(parentCheck.error).toContain(
      'Parent approval "parent_appr_1" has wrong targetChildId scope'
    )

    // 9. Parent foreign-run
    const parentForeignRunAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        validStageApproval,
        {
          approvalId: 'parent_appr_1',
          role: 'publisher',
          approverIdentity: 'pub@orca.test',
          approvedAt: 2000,
          automationRunId: 'run_foreign_parent',
          orchestrationRunId: orchRunId,
          scope: 'parent',
          targetChildId: 'step_1'
        }
      ]
    })
    parentCheck = await parentForeignRunAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('dispatch_failed')
    expect(parentCheck.error).toContain(
      'Parent approval "parent_appr_1" belongs to foreign or missing automationRunId'
    )

    // 10. Parent duplicate
    const validParentApproval = {
      approvalId: 'parent_appr_1',
      role: 'publisher',
      approverIdentity: 'pub@orca.test',
      approvedAt: 2000,
      automationRunId: run!.id,
      orchestrationRunId: orchRunId,
      scope: 'parent' as const,
      targetChildId: 'step_1'
    }
    const parentDuplicateAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [
        validStageApproval,
        validParentApproval,
        { ...validParentApproval, approverIdentity: 'pub2@orca.test' }
      ]
    })
    parentCheck = await parentDuplicateAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('dispatch_failed')
    expect(parentCheck.error).toContain('Duplicate host approval for requirement "parent_appr_1"')

    // 11. Parent positive
    const validAdapter = new CoordinatedAutomationAdapter({
      store,
      orchestrationDb: db,
      workerProvider,
      hostApprovals: [validStageApproval, validParentApproval]
    })
    parentCheck = await validAdapter.runUntilSettled(run!.id)
    expect(parentCheck.status).toBe('completed')
    expect(parentCheck.completionReceipt?.approvals).toEqual([
      {
        approvalId: 'parent_appr_1',
        role: 'publisher',
        approverIdentity: 'pub@orca.test',
        approvedAt: 2000
      }
    ])
  })

  it('rejects symlinks to outside files and outside directories while accepting valid in-workspace artifacts', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'coord-outside-escape-'))
    try {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_artifact', {
              name: 'Artifact Step',
              stageAcceptance: {
                requiredArtifacts: [{ kind: 'bundle', pathPattern: 'dist/*.js', required: true }]
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 14000
      })

      const content = 'console.log("trusted bundle");'
      const validSha256 = `sha256:${createHash('sha256').update(content).digest('hex')}`

      // Create outside file and outside subdirectory
      const outsideFile = join(outsideDir, 'outside-secret.js')
      writeFileSync(outsideFile, content)
      const outsideSubdir = join(outsideDir, 'outside-dist')
      mkdirSync(outsideSubdir, { recursive: true })
      writeFileSync(join(outsideSubdir, 'bundle.js'), content)

      // 1. Symlink-to-outside file inside workspace/dist/bundle.js
      mkdirSync(join(testState.dir, 'dist'), { recursive: true })
      symlinkSync(outsideFile, join(testState.dir, 'dist', 'bundle.js'))

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (id) =>
          makeWorkerResult(id, store, {
            artifacts: [{ kind: 'bundle', uri: 'dist/bundle.js', sha256: validSha256 }]
          })
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider,
        workspacePath: testState.dir
      })

      const symlinkFileRun = await adapter.runUntilSettled(run!.id)
      expect(symlinkFileRun.status).toBe('dispatch_failed')
      let task = db.listTasks({ runId: symlinkFileRun.orchestrationRunId! })[0]
      expect(task.result).toContain('escapes workspace path via symlink or indirection')

      // 2. Symlink-to-outside directory at workspace/dist -> outsideSubdir
      rmSync(join(testState.dir, 'dist'), { recursive: true, force: true })
      symlinkSync(outsideSubdir, join(testState.dir, 'dist'))

      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.status).toBe('failed')
      expect(task.result).toContain('escapes workspace path via symlink or indirection')

      // 3. Valid in-workspace fixture
      rmSync(join(testState.dir, 'dist'), { recursive: true, force: true })
      mkdirSync(join(testState.dir, 'dist'), { recursive: true })
      writeFileSync(join(testState.dir, 'dist', 'bundle.js'), content)

      const validRetry = await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      expect(validRetry.outcome).toBe('succeeded')
      expect(db.getTask(task.id)?.status).toBe('completed')
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
