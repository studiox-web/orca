import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
import {
  CoordinatedAutomationAdapter,
  CoordinatedAutomationLaunchRefusedError,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider
} from './coordinated-automation-adapter'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

function makeReport(
  identity: CoordinatedWorkerIdentity,
  store: ReturnType<typeof createStore>,
  overrides?: Partial<StructuredWorkerResult>
): StructuredWorkerResult {
  const run = store.listAutomationRuns().find((r) => r.id === identity.automationRunId)
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
    resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} done`,
    reportMarkdown: `${identity.childDefinitionId} report`,
    artifacts: [],
    checks: [],
    effects: [],
    blockers: [],
    ...overrides
  }
}

describe('CoordinatedAutomationAdapter Failure Injection & Resilience', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-fail-test-'))
    writeDataFile(coordinatedTestState())
    db = new OrchestrationDb(':memory:')
  })

  afterEach(async () => {
    db.close()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  describe('crash and write failure idempotency and reconciliation', () => {
    it('reconciles without duplicate runs when store write fails after native run creation', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker_a', { name: 'Worker A' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: async (id) => makeReport(id, store) }
      })

      const origLink = store.linkCoordinatedOrchestrationRun.bind(store)
      let linkFailedOnce = false
      vi.spyOn(store, 'linkCoordinatedOrchestrationRun').mockImplementation((input) => {
        if (!linkFailedOnce) {
          linkFailedOnce = true
          throw new Error('Simulated crash / store write failure after native run create')
        }
        return origLink(input)
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(
        'Simulated crash / store write failure after native run create'
      )

      const runsInDbAfterFailure = db.listRuns().runs.filter((r) => r.id !== 'run_legacy_local')
      expect(runsInDbAfterFailure).toHaveLength(1)
      expect(runsInDbAfterFailure[0].id).toBe(`run_${run!.id}`)

      const materialized = await adapter.materializeRun(run!.id)
      expect(materialized.materializationPhase).toBe('ready_for_dispatch')
      expect(materialized.orchestrationRunId).toBe(`run_${run!.id}`)

      const runsInDbAfterRetry = db.listRuns().runs.filter((r) => r.id !== 'run_legacy_local')
      expect(runsInDbAfterRetry).toHaveLength(1)
    })

    it('reconciles without duplicate tasks when crash occurs between task creations', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('child_1', { name: 'Child 1' }), child('child_2', { name: 'Child 2' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: async (id) => makeReport(id, store) }
      })

      const origCreateTask = db.createTask.bind(db)
      let taskCallCount = 0
      vi.spyOn(db, 'createTask').mockImplementation((input) => {
        taskCallCount++
        if (taskCallCount === 2) {
          throw new Error('Simulated crash during second task creation')
        }
        return origCreateTask(input)
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(
        'Simulated crash during second task creation'
      )

      const tasksAfterFailure = db.listTasks({ runId: `run_${run!.id}` })
      expect(tasksAfterFailure).toHaveLength(1)
      expect(tasksAfterFailure[0].id).toBe(`task_run_${run!.id}_child_1`)

      vi.restoreAllMocks()

      const materialized = await adapter.materializeRun(run!.id)
      expect(materialized.materializationPhase).toBe('ready_for_dispatch')

      const tasksAfterRetry = db.listTasks({ runId: `run_${run!.id}` })
      expect(tasksAfterRetry).toHaveLength(2)
      const taskIds = tasksAfterRetry.map((t) => t.id).sort()
      expect(taskIds).toEqual([`task_run_${run!.id}_child_1`, `task_run_${run!.id}_child_2`])
    })

    it('idempotently reconciles across intermediate phases (tasks_created and mappings_persisted)', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker', { name: 'Worker' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: async (id) => makeReport(id, store) }
      })

      const run1 = await adapter.materializeRun(run!.id)
      expect(run1.materializationPhase).toBe('ready_for_dispatch')

      const run2 = await adapter.materializeRun(run!.id)
      expect(run2.materializationPhase).toBe('ready_for_dispatch')
      expect(run2.orchestrationRunId).toBe(run1.orchestrationRunId)

      expect(db.listRuns().runs.filter((r) => r.id !== 'run_legacy_local')).toHaveLength(1)
      expect(db.listTasks({ runId: run1.orchestrationRunId! })).toHaveLength(1)
    })
  })

  describe('pre-dispatch guard ordering and assertions', () => {
    it('asserts ready_for_dispatch phase before creating any native dispatch side effect', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker', { name: 'Worker' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: async (id) => makeReport(id, store) }
      })

      await expect(adapter.dispatchTask(run!.id, 'task_any')).rejects.toThrow(
        /is in phase "intent_persisted", expected "ready_for_dispatch"/
      )

      expect(db.getDispatchContext('task_any')).toBeFalsy()
    })

    it('asserts task mapping and existence before creating native dispatch', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker', { name: 'Worker' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: async (id) => makeReport(id, store) }
      })

      await adapter.materializeRun(run!.id)

      await expect(adapter.dispatchTask(run!.id, 'task_nonexistent')).rejects.toThrow(
        /Task "task_nonexistent" has no mapped child definition/
      )

      expect(db.getDispatchContext('task_nonexistent')).toBeFalsy()
    })
  })

  describe('launch policy enforcement before provider invocation', () => {
    it('refuses launch before worker provider is called when child requires external effects', async () => {
      const store = createStore()
      const providerRun = vi.fn().mockResolvedValue({})
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('worker', {
              name: 'Worker',
              mutationClass: 'exclusive_writer',
              mutationLane: 'content',
              stageAcceptance: {
                requiredEffects: [
                  {
                    kind: 'git-commit',
                    allowedStatuses: ['applied'],
                    required: true
                  }
                ]
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: { run: providerRun }
      })

      await adapter.materializeRun(run!.id)
      const taskId = `task_run_${run!.id}_worker`

      await expect(adapter.dispatchTask(run!.id, taskId)).rejects.toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
      expect(providerRun).not.toHaveBeenCalled()
      expect(db.getDispatchContext(taskId)).toBeFalsy()
    })

    it('passes full frozen launch config in startOptions to native dispatch', async () => {
      const store = createStore()
      let receivedIdentity: CoordinatedWorkerIdentity | undefined
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('worker', {
              name: 'Worker',
              launchConfig: {
                agentId: 'claude',
                model: 'claude-3-5-sonnet',
                reasoningEffort: 'high',
                surface: 'terminal',
                extraAgentArgs: '--verbose',
                reuseSession: false,
                workspaceMode: 'new_per_run',
                baseBranch: 'feature-x',
                setupDecision: 'run',
                timeoutSeconds: 120,
                maxRetries: 3,
                maxReviewIterations: 2
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) => {
            receivedIdentity = id
            return makeReport(id, store)
          }
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('completed')
      expect(receivedIdentity).toBeDefined()

      const dispatchCtx = db.getDispatchContext(receivedIdentity!.taskId)
      expect(dispatchCtx).toBeDefined()
      const dispatch = db.getWorkerDispatch(dispatchCtx!.id)
      expect(dispatch).toBeDefined()
      const startOptions = JSON.parse(dispatch!.start_options)
      expect(startOptions.agent).toBe('claude')
      expect(startOptions.model).toBe('claude-3-5-sonnet')
      expect(startOptions.reasoningEffort).toBe('high')
      expect(startOptions.surface).toBe('terminal')
      expect(startOptions.extraAgentArgs).toBe('--verbose')
      expect(startOptions.workspaceMode).toBe('new_per_run')
      expect(startOptions.baseBranch).toBe('feature-x')
      expect(startOptions.setupDecision).toBe('run')
      expect(startOptions.timeoutMs).toBe(120000)
      expect(startOptions.maxRetries).toBe(3)
      expect(startOptions.maxReviewIterations).toBe(2)
      expect(startOptions.mode).toEqual({ mode: 'headless' })
    })
  })

  describe('structured worker result validation: fail-closed semantics', () => {
    it('fails closed when result schema is malformed and does not unblock dependents', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_1', { name: 'Step 1' }),
            child('step_2', {
              name: 'Step 2',
              dependencies: [{ childId: 'step_1', condition: 'accepted' }]
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: (async () => ({
            not: 'a valid schema'
          })) as unknown as CoordinatedWorkerProvider['run']
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const step1Task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(step1Task?.status).toBe('failed')
      expect(step1Task?.result).toContain('Structured worker result schema invalid')

      const step2Task = db.getTask(`task_run_${run!.id}_step_2`)
      expect(step2Task?.status).toBe('pending')
      expect(db.getDispatchContext(`task_run_${run!.id}_step_2`)).toBeFalsy()
    })

    it('fails closed when identity is mismatched or foreign', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              automationRunId: 'foreign_run_id'
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain('does not match')
    })

    it('fails closed when definitionRevision is stale', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              definitionRevision: 999
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain('definitionRevision (999) does not match snapshot')
    })

    it('fails closed when resolvedConfigDigest is empty or does not match snapshot digest', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              resolvedConfigDigest: `sha256:${'f'.repeat(64)}`
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain(
        `resolvedConfigDigest "sha256:${'f'.repeat(64)}" does not match`
      )
    })

    it('fails closed when artifact producerAttempt does not match current task and dispatch', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              artifacts: [
                {
                  kind: 'code_diff',
                  uri: 'artifact://diff.patch',
                  producerAttempt: {
                    taskId: 'forged_task_id',
                    dispatchId: id.dispatchId
                  }
                }
              ]
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain('Artifact producerAttempt mismatch')
    })

    it('fails closed when required stage checks fail', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_1', {
              name: 'Step 1',
              stageAcceptance: {
                requiredChecks: [{ id: 'lint_check', required: true }]
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              checks: [
                {
                  id: 'lint_check',
                  outcome: 'failed'
                }
              ]
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain('Required stage check "lint_check" outcome was "failed"')
    })

    it('fails closed when worker reports blockers despite outcome=succeeded', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          run: async (id) =>
            makeReport(id, store, {
              outcome: 'succeeded',
              blockers: [
                {
                  code: 'BLOCKED',
                  message: 'Waiting on user input'
                }
              ]
            })
        }
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const task = db.getTask(`task_run_${run!.id}_step_1`)
      expect(task?.status).toBe('failed')
      expect(task?.result).toContain(
        'Worker result outcome cannot be "succeeded" when blockers are present'
      )
    })
  })
})
