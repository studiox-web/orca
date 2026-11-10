import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import type { CoordinatedAutomationChildDefinition } from '../../../src/shared/coordinated-automation-types'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { CoordinatedGenerationFencedError } from '../../../src/main/automations/coordinated-automation-progress-ledger'
import type { CoordinatedWorkerIdentity } from '../../../src/main/automations/coordinated-automation-adapter'
import type { ScriptedWorkerAction } from './isolated-adapters'
import {
  InjectedCoordinatorCrash,
  LOCAL_STAGE_EFFECT,
  RecoveryEnv
} from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const DRAFTS = { kind: 'draft', pathPattern: 'drafts/*.md', required: true }

function draft(overrides: Partial<CoordinatedAutomationChildDefinition> = {}) {
  return child('draft', {
    mutationClass: 'exclusive_writer',
    mutationLane: 'content',
    launchConfig: { maxRetries: 0 },
    stageAcceptance: { requiredArtifacts: [DRAFTS] },
    ...overrides
  })
}

function review(overrides: Partial<CoordinatedAutomationChildDefinition> = {}) {
  return child('review', {
    dependencies: [{ childId: 'draft', condition: 'accepted' }],
    launchConfig: { maxRetries: 0 },
    ...overrides
  })
}

function pipeline(children = [draft(), review()]): CoordinatedAutomationCreateInput {
  return coordinatedCreateInput({ children })
}

let env: RecoveryEnv

beforeEach(async () => {
  env = await RecoveryEnv.create()
  env.scripts.set('draft', (identity, attempt) => env.artifactReport(identity, `draft v${attempt}`))
  env.scripts.set('review', (identity) => [{ type: 'report', result: env.report(identity) }])
})

afterEach(async () => {
  await env.dispose()
})

function lineage(runId: string, id: string) {
  return env.adapter.inspectProgress(runId)!.stages[id].lineage
}

function nativeRetryOf(dispatchId: string): string | null {
  return env.db.getDispatchContextById(dispatchId)!.retry_of_dispatch_id
}

/** Starts a draft attempt outside the coordinator, as an external worker_done delivery would. */
async function externalDraftAttempt(runId: string) {
  await env.adapter.materializeRun(runId)
  const taskId = env.taskId(runId, 'draft')
  const { dispatch } = env.db.createStartingWorkerDispatch({
    taskId,
    creator: { kind: 'system' },
    maxDepth: 5,
    startOptions: {}
  })
  env.store.recordCoordinatedChildDispatch({
    automationRunId: runId,
    childDefinitionId: 'draft',
    dispatchId: dispatch.id
  })
  const identity: CoordinatedWorkerIdentity = {
    automationRunId: runId,
    orchestrationRunId: env.run(runId).orchestrationRunId!,
    childDefinitionId: 'draft',
    taskId,
    dispatchId: dispatch.id
  }
  return { taskId, dispatchId: dispatch.id, identity }
}

describe('semantic rejection reconciles native state', () => {
  it('a natively completed but semantically rejected attempt cannot release dependents', async () => {
    const { runId } = env.createRun(pipeline())
    const external = await externalDraftAttempt(runId)
    // Structurally valid and "succeeded", but missing the required draft artifact.
    const submitted = env.adapter.submitWorkerReport({
      automationRunId: runId,
      taskId: external.taskId,
      dispatchId: external.dispatchId,
      report: env.report(external.identity)
    })
    expect(submitted.disposition).toBe('settled')
    const reviewTask = env.taskId(runId, 'review')
    expect(env.db.getTask(external.taskId)!.status).toBe('completed')
    expect(env.db.getTask(reviewTask)!.status).toBe('ready')
    expect(await env.adapter.dispatchReadyTasks(runId)).toEqual([])

    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('failed')
    expect(outcome.run.status).toBe('dispatch_failed')
    expect(env.db.getTask(external.taskId)!.status).toBe('failed')
    expect(env.db.getTask(reviewTask)!.status).toBe('pending')
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    expect(await env.adapter.dispatchReadyTasks(runId)).toEqual([])
  })

  it('a retry after semantic rejection keeps logical retryOf and gates the dependent', async () => {
    const { runId } = env.createRun(
      pipeline([draft({ launchConfig: { maxRetries: 1 } }), review()])
    )
    const external = await externalDraftAttempt(runId)
    env.adapter.submitWorkerReport({
      automationRunId: runId,
      taskId: external.taskId,
      dispatchId: external.dispatchId,
      report: env.report(external.identity)
    })
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    const [first, retry] = env.dispatchIds(runId, 'draft')
    expect(first).toBe(external.dispatchId)
    expect(lineage(runId, 'draft')).toEqual([
      expect.objectContaining({ kind: 'retry', dispatchId: retry, retryOfDispatchId: first })
    ])
    expect(env.dispatchIds(runId, 'review')).toHaveLength(1)
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.reports.map((r) => `${r.childDefinitionId}:${r.disposition}`)).toEqual([
      'draft:rejected',
      'draft:accepted',
      'review:accepted'
    ])
  })
})

describe('retry lineage survives crash and reload', () => {
  it('chains retryOf across multiple retries, a crash before binding, and reloads', async () => {
    env.scripts.set('draft', (identity, attempt) =>
      attempt === 1
        ? [{ type: 'report', result: env.report(identity, { outcome: 'failed', checks: [] }) }]
        : env.artifactReport(identity, `draft v${attempt}`)
    )
    const { runId } = env.createRun(
      pipeline([draft({ launchConfig: { maxRetries: 2 } }), review()])
    )
    env.crashAt('dispatch.after-native-start', 2)
    await expect(env.adapter.reconcileRun(runId)).rejects.toThrow(InjectedCoordinatorCrash)
    expect(lineage(runId, 'draft').at(-1)).toMatchObject({ status: 'starting', dispatchId: null })

    await env.reopen()
    const waiting = await env.adapter.reconcileRun(runId)
    expect(waiting.state).toBe('waiting')
    const [d1, d2] = env.dispatchIds(runId, 'draft')
    const bound = lineage(runId, 'draft')[1]
    expect(bound).toMatchObject({ status: 'active', dispatchId: d2, retryOfDispatchId: d1 })

    await env.harness.clock.advanceBy(bound.deadlineAt - env.harness.clock.now())
    await env.reopen()
    expect((await env.adapter.reconcileRun(runId)).state).toBe('completed')

    await env.reopen()
    const [, , d3] = env.dispatchIds(runId, 'draft')
    expect(
      lineage(runId, 'draft').map((r) => [r.kind, r.dispatchId, r.retryOfDispatchId, r.status])
    ).toEqual([
      ['initial', d1, null, 'admitted'],
      ['retry', d2, d1, 'admitted'],
      ['retry', d3, d2, 'admitted']
    ])
    expect([nativeRetryOf(d2), nativeRetryOf(d3)]).toEqual([d1, d2])
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'stage_timeout'
    ])
  })
})

describe('generation fencing', () => {
  it('a replaced generation cannot settle, append audit records, or overwrite progress', async () => {
    let releaseDraft: (actions: ScriptedWorkerAction[]) => void = () => {}
    env.scripts.set(
      'draft',
      () => new Promise<ScriptedWorkerAction[]>((resolve) => (releaseDraft = resolve))
    )
    const { runId } = env.createRun(pipeline())
    const old = env.adapter
    const oldRun = old.reconcileRun(runId)
    await vi.waitFor(() => expect(env.dispatchIds(runId, 'draft')).toHaveLength(1))
    const [d1] = env.dispatchIds(runId, 'draft')

    const replacement = env.replacementAdapter()
    expect((await replacement.reconcileRun(runId)).state).toBe('waiting')
    const sequence = env.adapter.inspectProgress(runId)!.sequence
    const identity: CoordinatedWorkerIdentity = {
      automationRunId: runId,
      orchestrationRunId: env.run(runId).orchestrationRunId!,
      childDefinitionId: 'draft',
      taskId: env.taskId(runId, 'draft'),
      dispatchId: d1
    }
    expect(() =>
      old.submitWorkerReport({
        automationRunId: runId,
        taskId: identity.taskId,
        dispatchId: d1,
        report: env.report(identity)
      })
    ).toThrow(CoordinatedGenerationFencedError)

    releaseDraft(env.artifactReport(identity, 'late draft'))
    await expect(oldRun).rejects.toThrow(CoordinatedGenerationFencedError)
    expect(env.adapter.inspectProgress(runId)!.sequence).toBe(sequence)
    expect(env.db.getDispatchContextById(d1)!.status).not.toBe('completed')

    const resubmitted = replacement.submitWorkerReport({
      automationRunId: runId,
      taskId: identity.taskId,
      dispatchId: d1,
      report: env.report(identity, {
        artifacts: env
          .artifactReport(identity, 'late draft')
          .flatMap((a) => (a.type === 'report' ? a.result.artifacts : []))
      })
    })
    expect(resubmitted.disposition).toBe('settled')
    expect((await replacement.reconcileRun(runId)).state).toBe('completed')
  })

  it('records foreign and stale reports durably even before any reconcile', async () => {
    const { runId } = env.createRun(pipeline())
    await env.adapter.materializeRun(runId)
    const foreign = env.adapter.submitWorkerReport({
      automationRunId: runId,
      taskId: 'task_000000000000',
      dispatchId: 'ctx_000000000000',
      report: { schemaVersion: 1 }
    })
    expect(foreign.disposition).toBe('stale')
    await env.reopen()
    expect(env.adapter.inspectProgress(runId)!.reports).toEqual([
      expect.objectContaining({ dispatchId: 'ctx_000000000000', disposition: 'stale' })
    ])
  })
})

describe('fixer concurrency', () => {
  async function runSharedArtifactFixes(maxActiveFixersPerArtifact: number) {
    const observed: number[] = []
    for (const id of ['w1', 'w2']) {
      env.scripts.set(id, (identity, attempt) => {
        if (attempt > 1) {
          observed.push(env.running)
        }
        return env.artifactReport(identity, `${id} v${attempt}`)
      })
    }
    env.scripts.set('review', (identity, attempt) => [
      {
        type: 'report',
        result:
          attempt === 1
            ? env.report(identity, {
                outcome: 'failed',
                blockers: [{ code: 'SHARED', message: 'Fix both', resolvableBy: 'upstream_fix' }]
              })
            : env.report(identity)
      }
    ])
    const writers = ['w1', 'w2'].map((id) =>
      child(id, {
        mutationClass: 'exclusive_writer',
        mutationLane: `lane-${id}`,
        launchConfig: { maxRetries: 0 },
        stageAcceptance: { requiredArtifacts: [DRAFTS] }
      })
    )
    const reviewer = child('review', {
      dependencies: [
        { childId: 'w1', condition: 'accepted' },
        { childId: 'w2', condition: 'accepted' }
      ],
      launchConfig: { maxRetries: 0 }
    })
    const { runId } = env.createRun(
      coordinatedCreateInput({
        children: [...writers, reviewer],
        globalCeilings: { maxActiveFixersPerArtifact }
      })
    )
    const outcome = await env.adapter.reconcileRun(runId)
    return { runId, outcome, observed }
  }

  it('holds fixes on a shared artifact to the configured lease count', async () => {
    const limited = await runSharedArtifactFixes(1)
    expect([limited.outcome.state, limited.outcome.reason]).toEqual(['completed', null])
    expect(limited.observed).toEqual([1, 1])
    const fixes = ['w1', 'w2'].map((id) => lineage(limited.runId, id)[1])
    expect(fixes.map((r) => [r.kind, r.leaseKeys, r.status])).toEqual([
      ['fix', ['artifact-pattern:drafts/*.md', 'artifact-uri:drafts/w1.md'], 'admitted'],
      ['fix', ['artifact-pattern:drafts/*.md', 'artifact-uri:drafts/w2.md'], 'admitted']
    ])
  })

  it('allows parallel fixes when the ceiling permits them', async () => {
    const open = await runSharedArtifactFixes(2)
    expect(open.outcome.state).toBe('completed')
    expect(Math.max(...open.observed)).toBe(2)
  })
})

describe('stage timeout', () => {
  it('times out a hung worker on its persisted deadline and retries with lineage', async () => {
    env.scripts.set('draft', (identity, attempt) =>
      attempt === 1
        ? new Promise<ScriptedWorkerAction[]>(() => {})
        : env.artifactReport(identity, 'draft v2')
    )
    const { runId } = env.createRun(
      pipeline([draft({ launchConfig: { maxRetries: 1, timeoutSeconds: 60 } }), review()])
    )
    const running = env.adapter.reconcileRun(runId)
    await vi.waitFor(() => expect(lineage(runId, 'draft')[0]?.status).toBe('active'))
    const first = lineage(runId, 'draft')[0]
    expect(first.deadlineAt - first.startedAt).toBe(60_000)

    await env.harness.clock.advanceBy(60_000)
    const outcome = await running
    expect(outcome.state).toBe('completed')
    const [d1, d2] = env.dispatchIds(runId, 'draft')
    expect(lineage(runId, 'draft')[1]).toMatchObject({ kind: 'retry', retryOfDispatchId: d1 })
    expect(nativeRetryOf(d2)).toBe(d1)
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'stage_timeout'
    ])
  })

  it('a replacement generation keeps the original deadline across restart', async () => {
    env.scripts.set('draft', (identity, attempt) =>
      attempt === 1
        ? new Promise<ScriptedWorkerAction[]>(() => {})
        : env.artifactReport(identity, 'draft v2')
    )
    const { runId } = env.createRun(
      pipeline([draft({ launchConfig: { maxRetries: 1, timeoutSeconds: 60 } }), review()])
    )
    const old = env.adapter.reconcileRun(runId)
    await vi.waitFor(() => expect(lineage(runId, 'draft')[0]?.status).toBe('active'))
    const deadline = lineage(runId, 'draft')[0].deadlineAt

    await env.harness.clock.advanceBy(30_000)
    const replacement = env.replacementAdapter()
    const early = await replacement.reconcileRun(runId)
    expect(early.state).toBe('waiting')
    expect(lineage(runId, 'draft')[0].deadlineAt).toBe(deadline)
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(1)

    await env.harness.clock.advanceBy(30_000)
    await expect(old).rejects.toThrow(CoordinatedGenerationFencedError)
    const resumed = await replacement.reconcileRun(runId)
    expect(resumed.state).toBe('completed')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(2)
  })
})

describe('review resets and effects', () => {
  function effectPipeline(reviewDependency: 'accepted' | 'completed' = 'accepted') {
    return coordinatedCreateInput({
      publicationPolicy: {
        allowExternalMutation: true,
        requireHumanDecisionForProduction: false,
        allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
      },
      children: [
        draft(),
        child('stage', {
          dependencies: [{ childId: 'draft', condition: 'accepted' }],
          mutationClass: 'exclusive_writer',
          mutationLane: 'content',
          launchConfig: { maxRetries: 0 },
          stageAcceptance: { requiredEffects: [LOCAL_STAGE_EFFECT] }
        }),
        child('review', {
          dependencies: [{ childId: 'stage', condition: reviewDependency }],
          launchConfig: { maxRetries: 0 }
        })
      ]
    })
  }

  async function seedEffect(runId: string, states: ('verified' | 'uncertain')[]) {
    const effectId = env.effectId(runId, 'stage', LOCAL_STAGE_EFFECT)
    await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
    await env.harness.effects.script(effectId, states)
    return effectId
  }

  function findingReview() {
    env.scripts.set('stage', (identity) => [{ type: 'report', result: env.report(identity) }])
    env.scripts.set('review', (identity) => [
      {
        type: 'report',
        result: env.report(identity, {
          outcome: 'failed',
          blockers: [{ code: 'STAGE', message: 'Restage it', resolvableBy: 'upstream_fix' }]
        })
      }
    ])
  }

  it('refuses to reopen a stage whose effect already ran and never replays it', async () => {
    findingReview()
    const { runId } = env.createRun(effectPipeline())
    const effectId = await seedEffect(runId, ['verified'])
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(outcome.run.status).toBe('dispatched')
    expect(outcome.run.error).toContain('blocked')
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.stage.status).toBe('accepted')
    expect(progress.escalations.map((e) => e.code)).toEqual(['effect_reset_conflict'])
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
    expect(env.dispatchIds(runId, 'stage')).toHaveLength(1)
  })

  it('does not target a `completed`-condition input with a review finding', async () => {
    findingReview()
    const { runId } = env.createRun(effectPipeline('completed'))
    await seedEffect(runId, ['verified'])
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(env.adapter.inspectProgress(runId)!.stages.stage.reviewIterations).toBe(0)
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'stage_rejected'
    ])
  })

  it('uncertain effects stay unreplayed across deadlines and restarts and hold the Store run', async () => {
    env.scripts.set('stage', (identity) => [{ type: 'report', result: env.report(identity) }])
    const { runId } = env.createRun(effectPipeline())
    const effectId = await seedEffect(runId, ['uncertain'])
    for (let round = 0; round < 3; round += 1) {
      const outcome = await env.adapter.reconcileRun(runId)
      expect([outcome.state, outcome.reason, round]).toEqual([
        'outcome_uncertain',
        expect.any(String),
        round
      ])
      expect(outcome.run.status).toBe('dispatched')
      expect(outcome.run.error).toContain('outcome_uncertain')
      await env.harness.clock.advanceBy(3_600_000)
      await env.reopen()
    }
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
  })
})
