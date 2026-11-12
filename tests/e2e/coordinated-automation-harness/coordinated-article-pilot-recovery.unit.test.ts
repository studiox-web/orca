import { afterEach, expect, it, vi } from 'vitest'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import { ARTICLE_REVIEW_GATE } from './coordinated-article-pilot-package'
import {
  articlePilotFixtureDefinition,
  articlePilotFixturePromptResolver,
  scriptArticlePilotFixture
} from './coordinated-article-pilot-fixture'
import { InjectedCoordinatorCrash, RecoveryEnv } from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let env: RecoveryEnv | undefined
afterEach(async () => {
  await env?.dispose()
  env = undefined
})

it('recovers native report settlement and a held editor review without blindly redispatching', async () => {
  env = await RecoveryEnv.create()
  const f = env
  scriptArticlePilotFixture(f)
  const { automationId } = f.createDefinitionOnly(articlePilotFixtureDefinition())
  const { run } = f.store.createCoordinatedAutomationRun({
    automationId,
    scheduledFor: 1000,
    trigger: 'manual',
    idempotencyKey: 'fixture-manual-once',
    promptResolver: articlePilotFixturePromptResolver
  })
  const runId = run!.id
  f.crashAt('report.after-native-settle')
  await expect(f.adapter.reconcileRun(runId)).rejects.toThrow(InjectedCoordinatorCrash)
  const briefDispatches = f.dispatchIds(runId, 'brief-review')
  expect(briefDispatches).toHaveLength(1)
  await f.reopen()
  expect((await f.adapter.reconcileRun(runId)).state).toBe('waiting')
  expect(f.dispatchIds(runId, 'brief-review')).toEqual(briefDispatches)
  const held = f.adapter.inspectProgress(runId)!.stages['editor-review'].pendingApproval!
  await f.reopen()
  expect((await f.adapter.reconcileRun(runId)).state).toBe('waiting')
  expect(f.adapter.inspectProgress(runId)!.stages['editor-review'].pendingApproval).toEqual(held)
  expect(f.dispatchIds(runId, 'write-draft')).toHaveLength(1)
  expect(f.dispatchIds(runId, 'editor-review')).toEqual([held.dispatchId])
  const current = f.run(runId)
  const snapshot = current.resolvedSnapshot!
  const result = await f.adapter.resolveGate({
    automationRunId: runId,
    orchestrationRunId: current.orchestrationRunId ?? null,
    definitionRevision: snapshot.definitionRevision,
    targetExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`,
    gateId: ARTICLE_REVIEW_GATE,
    gateScope: 'stage',
    decision: 'approve',
    childDefinitionId: 'editor-review',
    taskId: f.taskId(runId, 'editor-review'),
    dispatchId: held.dispatchId,
    expectedReportDigest: held.reportDigest
  })
  expect(result.run.completionReceipt?.finalState).toBe('ready_for_review')
  await f.reopen()
  expect((await f.adapter.reconcileRun(runId)).run.completionReceipt).toEqual(
    result.run.completionReceipt
  )
})
