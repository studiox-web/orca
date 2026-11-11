import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import type { CoordinatedRunProgress } from '../../../src/shared/coordinated-automation-progress-types'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { CoordinatedAutomationAdapter } from '../../../src/main/automations/coordinated-automation-adapter'
import { HARNESS_CRASH_POINTS, InjectedHarnessCrash } from './event-time-crash'
import type { FakeEffectState } from './isolated-adapters'
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

/** Writer drafts, a stage child applies the fake local-stage effect, a reviewer reads it. */
function effectPipeline(): CoordinatedAutomationCreateInput {
  return coordinatedCreateInput({
    publicationPolicy: {
      allowExternalMutation: true,
      requireHumanDecisionForProduction: false,
      allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
    },
    children: [
      child('draft', {
        mutationClass: 'exclusive_writer',
        mutationLane: 'content',
        launchConfig: { maxRetries: 1 },
        stageAcceptance: {
          requiredArtifacts: [{ kind: 'draft', pathPattern: 'drafts/*.md', required: true }]
        }
      }),
      child('stage', {
        dependencies: [{ childId: 'draft', condition: 'accepted' }],
        mutationClass: 'exclusive_writer',
        mutationLane: 'content',
        launchConfig: { maxRetries: 1 },
        stageAcceptance: { requiredEffects: [LOCAL_STAGE_EFFECT] }
      }),
      child('review', {
        dependencies: [{ childId: 'stage', condition: 'accepted' }],
        launchConfig: { maxRetries: 1 }
      })
    ]
  })
}

let env: RecoveryEnv
const STAGE_DEADLINE_MS = 1_800_000

async function startEffectRun(states: FakeEffectState[] = ['verified'], input = effectPipeline()) {
  const { runId } = env.createRun(input)
  const effectId = env.effectId(runId, 'stage', LOCAL_STAGE_EFFECT)
  await env.harness.effects.seed(effectId, LOCAL_STAGE_EFFECT.kind)
  await env.harness.effects.script(effectId, states)
  return { runId, effectId }
}

async function effectRecord(effectId: string) {
  return env.harness.effects.query(effectId)
}

beforeEach(async () => {
  env = await RecoveryEnv.create()
  env.scripts.set('draft', (identity, attempt) => env.artifactReport(identity, `draft v${attempt}`))
  for (const id of ['stage', 'review']) {
    env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await env.dispose()
})

async function interruptEffectIntent() {
  const run = await startEffectRun(['verified'], {
    ...effectPipeline(),
    globalCeilings: { maxWallClockSeconds: 60 }
  })
  env.crashAt('effect.after-intent')
  await expect(env.adapter.reconcileRun(run.runId)).rejects.toThrow(InjectedCoordinatorCrash)
  const progress = env.adapter.inspectProgress(run.runId)!
  expect(progress.effects[run.effectId]).toMatchObject({
    status: 'intent_recorded',
    applyAuthorizations: 1,
    receipt: null
  })
  expect((await effectRecord(run.effectId)).applyCount).toBe(0)
  const deadline =
    progress.startedAt +
    env.run(run.runId).resolvedSnapshot!.globalCeilings.maxWallClockSeconds! * 1000
  await env.reopen()
  return { ...run, progress, deadline }
}

function advanceDuringQuery(start: number, end: number) {
  const query = env.harness.effects.query.bind(env.harness.effects)
  return vi.spyOn(env.harness.effects, 'query').mockImplementationOnce(async (effectId) => {
    expect(env.harness.clock.now()).toBe(start)
    await env.harness.clock.advanceTo(end)
    return query(effectId)
  })
}

describe('coordinated recovery: effect deadline fences', () => {
  it('retains an authorized intent but does not start apply if its durable write reaches expiry', async () => {
    const { runId, effectId } = await startEffectRun(['verified'], {
      ...effectPipeline(),
      globalCeilings: { maxWallClockSeconds: 60 }
    })
    const deadline = env.harness.clock.now() + 60_000
    const boundaryHook = env.boundaryHook()
    vi.spyOn(env, 'boundaryHook').mockReturnValue((boundary, detail) => {
      boundaryHook(boundary, detail)
      if (boundary === 'effect.after-intent') {
        vi.spyOn(env.harness.clock, 'now').mockReturnValue(deadline)
      }
    })
    await env.reopen()
    const apply = vi.spyOn(env.harness.effects, 'apply')
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(outcome.progress!.effects[effectId]).toMatchObject({
      effectId,
      status: 'intent_recorded',
      receipt: null,
      applyAuthorizations: 1
    })
    expect(outcome.progress!.escalations).toEqual([
      expect.objectContaining({ code: 'wall_clock_ceiling', at: deadline })
    ])
    expect(outcome.run.completionReceipt).toBeNull()
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    await env.reopen()
    const replay = await env.adapter.reconcileRun(runId)
    expect(replay.progress!.effects).toEqual(outcome.progress!.effects)
    expect(apply).not.toHaveBeenCalled()
    expect((await effectRecord(effectId)).applyCount).toBe(0)
  })

  it.each([0, 1])(
    'does not reauthorize an intent when its query returns at deadline + %ims',
    async (offset) => {
      const { runId, effectId, progress, deadline } = await interruptEffectIntent()
      await env.harness.clock.advanceTo(deadline - 1)
      const query = advanceDuringQuery(deadline - 1, deadline + offset)
      const apply = vi.spyOn(env.harness.effects, 'apply')

      const outcome = await env.adapter.reconcileRun(runId)
      expect(query).toHaveBeenCalledExactlyOnceWith(effectId)
      expect.soft(apply).not.toHaveBeenCalled()
      expect.soft(outcome.progress!.effects).toEqual(progress.effects)
      expect(outcome.state).toBe('blocked')
      expect(outcome.run.completionReceipt).toBeNull()
      expect(outcome.progress!.halt).toMatchObject({ state: 'blocked', at: deadline + offset })
      expect(outcome.progress!.escalations).toEqual([
        expect.objectContaining({ code: 'wall_clock_ceiling', at: deadline + offset })
      ])
      expect(outcome.progress!.stages).toEqual(progress.stages)
      expect(outcome.progress!.reports).toEqual(progress.reports)
      expect(env.dispatchIds(runId, 'review')).toHaveLength(0)

      for (const restart of [false, true]) {
        if (restart) {
          await env.reopen()
        }
        const replay = await env.adapter.reconcileRun(runId)
        expect(replay.state).toBe('blocked')
        expect(replay.run.completionReceipt).toBeNull()
        expect(replay.progress!.halt).toEqual(outcome.progress!.halt)
        expect(replay.progress!.escalations).toEqual(outcome.progress!.escalations)
        expect.soft(replay.progress!.effects).toEqual(progress.effects)
        expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
      }
      expect(query).toHaveBeenCalledTimes(1)
      expect.soft(apply).not.toHaveBeenCalled()
      expect.soft((await effectRecord(effectId)).applyCount).toBe(0)
    }
  )

  it('recovers once when the awaited query returns one millisecond before the deadline', async () => {
    const { runId, effectId, progress, deadline } = await interruptEffectIntent()
    await env.harness.clock.advanceTo(deadline - 2)
    const query = advanceDuringQuery(deadline - 2, deadline - 1)
    const apply = vi.spyOn(env.harness.effects, 'apply')
    const outcome = await env.adapter.reconcileRun(runId)
    expect(query).toHaveBeenCalledExactlyOnceWith(effectId)
    expect(apply).toHaveBeenCalledExactlyOnceWith(effectId)
    expect(outcome.state).toBe('completed')
    expect(outcome.progress!.effects[effectId]).toEqual({
      ...progress.effects[effectId],
      status: 'verified',
      applyAuthorizations: 2,
      receipt: `fake-receipt:${effectId}:1`,
      updatedAt: deadline - 1
    })
    expect(outcome.progress!.halt).toBeNull()
    expect(outcome.run.completionReceipt!.effectReceipts).toHaveLength(1)
    expect(env.dispatchIds(runId, 'review')).toHaveLength(1)
    await env.harness.clock.advanceTo(deadline)
    await env.reopen()
    const replay = await env.adapter.reconcileRun(runId)
    expect(replay.run.completionReceipt).toEqual(outcome.run.completionReceipt)
    expect(apply).toHaveBeenCalledTimes(1)
    expect((await effectRecord(effectId)).applyCount).toBe(1)
  })

  it.each(['verified', 'uncertain', 'not_started'] as const)(
    'retains a %s result from an apply already in flight at expiry without replaying it',
    async (state) => {
      const { runId, effectId } = await startEffectRun([state], {
        ...effectPipeline(),
        globalCeilings: { maxWallClockSeconds: 60 }
      })
      const deadline = env.harness.clock.now() + 60_000
      const runApply = env.harness.effects.apply.bind(env.harness.effects)
      const apply = vi.spyOn(env.harness.effects, 'apply').mockImplementationOnce(async (id) => {
        await env.harness.clock.advanceTo(deadline)
        return runApply(id)
      })
      const outcome = await env.adapter.reconcileRun(runId)
      expect(apply).toHaveBeenCalledExactlyOnceWith(effectId)
      expect(outcome.progress!.effects[effectId]).toMatchObject({
        effectId,
        status: state === 'verified' ? 'verified' : 'uncertain',
        applyAuthorizations: 1,
        receipt: state === 'verified' ? `fake-receipt:${effectId}:1` : null
      })
      expect(outcome.progress!.escalations).toContainEqual(
        expect.objectContaining({ code: 'wall_clock_ceiling', at: deadline })
      )
      expect(outcome.run.completionReceipt).toBeNull()
      expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
      await env.reopen()
      const replay = await env.adapter.reconcileRun(runId)
      expect(replay.progress!.effects).toEqual(outcome.progress!.effects)
      expect(apply).toHaveBeenCalledTimes(1)
      expect((await effectRecord(effectId)).applyCount).toBe(1)
    }
  )

  it.each(['applied', 'verified', 'uncertain', 'denied'] as const)(
    'retains a late %s query observation without authorizing another apply',
    async (state) => {
      const { runId, effectId, progress, deadline } = await interruptEffectIntent()
      const receipt =
        state === 'applied' || state === 'verified' ? 'fake-receipt:observed' : undefined
      await env.harness.effects.exposeExternalState(effectId, state, receipt)
      await env.harness.clock.advanceTo(deadline - 1)
      const query = advanceDuringQuery(deadline - 1, deadline)
      const apply = vi.spyOn(env.harness.effects, 'apply')
      const outcome = await env.adapter.reconcileRun(runId)
      expect(query).toHaveBeenCalledExactlyOnceWith(effectId)
      expect(apply).not.toHaveBeenCalled()
      expect(outcome.progress!.effects[effectId]).toEqual({
        ...progress.effects[effectId],
        status: state,
        receipt: receipt ?? null,
        updatedAt: deadline
      })
      expect(outcome.progress!.escalations).toContainEqual(
        expect.objectContaining({ code: 'wall_clock_ceiling', at: deadline })
      )
      if (state === 'uncertain' || state === 'denied') {
        expect(outcome.progress!.escalations).toContainEqual(
          expect.objectContaining({
            code: state === 'uncertain' ? 'uncertain_effect' : 'effect_denied'
          })
        )
      }
      expect(outcome.run.completionReceipt).toBeNull()
      expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
      await env.reopen()
      const replay = await env.adapter.reconcileRun(runId)
      expect(replay.progress!.effects).toEqual(outcome.progress!.effects)
      expect(replay.progress!.halt).toEqual(outcome.progress!.halt)
      expect(replay.run.completionReceipt).toBeNull()
      expect(apply).not.toHaveBeenCalled()
    }
  )
})

describe('coordinated recovery: uncertain-effect gates', () => {
  it('applies a verified fake effect exactly once and binds its receipt', async () => {
    const { runId, effectId } = await startEffectRun()
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    expect(outcome.run.completionReceipt!.effectReceipts).toEqual([
      expect.objectContaining({ kind: 'local-stage', status: 'verified' })
    ])
    expect((await effectRecord(effectId)).applyCount).toBe(1)
  })

  it('refuses effect stages when no fake effect adapter is configured', async () => {
    const { runId } = await startEffectRun()
    const refusing = new CoordinatedAutomationAdapter({
      store: env.store,
      orchestrationDb: env.db,
      workerProvider: { capability: 'fake_no_effects', run: async () => null }
    })
    await expect(refusing.reconcileRun(runId)).rejects.toThrow(/fake effect adapter/)
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(0)
  })

  it('uncertain apply stops the mutation lane; restart queries instead of replaying', async () => {
    const { runId, effectId } = await startEffectRun(['uncertain'])
    const first = await env.adapter.reconcileRun(runId)
    expect(first.state).toBe('outcome_uncertain')
    expect(first.run.completionReceipt).toBeNull()
    expect(first.run.status).not.toBe('completed')
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)

    await env.reopen()
    const second = await env.adapter.reconcileRun(runId)
    expect(second.state).toBe('outcome_uncertain')
    const record = await effectRecord(effectId)
    expect(record.applyCount).toBe(1)
    expect(record.queryCount).toBeGreaterThanOrEqual(2)
    expect(env.adapter.inspectProgress(runId)!.escalations).toEqual([
      expect.objectContaining({ code: 'uncertain_effect', requiresHumanDecision: true })
    ])
  })

  it('an exact matching receipt that appears later verifies the effect without replay', async () => {
    const { runId, effectId } = await startEffectRun(['uncertain'])
    expect((await env.adapter.reconcileRun(runId)).state).toBe('outcome_uncertain')

    await env.harness.effects.exposeExternalState(effectId, 'verified', 'fake-receipt:exact')
    await env.reopen()
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    expect(outcome.run.completionReceipt!.effectReceipts).toEqual([
      expect.objectContaining({ receipt: 'fake-receipt:exact', status: 'verified' })
    ])
    expect((await effectRecord(effectId)).applyCount).toBe(1)
    expect(env.dispatchIds(runId, 'review')).toHaveLength(1)
  })

  it('no matching receipt keeps the run uncertain and awaiting a human decision', async () => {
    const { runId, effectId } = await startEffectRun(['uncertain'])
    for (let round = 0; round < 3; round += 1) {
      await env.harness.clock.advanceBy(60_000)
      await env.reopen()
      const outcome = await env.adapter.reconcileRun(runId)
      expect(outcome.state).toBe('outcome_uncertain')
      expect(outcome.run.completionReceipt).toBeNull()
    }
    expect((await effectRecord(effectId)).applyCount).toBe(1)
    expect(env.adapter.inspectProgress(runId)!.escalations).toHaveLength(1)
  })

  it('an applied-but-unverified effect waits and never completes on "applied"', async () => {
    const { runId, effectId } = await startEffectRun(['applied'])
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('waiting')
    expect(outcome.run.completionReceipt).toBeNull()
    await env.harness.effects.exposeExternalState(effectId, 'verified', 'fake-receipt:later')
    expect((await env.adapter.reconcileRun(runId)).state).toBe('completed')
    expect((await effectRecord(effectId)).applyCount).toBe(1)
  })

  it('a denied effect fails the run', async () => {
    const { runId } = await startEffectRun(['denied'])
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('failed')
    expect(outcome.run.completionReceipt).toBeNull()
  })
})

type NormalizedProgress = {
  stages: Record<string, string>
  effects: string[]
  halt: CoordinatedRunProgress['halt']
}

function normalize(progress: CoordinatedRunProgress): NormalizedProgress {
  return {
    stages: Object.fromEntries(Object.entries(progress.stages).map(([id, s]) => [id, s.status])),
    effects: Object.values(progress.effects).map((e) => `${e.kind}:${e.status}`),
    halt: progress.halt
  }
}

describe('coordinated recovery: crash at every durable boundary', () => {
  it(
    'every coordinator write boundary converges to the clean outcome with one fake effect',
    async () => {
      const clean = await startEffectRun()
      expect((await env.adapter.reconcileRun(clean.runId)).state).toBe('completed')
      const expected = normalize(env.adapter.inspectProgress(clean.runId)!)
      const boundaryCount = env.boundaries.length
      expect(new Set(env.boundaries.map((b) => b.boundary))).toEqual(
        new Set([
          'progress.after-write',
          'dispatch.after-native-start',
          'dispatch.after-mapping',
          'report.after-native-settle',
          'effect.after-intent',
          'effect.after-adapter-ack',
          'receipt.after-persist'
        ])
      )
      await env.dispose()

      for (let index = 0; index < boundaryCount; index += 1) {
        env = await RecoveryEnv.create()
        env.scripts.set('draft', (identity, attempt) =>
          env.artifactReport(identity, `draft v${attempt}`)
        )
        for (const id of ['stage', 'review']) {
          env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
        }
        const { runId, effectId } = await startEffectRun()
        env.crashAtBoundaryIndex = index
        await expect(env.adapter.reconcileRun(runId), `boundary #${index}`).rejects.toThrow(
          InjectedCoordinatorCrash
        )

        await env.reopen()
        let recovered = await env.adapter.reconcileRun(runId)
        // An orphaned attempt keeps its persisted deadline; recovery resumes once it passes.
        for (let round = 0; recovered.state === 'waiting' && round < 3; round += 1) {
          await env.harness.clock.advanceBy(STAGE_DEADLINE_MS)
          recovered = await env.adapter.reconcileRun(runId)
        }
        expect(recovered.state, `boundary #${index}`).toBe('completed')
        expect(normalize(env.adapter.inspectProgress(runId)!), `boundary #${index}`).toEqual(
          expected
        )
        expect((await effectRecord(effectId)).applyCount, `boundary #${index}`).toBe(1)
        expect(recovered.run.completionReceipt!.effectReceipts).toHaveLength(1)

        await env.reopen()
        const replayed = await env.adapter.reconcileRun(runId)
        expect(replayed.run.completionReceipt).toEqual(recovered.run.completionReceipt)
        if (index < boundaryCount - 1) {
          await env.dispose()
        }
      }
    },
    // Sweeps ~20 full crash/reopen cycles over real SQLite and Store files; deterministic but I/O bound.
    120_000
  )

  it(
    'every harness crash point converges without a duplicate effect or false completion',
    async () => {
      for (const point of HARNESS_CRASH_POINTS) {
        if (point.startsWith('automation-store') || point.startsWith('orchestration-store')) {
          continue
        }
        await env.dispose()
        env = await RecoveryEnv.create()
        env.scripts.set('draft', (identity, attempt) =>
          env.artifactReport(identity, `draft v${attempt}`)
        )
        for (const id of ['stage', 'review']) {
          env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
        }
        const { runId, effectId } = await startEffectRun()
        env.harness.crashes.arm(point)
        const first = await env.adapter.reconcileRun(runId).catch((error: unknown) => {
          expect(error, point).toBeInstanceOf(InjectedHarnessCrash)
          return null
        })
        if (first) {
          expect(first.state, point).toBe('completed')
        } else {
          expect(env.run(runId).completionReceipt, point).toBeNull()
          await env.reopen()
          expect((await env.adapter.reconcileRun(runId)).state, point).toBe('completed')
        }
        env.harness.crashes.disarm()
        expect((await effectRecord(effectId)).applyCount, point).toBe(1)
      }
    },
    // Sweeps every harness crash point with a full reopen each; deterministic but I/O bound.
    120_000
  )
})
