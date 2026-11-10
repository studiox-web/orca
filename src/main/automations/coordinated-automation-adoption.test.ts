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
  CoordinatedAutomationLaunchRefusedError,
  materializeCoordinatedRun,
  orchestrationRecordProbe
} from './coordinated-automation-materialization'
import {
  deterministicCoordinatedRunId,
  deterministicCoordinatedTaskId
} from './coordinated-automation-deterministic-ids'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

describe('Coordinated Automation Native Run and Task Adoption Field Checks', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-adoption-test-'))
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

  function setupRun(childDeps?: string[]) {
    const store = createStore()
    const automation = store.createCoordinatedAutomation(
      coordinatedCreateInput({
        children: [
          child('child_a', {
            name: 'Child A',
            promptSource: { kind: 'inline', text: 'prompt a' }
          }),
          child('child_b', {
            name: 'Child B',
            promptSource: { kind: 'inline', text: 'prompt b' },
            dependencies: childDeps ? childDeps.map((id) => ({ childId: id })) : []
          })
        ],
        outcomeContract: {
          acceptanceCriteria: [],
          requiredApprovals: [],
          allowedFinalStates: ['completed', 'failed'],
          humanStatement: 'Target statement'
        }
      })
    )
    const { run } = store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    const probe = orchestrationRecordProbe(db)
    return { store, automation, run: run!, probe }
  }

  describe('Run Adoption Checks', () => {
    it('adopts existing native Run with positive replay when all fields match', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })

      const materialized = materializeCoordinatedRun(store, db, probe, run.id)
      expect(materialized.orchestrationRunId).toBe(exactRunId)
      expect(materialized.materializationPhase).toBe('ready_for_dispatch')
    })

    it('refuses adoption when coordinator_handle is not null', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: 'term_rogue',
        coordinatorPaneKey: null
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when coordinator_pane_key is not null', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: 'pane_1'
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when home_database is not this_database', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.db.prepare('UPDATE runs SET home_database = ? WHERE id = ?').run('remote_db', exactRunId)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when objective does not match', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Completely different objective',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when coordinator_orca_session_id is not null', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.db
        .prepare('UPDATE runs SET coordinator_orca_session_id = ? WHERE id = ?')
        .run('chat_sess_1', exactRunId)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when coordinator_orca_session_id_generation is invalid (> 1)', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.db
        .prepare('UPDATE runs SET coordinator_orca_session_id_generation = ? WHERE id = ?')
        .run(99, exactRunId)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when consumer_generation is not 1', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.db.prepare('UPDATE runs SET consumer_generation = ? WHERE id = ?').run(2, exactRunId)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when legacy is not 0', () => {
      const { store, run, probe } = setupRun()
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.db.prepare('UPDATE runs SET legacy = 1 WHERE id = ?').run(exactRunId)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })
  })

  describe('Task Adoption Checks', () => {
    function setupTasksForAdoption() {
      const { store, run, probe } = setupRun(['child_a'])
      const exactRunId = deterministicCoordinatedRunId(run.id)
      db.createRun({
        id: exactRunId,
        objective: 'Target statement',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      store.linkCoordinatedOrchestrationRun({
        automationRunId: run.id,
        orchestrationRunId: exactRunId,
        probe
      })

      const exactTaskIdA = deterministicCoordinatedTaskId(exactRunId, 'child_a')
      const exactTaskIdB = deterministicCoordinatedTaskId(exactRunId, 'child_b')

      db.createTask({
        id: exactTaskIdA,
        runId: exactRunId,
        spec: 'prompt a',
        displayName: 'Child A',
        taskTitle: 'Child A',
        deps: []
      })

      return { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB }
    }

    it('adopts existing native Task with positive replay when all fields match', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()

      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })

      const materialized = materializeCoordinatedRun(store, db, probe, run.id)
      expect(materialized.materializationPhase).toBe('ready_for_dispatch')
    })

    it('refuses adoption when spec does not match', () => {
      const { store, run, probe, exactRunId, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'tampered spec',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: []
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when display_name does not match', () => {
      const { store, run, probe, exactRunId, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Wrong Name',
        taskTitle: 'Child B',
        deps: []
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when task_title is tampered', () => {
      const { store, run, probe, exactRunId, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Alien Title',
        deps: []
      })
      db.db.prepare('UPDATE tasks SET task_title = ? WHERE id = ?').run('Alien Title', exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when dependencies (deps) do not match', () => {
      const { store, run, probe, exactRunId, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [] // missing dependency on exactTaskIdA
      })

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when parent_id is not null', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(exactTaskIdA, exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when created_by_terminal_handle is not null', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db
        .prepare('UPDATE tasks SET created_by_terminal_handle = ? WHERE id = ?')
        .run('term_1', exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when created_by_pane_key is not null', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db
        .prepare('UPDATE tasks SET created_by_pane_key = ? WHERE id = ?')
        .run('pane_x', exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when created_by_process_incarnation is not null', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db
        .prepare('UPDATE tasks SET created_by_process_incarnation = ? WHERE id = ?')
        .run('inc_1', exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when created_by_run_generation is invalid (> 1)', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db
        .prepare('UPDATE tasks SET created_by_run_generation = ? WHERE id = ?')
        .run(5, exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })

    it('refuses adoption when existing task status is failed', () => {
      const { store, run, probe, exactRunId, exactTaskIdA, exactTaskIdB } = setupTasksForAdoption()
      db.createTask({
        id: exactTaskIdB,
        runId: exactRunId,
        spec: 'prompt b',
        displayName: 'Child B',
        taskTitle: 'Child B',
        deps: [exactTaskIdA]
      })
      db.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(exactTaskIdB)

      expect(() => materializeCoordinatedRun(store, db, probe, run.id)).toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
    })
  })
})
