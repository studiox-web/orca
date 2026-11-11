import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { CoordinatedAutomationAdapter } from '../../../src/main/automations/coordinated-automation-adapter'
import { createMemoryCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { encodeCoordinatedWorkerReport } from '../../../src/main/automations/coordinated-automation-worker-report-envelope'
import { RecoveryEnv } from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const GATE = 'gate-signoff'
let env: RecoveryEnv

beforeEach(async () => {
  env = await RecoveryEnv.create()
  env.scripts.set('draft', (identity, attempt) => env.artifactReport(identity, `draft v${attempt}`))
  env.scripts.set('review', (identity) => [{ type: 'report', result: env.report(identity) }])
})

afterEach(async () => {
  await env.dispose()
})

/** A draft that needs a human sign-off on its artifact before the review may start. */
function heldPipeline() {
  return env.createRun(
    coordinatedCreateInput({
      children: [
        child('draft', {
          launchConfig: { maxRetries: 0 },
          stageAcceptance: {
            requiredArtifacts: [{ kind: 'draft', pathPattern: 'drafts/*.md', required: true }],
            requiredApprovals: [{ id: GATE, role: 'editor' }]
          }
        }),
        child('review', {
          dependencies: [{ childId: 'draft', condition: 'accepted' }],
          launchConfig: { maxRetries: 0 }
        })
      ]
    })
  )
}

function held(adapter: CoordinatedAutomationAdapter, runId: string) {
  return adapter.inspectProgress(runId)!.stages['draft'].pendingApproval!
}

function approval(runId: string, candidate: { dispatchId: string; reportDigest: string }) {
  const run = env.run(runId)
  return {
    automationRunId: runId,
    orchestrationRunId: run.orchestrationRunId ?? null,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    targetExecutionAuthority: `${run.resolvedSnapshot!.executionTarget.type}:${run.resolvedSnapshot!.executionTarget.id}`,
    gateId: GATE,
    decision: 'approve' as const,
    childDefinitionId: 'draft',
    taskId: env.taskId(runId, 'draft'),
    dispatchId: candidate.dispatchId,
    expectedReportDigest: candidate.reportDigest
  }
}

it('keeps the same held attempt across a Store/DB restart and duplicate reconciles, then accepts the approved candidate', async () => {
  const { runId } = heldPipeline()
  expect((await env.adapter.reconcileRun(runId)).state).toBe('waiting')
  const before = held(env.adapter, runId)

  await env.reopen()
  for (let i = 0; i < 2; i += 1) {
    const again = await env.adapter.reconcileRun(runId)
    expect(again.state).toBe('waiting')
    expect(again.reason).toContain(`awaits approval ${GATE}`)
  }
  expect(held(env.adapter, runId)).toEqual(before)
  expect(env.dispatchIds(runId, 'draft')).toEqual([before.dispatchId])
  expect(env.attempts.get('draft')).toBe(1)
  expect(env.attempts.get('review')).toBeUndefined()
  expect(env.run(runId).completionReceipt ?? null).toBeNull()

  const approved = await env.adapter.resolveGate(approval(runId, before))
  expect(approved).toMatchObject({ disposition: 'recorded', state: 'completed' })
  expect(env.adapter.inspectProgress(runId)!.approvals).toMatchObject([
    {
      scope: 'stage',
      approvalId: GATE,
      dispatchId: before.dispatchId,
      reportDigest: before.reportDigest
    }
  ])
  expect(env.dispatchIds(runId, 'draft')).toEqual([before.dispatchId])
  expect(env.attempts.get('review')).toBe(1)
})

it('refuses the approval and never accepts once the artifact bytes changed under the same report', async () => {
  const { runId } = heldPipeline()
  await env.adapter.reconcileRun(runId)
  const candidate = held(env.adapter, runId)
  writeFileSync(join(env.workspacePath, 'drafts/draft.md'), 'rewritten after the report')

  await expect(env.adapter.resolveGate(approval(runId, candidate))).rejects.toThrow(
    /no longer validates.*digest mismatch/
  )
  expect(env.adapter.inspectProgress(runId)!.approvals ?? []).toEqual([])

  const outcome = await env.adapter.reconcileRun(runId)
  expect(outcome.state).toBe('failed')
  expect(outcome.run.completionReceipt ?? null).toBeNull()
  const stage = env.adapter.inspectProgress(runId)!.stages['draft']
  expect(stage.status).toBe('rejected')
  expect(stage.pendingApproval ?? null).toBeNull()
  expect(env.attempts.get('review')).toBeUndefined()
})

it('makes an approver re-inspect when the same attempt now holds different report bytes', async () => {
  const { runId } = heldPipeline()
  await env.adapter.reconcileRun(runId)
  const first = held(env.adapter, runId)
  const taskId = env.taskId(runId, 'draft')
  const original = env.db.getTask(taskId)!.result!
  // Same Dispatch, same artifact, different report bytes.
  const changed = JSON.parse(original.slice(original.indexOf('\n{"') + 1)).structuredResult
  env.db.db
    .prepare('UPDATE tasks SET result = ? WHERE id = ?')
    .run(encodeCoordinatedWorkerReport({ ...changed, summary: 'a different claim' }), taskId)

  await expect(env.adapter.resolveGate(approval(runId, first))).rejects.toThrow(
    /inspect it again before deciding/
  )
  expect((await env.adapter.reconcileRun(runId)).state).toBe('waiting')
  const second = held(env.adapter, runId)
  expect(second.dispatchId).toBe(first.dispatchId)
  expect(second.reportDigest).not.toBe(first.reportDigest)
  // The dialog that showed the first bytes still cannot approve.
  await expect(env.adapter.resolveGate(approval(runId, first))).rejects.toThrow(
    /inspect it again before deciding/
  )
  expect(env.adapter.inspectProgress(runId)!.approvals ?? []).toEqual([])
  expect(env.attempts.get('review')).toBeUndefined()

  const approved = await env.adapter.resolveGate(approval(runId, second))
  expect(approved.state).toBe('completed')
  expect(env.attempts.get('draft')).toBe(1)
})

it('rejects, never accepts, a held report approved by its own author identity', async () => {
  const { runId } = heldPipeline()
  // This host treats the local operator as the author of the work it would be approving.
  const authored = new CoordinatedAutomationAdapter({
    store: env.store,
    orchestrationDb: env.db,
    workspacePath: env.workspacePath,
    progressStore: createMemoryCoordinatedRunProgressStore(),
    clock: env.clock(),
    workerProvider: env.workerProvider(),
    trustedAuthorIdentity: 'local_operator'
  })
  expect((await authored.reconcileRun(runId)).state).toBe('waiting')
  const candidate = held(authored, runId)

  const outcome = await authored.resolveGate(approval(runId, candidate))
  expect(outcome.state).toBe('failed')
  expect(outcome.run.completionReceipt ?? null).toBeNull()
  const stage = authored.inspectProgress(runId)!.stages['draft']
  expect(stage.status).toBe('rejected')
  expect(stage.lastError).toContain('self-approval')
  expect(env.attempts.get('review')).toBeUndefined()
})
