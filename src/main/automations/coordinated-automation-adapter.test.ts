import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AutomationRun } from '../../shared/automations-types'
import {
  closeTestStores,
  createStore,
  readPersistedState,
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
  buildCrewSnapshot,
  type CrewReadDependencies
} from '../runtime/orchestration/crew/crew-read-model'
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
  const criteria = run?.resolvedSnapshot?.outcomeContract.acceptanceCriteria ?? []
  const defaultChecks = criteria.map((c) => ({
    id: c.id,
    outcome: 'passed' as const,
    evidence: [`Criterion ${c.id} verified passed by fake worker`]
  }))
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
    resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} done`,
    reportMarkdown: `${identity.childDefinitionId} report`,
    artifacts: [],
    checks: defaultChecks,
    effects: [],
    blockers: [],
    ...overrides
  }
}

describe('CoordinatedAutomationAdapter Phase 4 integration', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-adapter-test-'))
    writeDataFile(coordinatedTestState())
    db = new OrchestrationDb(':memory:')
  })

  afterEach(async () => {
    db.close()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  describe('graph execution (linear, diamond, single-writer)', () => {
    it('executes a linear graph (A -> B -> C) sequentially with native dependencies and exact mappings', async () => {
      const store = createStore()
      const executionOrder: string[] = []

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          executionOrder.push(identity.childDefinitionId)
          return makeReport(identity, store)
        }
      }

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_a', { name: 'Step A' }),
            child('step_b', {
              name: 'Step B',
              dependencies: [{ childId: 'step_a', condition: 'accepted' }]
            }),
            child('step_c', {
              name: 'Step C',
              dependencies: [{ childId: 'step_b', condition: 'accepted' }]
            })
          ]
        })
      )

      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })
      expect(initialRun).toBeDefined()

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const completedRun = await adapter.runUntilSettled(initialRun!.id)

      expect(completedRun.status).toBe('completed')
      expect(completedRun.error).toBeNull()
      expect(completedRun.orchestrationRunId).toBeTruthy()
      expect(completedRun.childMappings).toHaveLength(3)

      expect(executionOrder).toEqual(['step_a', 'step_b', 'step_c'])

      // Native orchestration Run assertions
      const orchRun = db.getRun(completedRun.orchestrationRunId!)
      expect(orchRun).toBeDefined()
      expect(orchRun?.objective).toBe('One reviewed article is ready.')

      // Native orchestration Tasks assertions
      const tasks = db.listTasks({ runId: completedRun.orchestrationRunId! })
      expect(tasks).toHaveLength(3)
      for (const t of tasks) {
        expect(t.status).toBe('completed')
      }

      const taskA = tasks.find((t) => t.display_name === 'Step A')!
      const taskB = tasks.find((t) => t.display_name === 'Step B')!
      const taskC = tasks.find((t) => t.display_name === 'Step C')!

      expect(JSON.parse(taskA.deps)).toEqual([])
      expect(JSON.parse(taskB.deps)).toEqual([taskA.id])
      expect(JSON.parse(taskC.deps)).toEqual([taskB.id])

      // Mapping assertions
      const mapA = completedRun.childMappings!.find((m) => m.childDefinitionId === 'step_a')!
      const mapB = completedRun.childMappings!.find((m) => m.childDefinitionId === 'step_b')!
      const mapC = completedRun.childMappings!.find((m) => m.childDefinitionId === 'step_c')!

      expect(mapA.taskId).toBe(taskA.id)
      expect(mapA.dispatchId).toMatch(/^ctx_/)
      expect(mapB.taskId).toBe(taskB.id)
      expect(mapB.dispatchId).toMatch(/^ctx_/)
      expect(mapC.taskId).toBe(taskC.id)
      expect(mapC.dispatchId).toMatch(/^ctx_/)
    })

    it('executes a diamond graph (Root -> Left, Right -> Join) with concurrent branches and synchronized join', async () => {
      const store = createStore()
      const activeParallel = new Set<string>()
      let maxParallelBranches = 0
      const order: string[] = []

      let leftStartedResolve: () => void = () => {}
      const leftStarted = new Promise<void>((r) => {
        leftStartedResolve = r
      })
      let rightStartedResolve: () => void = () => {}
      const rightStarted = new Promise<void>((r) => {
        rightStartedResolve = r
      })

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          activeParallel.add(identity.childDefinitionId)
          maxParallelBranches = Math.max(maxParallelBranches, activeParallel.size)
          if (identity.childDefinitionId === 'left') {
            leftStartedResolve()
            await rightStarted
          } else if (identity.childDefinitionId === 'right') {
            rightStartedResolve()
            await leftStarted
          }
          activeParallel.delete(identity.childDefinitionId)
          order.push(identity.childDefinitionId)
          return makeReport(identity, store)
        }
      }

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('root', { name: 'Root' }),
            child('left', {
              name: 'Left branch',
              dependencies: [{ childId: 'root', condition: 'accepted' }]
            }),
            child('right', {
              name: 'Right branch',
              dependencies: [{ childId: 'root', condition: 'accepted' }]
            }),
            child('join', {
              name: 'Join',
              dependencies: [
                { childId: 'left', condition: 'accepted' },
                { childId: 'right', condition: 'accepted' }
              ]
            })
          ]
        })
      )

      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 2000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const completedRun = await adapter.runUntilSettled(initialRun!.id)

      expect(completedRun.status).toBe('completed')
      expect(completedRun.error).toBeNull()

      // Root ran first, join ran last, left and right were concurrently active
      expect(order[0]).toBe('root')
      expect(order[3]).toBe('join')
      expect(new Set([order[1], order[2]])).toEqual(new Set(['left', 'right']))
      expect(maxParallelBranches).toBe(2)

      const tasks = db.listTasks({ runId: completedRun.orchestrationRunId! })
      const joinTask = tasks.find((t) => t.display_name === 'Join')!
      const leftTask = tasks.find((t) => t.display_name === 'Left branch')!
      const rightTask = tasks.find((t) => t.display_name === 'Right branch')!

      expect(JSON.parse(joinTask.deps).sort()).toEqual([leftTask.id, rightTask.id].sort())
    })

    it('enforces single-writer lanes and parent maxConcurrency without replacing downstream locks', async () => {
      const store = createStore()
      const laneConcurrencies = new Map<string, number>()
      let peakConcurrencyInDbLane = 0
      let totalActive = 0
      let peakTotalActive = 0

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          totalActive += 1
          peakTotalActive = Math.max(peakTotalActive, totalActive)
          const lane = identity.childDefinitionId.includes('db_') ? 'db_lane' : 'other_lane'
          const current = (laneConcurrencies.get(lane) ?? 0) + 1
          laneConcurrencies.set(lane, current)
          if (lane === 'db_lane') {
            peakConcurrencyInDbLane = Math.max(peakConcurrencyInDbLane, current)
          }

          await Promise.resolve()

          totalActive -= 1
          laneConcurrencies.set(lane, (laneConcurrencies.get(lane) ?? 1) - 1)

          return makeReport(identity, store)
        }
      }

      // writer1: exclusive_writer in 'db_lane'
      // writer2: exclusive_writer in 'db_lane' (depends on writer1)
      // reader1, reader2: read_only, no dependencies
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          globalCeilings: { maxConcurrency: 2 },
          children: [
            child('db_writer1', {
              name: 'DB Writer 1',
              mutationClass: 'exclusive_writer',
              mutationLane: 'db_lane'
            }),
            child('db_writer2', {
              name: 'DB Writer 2',
              mutationClass: 'exclusive_writer',
              mutationLane: 'db_lane',
              dependencies: [{ childId: 'db_writer1', condition: 'accepted' }]
            }),
            child('reader1', {
              name: 'Reader 1',
              mutationClass: 'read_only'
            }),
            child('reader2', {
              name: 'Reader 2',
              mutationClass: 'read_only'
            })
          ]
        })
      )

      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 3000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const completedRun = await adapter.runUntilSettled(initialRun!.id)

      expect(completedRun.status).toBe('completed')
      // Exclusive writer in 'db_lane' never ran concurrently with another writer in 'db_lane'
      expect(peakConcurrencyInDbLane).toBe(1)
      // Overall ceiling was adhered to
      expect(peakTotalActive).toBeLessThanOrEqual(2)

      const tasks = db.listTasks({ runId: completedRun.orchestrationRunId! })
      expect(tasks).toHaveLength(4)
      for (const t of tasks) {
        expect(t.status).toBe('completed')
      }
    })
  })

  describe('duplicate requests (scheduler, coordinator, start)', () => {
    it('handles duplicate scheduler request via ledger replay idempotency', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())

      const first = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 4000
      })
      expect(first.created).toBe(true)
      expect(first.run).toBeDefined()

      // Duplicate scheduler request for the exact same occurrence
      const duplicate = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 4000
      })
      expect(duplicate.created).toBe(false)
      expect(duplicate.run?.id).toBe(first.run?.id)
      expect(store.listAutomationRuns(automation.id)).toHaveLength(1)
    })

    it('handles duplicate coordinator materialization idempotently without re-creating tasks', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 5000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db
      })

      // First coordinator materialization
      const materializedFirst = await adapter.materializeRun(initialRun!.id)
      expect(materializedFirst.materializationPhase).toBe('ready_for_dispatch')
      const initialTasks = db.listTasks({ runId: materializedFirst.orchestrationRunId! })
      expect(initialTasks).toHaveLength(2)

      // Duplicate coordinator materialization call
      const materializedSecond = await adapter.materializeRun(initialRun!.id)
      expect(materializedSecond.materializationPhase).toBe('ready_for_dispatch')
      expect(materializedSecond.orchestrationRunId).toBe(materializedFirst.orchestrationRunId)

      // Verifies no extra runs or tasks were created
      const tasksAfterDuplicate = db.listTasks({ runId: materializedFirst.orchestrationRunId! })
      expect(tasksAfterDuplicate).toHaveLength(2)
      expect(tasksAfterDuplicate.map((t) => t.id)).toEqual(initialTasks.map((t) => t.id))
    })

    it('rejects duplicate start request on a task that is already dispatched', async () => {
      const store = createStore()
      let unblockWorker: () => void = () => {}
      const workerStarted = new Promise<void>((resolve) => {
        unblockWorker = resolve
      })
      let finishWorker: () => void = () => {}
      const allowFinish = new Promise<void>((resolve) => {
        finishWorker = resolve
      })

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          unblockWorker()
          await allowFinish
          return makeReport(identity, store)
        }
      }

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('only_task', { name: 'Only' })]
        })
      )
      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 6000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const run = await adapter.materializeRun(initialRun!.id)
      const taskId = run.childMappings![0].taskId

      // Launch the task
      const firstDispatchPromise = adapter.dispatchTask(run.id, taskId)
      await workerStarted

      // Attempt duplicate start on the already dispatched task
      await expect(adapter.dispatchTask(run.id, taskId)).rejects.toThrow(
        /only a ready Task can start/i
      )

      finishWorker()
      await firstDispatchPromise
    })
  })

  describe('retry as a new Dispatch on the same Task', () => {
    it('retries a failed task on the same taskId, creates new dispatch, and unblocks downstream tasks upon success', async () => {
      const store = createStore()
      let attempt = 0

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          if (identity.childDefinitionId === 'flake') {
            attempt += 1
            if (attempt === 1) {
              return makeReport(identity, store, {
                outcome: 'failed',
                summary: 'Transformed error',
                reportMarkdown: 'Failed on attempt 1'
              })
            }
          }
          return makeReport(identity, store)
        }
      }

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('flake', { name: 'Flaky step' }),
            child('downstream', {
              name: 'Downstream step',
              dependencies: [{ childId: 'flake', condition: 'accepted' }]
            })
          ]
        })
      )

      const { run: initialRun } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 7000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const run = await adapter.materializeRun(initialRun!.id)
      const flakeMapping = run.childMappings!.find((m) => m.childDefinitionId === 'flake')!
      const downstreamMapping = run.childMappings!.find(
        (m) => m.childDefinitionId === 'downstream'
      )!

      // First dispatch of 'flake' fails
      const firstAttempt = await adapter.dispatchTask(run.id, flakeMapping.taskId)
      expect(firstAttempt.outcome).toBe('failed')

      const taskAfterFail = db.getTask(flakeMapping.taskId)
      expect(taskAfterFail?.status).toBe('failed')

      const downstreamTaskBeforeRetry = db.getTask(downstreamMapping.taskId)
      expect(downstreamTaskBeforeRetry?.status).toBe('pending')

      // Retry the task with retryOfDispatchId
      const retryResult = await adapter.retryTask({
        automationRunId: run.id,
        taskId: flakeMapping.taskId,
        retryOfDispatchId: firstAttempt.dispatchId
      })

      expect(retryResult.outcome).toBe('succeeded')
      expect(retryResult.taskId).toBe(flakeMapping.taskId)
      expect(retryResult.dispatchId).not.toBe(firstAttempt.dispatchId)

      // Downstream task should now be promoted to 'ready'
      const downstreamTaskAfterRetry = db.getTask(downstreamMapping.taskId)
      expect(downstreamTaskAfterRetry?.status).toBe('ready')

      // Dispatch downstream task
      const downstreamResult = await adapter.dispatchTask(run.id, downstreamMapping.taskId)
      expect(downstreamResult.outcome).toBe('succeeded')
      expect(db.getTask(downstreamMapping.taskId)?.status).toBe('completed')
    })
  })

  describe('mid-run config edits', () => {
    it('isolates in-flight run to its immutable snapshot when parent automation is edited mid-run', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker_v1', { name: 'Original Worker' })]
        })
      )

      expect(automation.definitionRevision).toBe(1)

      // Run created at revision 1
      const { run: runV1 } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 8000
      })
      expect(runV1?.automationDefinitionRevision).toBe(1)
      expect(runV1?.resolvedSnapshot?.resolvedChildren).toHaveLength(1)
      expect(runV1?.resolvedSnapshot?.resolvedChildren[0].childDefinitionId).toBe('worker_v1')

      // Mid-run edit: parent automation is updated, creating revision 2
      const updatedAutomation = store.updateCoordinatedAutomation(automation.id, {
        expectedDefinitionRevision: 1,
        children: [
          child('worker_v2', { name: 'New Worker' }),
          child('another_v2', { name: 'Another Worker' })
        ]
      })
      expect(updatedAutomation.definitionRevision).toBe(2)
      expect(updatedAutomation.children).toHaveLength(2)

      // Now materialize and run the existing revision 1 run
      const executedNames: string[] = []
      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) => {
          executedNames.push(identity.childDefinitionId)
          return makeReport(identity, store)
        }
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const completed = await adapter.runUntilSettled(runV1!.id)

      expect(completed.status).toBe('completed')
      // Only the snapshot children from revision 1 were executed
      expect(executedNames).toEqual(['worker_v1'])
      expect(completed.childMappings).toHaveLength(1)
      expect(completed.childMappings![0].childDefinitionId).toBe('worker_v1')

      const tasks = db.listTasks({ runId: completed.orchestrationRunId! })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].display_name).toBe('Original Worker')
    })
  })

  describe('launch refusal', () => {
    it('refuses launch when parent automation is missing from the store', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 9000
      })

      // Simulate missing parent automation by removing it from the store state
      const rawState = readPersistedState()
      const automations = rawState.automations.filter((a) => a.id !== automation.id)
      writeDataFile({ ...rawState, automations })

      const storeReloaded = createStore()
      const adapter = new CoordinatedAutomationAdapter({
        store: storeReloaded,
        orchestrationDb: db
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
      expect(db.listRuns().runs.filter((r) => r.id !== 'run_legacy_local')).toHaveLength(0)
      expect(db.listTasks()).toHaveLength(0)
    })

    it('refuses launch when coordinated run is quarantined', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 10000
      })

      // Quarantine the run in the store state
      const diskRun = store.listAutomationRuns().find((r) => r.id === run!.id)!
      const quarantinedRun: AutomationRun = {
        ...diskRun,
        coordinatedQuarantine: {
          reason: 'Payload digest tampered',
          payloadDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          payload: null
        }
      }

      // Replace with quarantined run
      const rawState = readPersistedState()
      const runs = (rawState.automationRuns ?? []).map((r) =>
        r.id === run!.id ? quarantinedRun : r
      )
      writeDataFile({ ...rawState, automationRuns: runs })

      const storeReloaded = createStore()
      const adapter = new CoordinatedAutomationAdapter({
        store: storeReloaded,
        orchestrationDb: db
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(/quarantined/i)
      expect(db.listRuns().runs.filter((r) => r.id !== 'run_legacy_local')).toHaveLength(0)
      expect(db.listTasks()).toHaveLength(0)
    })

    it('denies external effects reported by worker and settles task as failed', async () => {
      const store = createStore()
      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (identity) =>
          makeReport(identity, store, {
            summary: 'Attempted side effect',
            effects: [
              {
                kind: 'custom',
                status: 'applied'
              }
            ]
          })
      }

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('effectful_worker')]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 11000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const settled = await adapter.runUntilSettled(run!.id)
      expect(settled.status).toBe('dispatch_failed')

      const tasks = db.listTasks({ runId: settled.orchestrationRunId! })
      expect(tasks[0].status).toBe('failed')
      expect(tasks[0].result).toContain('External effects denied')
    })
  })

  describe('existing CLI and crew read compatibility', () => {
    it('orchestration records are fully readable by native CLI methods and buildCrewSnapshot', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('researcher', { name: 'Researcher' }),
            child('writer', {
              name: 'Writer',
              dependencies: [{ childId: 'researcher', condition: 'accepted' }]
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 12000
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db
      })

      const materialized = await adapter.materializeRun(run!.id)
      const orchRunId = materialized.orchestrationRunId!

      // 1. db.getRun
      const orchRun = db.getRun(orchRunId)
      expect(orchRun).toBeDefined()
      expect(orchRun?.id).toBe(orchRunId)

      // 2. db.listTasks
      const tasks = db.listTasks({ runId: orchRunId })
      expect(tasks).toHaveLength(2)

      // 3. db.listTasksWithDispatch (before dispatch: dispatches are null)
      const withDispatchBefore = db.listTasksWithDispatch({ runId: orchRunId })
      expect(withDispatchBefore).toHaveLength(2)
      expect(withDispatchBefore[0].dispatch_id).toBeNull()

      // Dispatch the first task
      const researcherTask = tasks.find((t) => t.display_name === 'Researcher')!
      const dispatchResult = await adapter.dispatchTask(materialized.id, researcherTask.id)

      // 4. db.getDispatchContext
      const dispatchCtx = db.getDispatchContext(researcherTask.id)
      expect(dispatchCtx).toBeDefined()
      expect(dispatchCtx?.id).toBe(dispatchResult.dispatchId)
      expect(dispatchCtx?.task_id).toBe(researcherTask.id)
      expect(dispatchCtx?.status).toBe('completed')

      // 5. db.getWorkerDispatch
      const workerDispatch = db.getWorkerDispatch(dispatchResult.dispatchId)
      expect(workerDispatch).toBeDefined()
      expect(workerDispatch?.dispatch_id).toBe(dispatchResult.dispatchId)

      // 6. Crew read model compatibility
      const handles = new Map([
        ['term_coord', 'tab_coord:coord_pane_leaf'],
        ['term_worker', 'tab_worker:worker_pane_leaf']
      ])
      const deps: CrewReadDependencies = {
        db,
        retainedDbExists: true,
        hostKey: 'test-host',
        records: null,
        statuses: [],
        maxDepth: () => 10,
        callerProjection: (handle) => ({
          kind: 'terminal',
          handle,
          paneKey: handles.get(handle),
          processIncarnation: handles.has(handle) ? `process:${handle}` : undefined
        }),
        liveHandle: (handle) => handles.has(handle),
        handleForPane: (pane) => [...handles].find(([, value]) => value === pane)?.[0] ?? null,
        paneForHandle: (handle) => handles.get(handle) ?? null,
        livePaneForHandle: (handle) => handles.get(handle) ?? null,
        processForHandle: (handle) => (handles.has(handle) ? `process:${handle}` : null),
        name: (_identity, task) => task ?? 'Default name'
      }

      const snapshot = buildCrewSnapshot('term_coord', deps)
      expect(snapshot).toBeDefined()
      expect(snapshot.sections).toBeDefined()
      expect(snapshot.sections.managing).toBeDefined()
      expect(snapshot.sections.managedBy).toBeDefined()
    })
  })
})
