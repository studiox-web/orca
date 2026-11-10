import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
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
import { isGeneratedId } from '../runtime/orchestration/db/generated-id'
import { parseOrchestrationTaskDepsFlag } from '../runtime/orchestration/task-deps-flag'
import {
  deterministicCoordinatedRunId,
  deterministicCoordinatedTaskId
} from './coordinated-automation-deterministic-ids'
import {
  CoordinatedAutomationAdapter,
  type CoordinatedHostApproval,
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
    evidence: [`Criterion ${c.id} verified passed by test worker`]
  }))
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
    resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} completed successfully`,
    reportMarkdown: `Report for ${identity.childDefinitionId}`,
    artifacts: [],
    checks: defaultChecks,
    effects: [],
    blockers: [],
    ...overrides
  } as StructuredWorkerResult
}

describe('Coordinated Automation Semantic Acceptance & Hardening', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'coord-semantic-test-'))
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

  describe('Bounded Collision-Resistant Native IDs & Windows CLI Transport', () => {
    it('produces bounded native IDs conforming to generated-id patterns and max length <= 64', () => {
      const runId = deterministicCoordinatedRunId('auto_run_1234567890abcdef')
      expect(runId).toHaveLength(16)
      expect(runId.length).toBeLessThanOrEqual(64)
      expect(runId.startsWith('run_')).toBe(true)
      expect(isGeneratedId(runId, 'run')).toBe(true)

      const taskId = deterministicCoordinatedTaskId(runId, 'child_step_abc')
      expect(taskId).toHaveLength(17)
      expect(taskId.length).toBeLessThanOrEqual(64)
      expect(taskId.startsWith('task_')).toBe(true)
      expect(isGeneratedId(taskId, 'task')).toBe(true)
    })

    it('demonstrates collision resistance and deterministic duplicate replay idempotency', () => {
      const runIdA = deterministicCoordinatedRunId('run_occurrence_1')
      const runIdB = deterministicCoordinatedRunId('run_occurrence_2')
      expect(runIdA).not.toBe(runIdB)

      // Replay idempotency
      const runIdAReplay = deterministicCoordinatedRunId('run_occurrence_1')
      expect(runIdAReplay).toBe(runIdA)

      const task1 = deterministicCoordinatedTaskId(runIdA, 'step_1')
      const task2 = deterministicCoordinatedTaskId(runIdA, 'step_2')
      expect(task1).not.toBe(task2)

      const task1Replay = deterministicCoordinatedTaskId(runIdA, 'step_1')
      expect(task1Replay).toBe(task1)
    })

    it('recovers Windows PowerShell quote-stripped dependency flags via native parseOrchestrationTaskDepsFlag', () => {
      const taskA = deterministicCoordinatedTaskId('run_1234567890ab', 'step_a')
      const taskB = deterministicCoordinatedTaskId('run_1234567890ab', 'step_b')

      // Windows PowerShell argv strips quotes: `[task_..., task_...]`
      const strippedDeps = `[${taskA}, ${taskB}]`
      const recovered = parseOrchestrationTaskDepsFlag(strippedDeps)
      expect(recovered).toEqual([taskA, taskB])

      // Invalid IDs fail recovery
      expect(() => parseOrchestrationTaskDepsFlag('[invalid_id, another_bad_id]')).toThrow(
        /Invalid --deps/
      )
    })
  })

  describe('Caller-Supplied ID Shape & Adoption Verification', () => {
    it('hardens caller-supplied Run ID in run-create.ts with shape and uniqueness validation', () => {
      // Shape rejections
      expect(() =>
        db.createRun({
          id: 'bad_prefix',
          objective: 'obj',
          coordinatorHandle: null,
          coordinatorPaneKey: null
        })
      ).toThrow(/Invalid caller-supplied run ID/)
      expect(() =>
        db.createRun({
          id: 'run_!',
          objective: 'obj',
          coordinatorHandle: null,
          coordinatorPaneKey: null
        })
      ).toThrow(/Invalid caller-supplied run ID/)
      expect(() =>
        db.createRun({
          id: `run_${'a'.repeat(65)}`,
          objective: 'obj',
          coordinatorHandle: null,
          coordinatorPaneKey: null
        })
      ).toThrow(/Invalid caller-supplied run ID/)

      // Valid creation
      const validId = 'run_custom_123'
      const run = db.createRun({
        id: validId,
        objective: 'obj',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      expect(run.id).toBe(validId)

      // Duplicate rejection
      expect(() =>
        db.createRun({
          id: validId,
          objective: 'obj',
          coordinatorHandle: null,
          coordinatorPaneKey: null
        })
      ).toThrow(/already exists/)
    })

    it('hardens caller-supplied Task ID in task-store.ts with shape and uniqueness validation', () => {
      const run = db.createRun({
        id: 'run_for_task_test',
        objective: 'obj',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })

      // Shape rejections
      expect(() => db.createTask({ runId: run.id, id: 'bad_prefix', spec: 'spec' })).toThrow(
        /Invalid caller-supplied task ID/
      )
      expect(() => db.createTask({ runId: run.id, id: 'task_@', spec: 'spec' })).toThrow(
        /Invalid caller-supplied task ID/
      )
      expect(() =>
        db.createTask({ runId: run.id, id: `task_${'x'.repeat(65)}`, spec: 'spec' })
      ).toThrow(/Invalid caller-supplied task ID/)

      // Valid creation
      const validTaskId = 'task_custom_456'
      const task = db.createTask({ runId: run.id, id: validTaskId, spec: 'spec' })
      expect(task.id).toBe(validTaskId)

      // Duplicate rejection
      expect(() => db.createTask({ runId: run.id, id: validTaskId, spec: 'spec' })).toThrow(
        /already exists/
      )
    })

    it('fails closed when materialization finds existing Run with mismatched objective or coordinator', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 1000
      })

      const expectedRunId = deterministicCoordinatedRunId(run!.id)
      // Pre-create native run with mismatched objective
      db.createRun({
        id: expectedRunId,
        objective: 'Mismatched objective from another context',
        coordinatorHandle: 'term_rogue',
        coordinatorPaneKey: null
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          capability: 'fake_no_effects',
          run: async (id) => makeWorkerResult(id, store)
        }
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(
        /Existing native Run ".*" does not match coordinated run ownership or objective/
      )
    })

    it('fails closed when materialization finds existing Task with mismatched spec or dependencies', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('step_1', { name: 'Step 1' })]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 2000
      })

      const expectedRunId = deterministicCoordinatedRunId(run!.id)
      const expectedTaskId = deterministicCoordinatedTaskId(expectedRunId, 'step_1')

      // Pre-create matching run, but conflicting task
      db.createRun({
        id: expectedRunId,
        objective: run!.resolvedSnapshot!.outcomeContract.humanStatement,
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      db.createTask({
        id: expectedTaskId,
        runId: expectedRunId,
        spec: 'Conflicting foreign spec'
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          capability: 'fake_no_effects',
          run: async (id) => makeWorkerResult(id, store)
        }
      })

      await expect(adapter.materializeRun(run!.id)).rejects.toThrow(
        /Existing native Task ".*" does not match coordinated child definition/
      )
    })
  })

  describe('Fake/No-Effect Worker Provider Capability Enforcement', () => {
    it('rejects provider before invocation when missing fake/no-effect capability', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(coordinatedCreateInput())
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 3000
      })

      const runSpy = vi.fn().mockResolvedValue({})
      const workerProvider: CoordinatedWorkerProvider = {
        run: runSpy
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const materialized = await adapter.materializeRun(run!.id)
      const taskId = materialized.childMappings![0].taskId

      await expect(adapter.dispatchTask(run!.id, taskId)).rejects.toThrow(
        CoordinatedAutomationLaunchRefusedError
      )
      await expect(adapter.dispatchTask(run!.id, taskId)).rejects.toThrow(
        /requires an explicit host-owned fake\/no-effect provider capability/
      )

      expect(runSpy).not.toHaveBeenCalled()
    })
  })

  describe('Host-Owned Child Task Semantic Acceptance Validation', () => {
    it('validates child resultSchema via Ajv: positive and negative cases', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_schema', {
              name: 'Schema Step',
              resultSchema: {
                type: 'object',
                properties: {
                  processedCount: { type: 'number', minimum: 1 }
                },
                required: ['processedCount'],
                additionalProperties: true
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 4000
      })

      // Negative: missing required field `processedCount`
      let failPayload = true
      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (id) => {
          if (failPayload) {
            return makeWorkerResult(id, store, {
              data: { wrongField: 'invalid' }
            })
          }
          return makeWorkerResult(id, store, {
            data: { processedCount: 42 }
          })
        }
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const failedRun = await adapter.runUntilSettled(run!.id)
      expect(failedRun.status).toBe('dispatch_failed')

      const taskAfterFail = db.listTasks({ runId: failedRun.orchestrationRunId! })[0]
      expect(taskAfterFail.status).toBe('failed')
      expect(taskAfterFail.result).toContain('Worker result violates child resultSchema')

      // Positive: valid payload
      failPayload = false
      const retryResult = await adapter.retryTask({
        automationRunId: run!.id,
        taskId: taskAfterFail.id,
        retryOfDispatchId: db.getDispatchContext(taskAfterFail.id)!.id
      })
      expect(retryResult.outcome).toBe('succeeded')
      expect(db.getTask(taskAfterFail.id)?.status).toBe('completed')
    })

    it('validates required stage artifacts, pathPattern, existence, and sha256 digests', async () => {
      const store = createStore()
      const artifactPath = join(testState.dir, 'output-article.md')
      const artifactContent = '# Title\nValid content'
      writeFileSync(artifactPath, artifactContent, 'utf8')
      writeFileSync(join(testState.dir, 'wrong-prefix.txt'), 'wrong', 'utf8')
      const validDigest = `sha256:${createHash('sha256').update(artifactContent).digest('hex')}`

      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_art', {
              name: 'Artifact Step',
              stageAcceptance: {
                requiredArtifacts: [
                  {
                    kind: 'document',
                    pathPattern: 'output-*.md',
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
        scheduledFor: 5000
      })

      let scenario:
        | 'pattern_mismatch'
        | 'missing_digest'
        | 'file_missing'
        | 'digest_mismatch'
        | 'missing_path'
        | 'traversal'
        | 'success' = 'pattern_mismatch'

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (id) => {
          if (scenario === 'pattern_mismatch') {
            return makeWorkerResult(id, store, {
              artifacts: [{ kind: 'document', uri: 'wrong-prefix.txt', sha256: validDigest }]
            })
          }
          if (scenario === 'missing_digest') {
            return makeWorkerResult(id, store, {
              artifacts: [{ kind: 'document', uri: 'output-article.md' }]
            })
          }
          if (scenario === 'missing_path') {
            return makeWorkerResult(id, store, {
              artifacts: [{ kind: 'document', uri: '', sha256: validDigest }]
            })
          }
          if (scenario === 'traversal') {
            return makeWorkerResult(id, store, {
              artifacts: [{ kind: 'document', uri: 'artifact://../secret.md', sha256: validDigest }]
            })
          }
          if (scenario === 'file_missing') {
            return makeWorkerResult(id, store, {
              artifacts: [
                {
                  kind: 'document',
                  uri: 'output-nonexistent.md',
                  sha256: `sha256:${'a'.repeat(64)}`
                }
              ]
            })
          }
          if (scenario === 'digest_mismatch') {
            return makeWorkerResult(id, store, {
              artifacts: [
                {
                  kind: 'document',
                  uri: 'output-article.md',
                  sha256: `sha256:${'e'.repeat(64)}`
                }
              ]
            })
          }
          return makeWorkerResult(id, store, {
            artifacts: [
              {
                kind: 'document',
                uri: 'output-article.md',
                sha256: validDigest
              }
            ]
          })
        }
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider,
        workspacePath: testState.dir
      })

      // Pattern mismatch check
      const runPatternFail = await adapter.runUntilSettled(run!.id)
      expect(runPatternFail.status).toBe('dispatch_failed')
      let task = db.listTasks({ runId: runPatternFail.orchestrationRunId! })[0]
      expect(task.result).toContain('does not match required pathPattern')

      // Missing digest check
      scenario = 'missing_digest'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain('must specify a sha256 digest')

      // Missing path check
      scenario = 'missing_path'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain('expected string to have >=1 characters')

      // Traversal check
      scenario = 'traversal'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain('without ".." traversal segments')

      // Missing file check
      scenario = 'file_missing'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain('does not exist on disk')

      // Digest mismatch check
      scenario = 'digest_mismatch'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain('digest mismatch')

      // Success check
      scenario = 'success'
      const successResult = await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      expect(successResult.outcome).toBe('succeeded')
      expect(db.getTask(task.id)?.status).toBe('completed')
    })

    it('fails closed when required artifacts cannot be validated due to missing workspacePath', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_doc_noworkspace', {
              name: 'Doc Step',
              stageAcceptance: {
                requiredArtifacts: [
                  { kind: 'document', pathPattern: 'output-*.md', required: true }
                ]
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 5500
      })

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider: {
          capability: 'fake_no_effects',
          run: async (id) =>
            makeWorkerResult(id, store, {
              artifacts: [
                {
                  kind: 'document',
                  uri: 'output-article.md',
                  sha256: `sha256:${'a'.repeat(64)}`
                }
              ]
            })
        },
        workspacePath: ''
      })

      const result = await adapter.runUntilSettled(run!.id)
      expect(result.status).toBe('dispatch_failed')
      const task = db.listTasks({ runId: result.orchestrationRunId! })[0]
      expect(task.result).toContain(
        'Cannot validate required artifacts without a valid workspacePath'
      )
    })

    it('validates stageAcceptance criteria and rejects smuggled approvals while requiring host-owned approvals', async () => {
      const store = createStore()
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [
            child('step_approval', {
              name: 'Approval Step',
              stageAcceptance: {
                criteria: [{ id: 'crit_review', description: 'Peer reviewed', required: true }],
                requiredApprovals: [{ id: 'appr_editor', role: 'editor', required: true }]
              }
            })
          ]
        })
      )
      const { run } = store.createCoordinatedAutomationRun({
        automationId: automation.id,
        scheduledFor: 6000
      })

      let scenario: 'missing_crit' | 'smuggle_approval' | 'missing_approval' | 'valid' =
        'missing_crit'
      const hostApprovals: CoordinatedHostApproval[] = []

      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (id) => {
          if (scenario === 'missing_crit') {
            return makeWorkerResult(id, store, { checks: [] })
          }
          if (scenario === 'smuggle_approval') {
            return makeWorkerResult(id, store, {
              checks: [{ id: 'crit_review', outcome: 'passed' }],
              approvals: [{ role: 'editor', approverIdentity: 'attacker@evil.com' }]
            })
          }
          if (scenario === 'valid') {
            const mappedDispatchId = store
              .listAutomationRuns()
              .find((r) => r.id === run!.id)!
              .childMappings!.find((m) => m.childDefinitionId === 'step_approval')!.dispatchId!
            hostApprovals.splice(0, hostApprovals.length, {
              approvalId: 'appr_editor',
              role: 'editor',
              approverIdentity: 'alice@orca.test',
              approvedAt: 1000,
              automationId: automation.id,
              definitionRevision: run!.resolvedSnapshot!.definitionRevision,
              automationRunId: run!.id,
              orchestrationRunId: critFail.orchestrationRunId!,
              scope: 'stage',
              childDefinitionId: 'step_approval',
              taskId: task.id,
              dispatchId: mappedDispatchId
            })
          }
          return makeWorkerResult(id, store, {
            checks: [{ id: 'crit_review', outcome: 'passed' }]
          })
        }
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const critFail = await adapter.runUntilSettled(run!.id)
      expect(critFail.status).toBe('dispatch_failed')
      let task = db.listTasks({ runId: critFail.orchestrationRunId! })[0]
      expect(task.result).toContain('Required stage criterion "crit_review" was not satisfied')

      // Smuggled approval in worker report must be rejected
      scenario = 'smuggle_approval'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain(
        'Worker report cannot smuggle approval or effect trust authority'
      )

      // Missing host approval must fail closed
      scenario = 'missing_approval'
      await adapter.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      task = db.getTask(task.id)!
      expect(task.result).toContain(
        'Required stage approval "appr_editor" (role "editor") missing from host approvals'
      )

      // Succeeded when host provides approval
      scenario = 'valid'
      const adapterWithHostApproval = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider,
        hostApprovals
      })
      const validResult = await adapterWithHostApproval.retryTask({
        automationRunId: run!.id,
        taskId: task.id,
        retryOfDispatchId: db.getDispatchContext(task.id)!.id
      })
      expect(validResult.outcome).toBe('succeeded')
      expect(db.getTask(task.id)?.status).toBe('completed')
    })
  })

  describe('Host-Owned Parent Outcome Acceptance & Semantic Completion Receipts', () => {
    it('proves native Task status alone never proves outcome success: fails parent when outcome criteria unsatisfied', async () => {
      const store = createStore()
      // Coordinated automation with parent outcome criterion 'article-reviewed'
      const automation = store.createCoordinatedAutomation(
        coordinatedCreateInput({
          children: [child('worker_1', { name: 'Worker 1' })],
          outcomeContract: {
            humanStatement: 'One reviewed article is ready.',
            acceptanceCriteria: [
              {
                id: 'article-reviewed',
                description: 'Article has been thoroughly reviewed and signed off',
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
        scheduledFor: 7000
      })

      // Worker succeeds natively (status 'completed'), but check for 'article-reviewed' fails
      const workerProvider: CoordinatedWorkerProvider = {
        capability: 'fake_no_effects',
        run: async (id) =>
          makeWorkerResult(id, store, {
            outcome: 'succeeded',
            checks: [
              {
                id: 'article-reviewed',
                outcome: 'failed',
                evidence: ['Reviewer rejected the draft']
              }
            ]
          })
      }

      const adapter = new CoordinatedAutomationAdapter({
        store,
        orchestrationDb: db,
        workerProvider
      })

      const settledRun = await adapter.runUntilSettled(run!.id)

      // Even though worker completed, parent outcome acceptance rejected the completion!
      expect(settledRun.status).toBe('dispatch_failed')
      expect(settledRun.error).toContain('Parent outcome acceptance validation failed')
      expect(settledRun.error).toContain(
        'Required acceptance criterion "article-reviewed" failed acceptance evaluation'
      )
    })
  })
})
