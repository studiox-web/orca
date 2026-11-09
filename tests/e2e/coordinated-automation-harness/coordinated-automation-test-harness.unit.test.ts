import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructuredWorkerResult } from '../../../src/shared/coordinated-automation-receipt-types'
import {
  BLOCKED_HARNESS_CAPABILITIES,
  CoordinatedAutomationTestHarness
} from './coordinated-automation-test-harness'
import { HARNESS_CRASH_POINTS, InjectedHarnessCrash, type HarnessEvent } from './event-time-crash'
import type { ScriptedWorkerIdentity } from './isolated-adapters'

const created: CoordinatedAutomationTestHarness[] = []
const digest = `sha256:${'a'.repeat(64)}`
const identity: ScriptedWorkerIdentity = {
  automationRunId: 'automation-run-1',
  orchestrationRunId: 'orchestration-run-1',
  childDefinitionId: 'writer',
  taskId: 'task-1',
  dispatchId: 'dispatch-1'
}

async function harness(startAt?: number): Promise<CoordinatedAutomationTestHarness> {
  const instance = await CoordinatedAutomationTestHarness.create(startAt)
  created.push(instance)
  return instance
}

function result(overrides: Partial<StructuredWorkerResult> = {}): StructuredWorkerResult {
  return {
    schemaVersion: 1,
    ...identity,
    definitionRevision: 1,
    resolvedConfigDigest: digest,
    outcome: 'succeeded',
    summary: 'Fake worker completed',
    artifacts: [],
    checks: [],
    effects: [],
    blockers: [],
    reportMarkdown: 'Fake report',
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((instance) => instance.dispose()))
})

describe('coordinated Automation deterministic test harness', () => {
  it('runs scheduled work in exact time and insertion order without system timers', async () => {
    const instance = await harness(10_000)
    const systemTimer = vi.spyOn(globalThis, 'setTimeout')
    const observed: string[] = []

    instance.clock.scheduleIn('later', 20, () => {
      observed.push('later')
    })
    instance.clock.scheduleIn('first-at-same-time', 10, () => {
      observed.push('first')
    })
    instance.clock.scheduleIn('second-at-same-time', 10, () => {
      observed.push('second')
    })
    await instance.clock.runUntilIdle()

    expect(observed).toEqual(['first', 'second', 'later'])
    expect(instance.clock.now()).toBe(10_020)
    expect(systemTimer).not.toHaveBeenCalled()
    systemTimer.mockRestore()
  })

  it('persists isolated Automation and orchestration evidence across reopen', async () => {
    const instance = await harness()
    await instance.automations.put({
      automationId: 'automation-1',
      automationRunId: identity.automationRunId,
      definitionRevision: 1,
      resolvedConfigDigest: digest,
      state: 'intent_persisted'
    })
    await instance.orchestration.putRun({
      orchestrationRunId: identity.orchestrationRunId,
      automationRunId: identity.automationRunId,
      state: 'created'
    })
    await instance.orchestration.putTask({ ...identity, state: 'ready' })
    await instance.orchestration.putReport(result())

    const reopened = instance.reopen()
    expect(await reopened.automations.get(identity.automationRunId)).toMatchObject({
      state: 'intent_persisted'
    })
    expect(await reopened.orchestration.read()).toMatchObject({
      runs: { [identity.orchestrationRunId]: { state: 'created' } },
      tasks: { [identity.taskId]: { state: 'ready' } },
      reports: { [identity.dispatchId]: { outcome: 'succeeded' } }
    })
  })

  it.each([
    'automation-store.after-durable-write',
    'automation-store.before-acknowledgement'
  ] as const)('exposes %s and preserves the committed write', async (point) => {
    const instance = await harness()
    instance.crashes.arm(point)

    await expect(
      instance.automations.put({
        automationId: 'automation-1',
        automationRunId: identity.automationRunId,
        definitionRevision: 1,
        resolvedConfigDigest: digest,
        state: 'intent_persisted'
      })
    ).rejects.toEqual(new InjectedHarnessCrash(point))

    expect(await instance.reopen().automations.get(identity.automationRunId)).toMatchObject({
      state: 'intent_persisted'
    })
  })

  it('exposes every required durable-write and acknowledgement crash point', () => {
    expect(HARNESS_CRASH_POINTS).toEqual([
      'automation-store.after-durable-write',
      'automation-store.before-acknowledgement',
      'orchestration-store.after-durable-write',
      'orchestration-store.before-acknowledgement',
      'artifact-store.after-durable-write',
      'artifact-store.before-acknowledgement',
      'worker-provider.before-acknowledgement',
      'effect-adapter.after-durable-write',
      'effect-adapter.before-acknowledgement'
    ])
  })

  it.each(HARNESS_CRASH_POINTS)('reaches the declared %s boundary', async (point) => {
    const instance = await harness()
    const automationRecord = {
      automationId: 'automation-1',
      automationRunId: identity.automationRunId,
      definitionRevision: 1,
      resolvedConfigDigest: digest,
      state: 'intent_persisted'
    }
    if (point.startsWith('worker-provider.')) {
      instance.workers.script({ identity, actions: [{ type: 'report', result: result() }] })
    }
    if (point === 'effect-adapter.before-acknowledgement') {
      await instance.effects.seed('effect-1', 'fake-effect')
    }
    instance.crashes.arm(point)

    const action = point.startsWith('automation-store.')
      ? instance.automations.put(automationRecord)
      : point.startsWith('orchestration-store.')
        ? instance.orchestration.putTask({ ...identity, state: 'ready' })
        : point.startsWith('artifact-store.')
          ? instance.artifacts.write('drafts/crash.md', 'crash')
          : point.startsWith('worker-provider.')
            ? instance.workers.run(identity)
            : point === 'effect-adapter.after-durable-write'
              ? instance.effects.seed('effect-1', 'fake-effect')
              : instance.effects.apply('effect-1')

    await expect(action).rejects.toEqual(new InjectedHarnessCrash(point))
  })

  it('controls artifact digests, missing files, and age staleness', async () => {
    const instance = await harness(50_000)
    const originalDigest = await instance.artifacts.write('drafts/article.md', 'original')
    expect(await instance.artifacts.inspect('drafts/article.md')).toMatchObject({
      exists: true,
      digest: originalDigest,
      stale: false
    })

    const changedDigest = await instance.artifacts.tamper('drafts/article.md', 'changed')
    expect(changedDigest).not.toBe(originalDigest)
    expect(await instance.artifacts.inspect('drafts/article.md')).toMatchObject({
      stale: true,
      staleReasons: ['digest_mismatch']
    })

    await instance.artifacts.write('drafts/article.md', 'changed')
    await instance.artifacts.markStale('drafts/article.md', 1_001)
    expect(
      await instance.artifacts.inspect('drafts/article.md', { maxAgeMs: 1_000 })
    ).toMatchObject({ stale: true, staleReasons: ['age_exceeded'] })

    await instance.artifacts.remove('drafts/article.md')
    expect(await instance.artifacts.inspect('drafts/article.md')).toEqual({
      uri: 'drafts/article.md',
      exists: false,
      stale: false,
      staleReasons: []
    })
  })

  it('rejects artifact paths outside its temporary root', async () => {
    const instance = await harness()
    await expect(instance.artifacts.write('/tmp/not-isolated', 'no')).rejects.toThrow(
      'Unsafe artifact URI'
    )
    await expect(instance.artifacts.write('../not-isolated', 'no')).rejects.toThrow(
      'Unsafe artifact URI'
    )
    await expect(instance.artifacts.write('file:///tmp/not-isolated', 'no')).rejects.toThrow(
      'Unsafe artifact URI'
    )
  })

  it('runs only scripted fake workers and replays the same report after a lost acknowledgement', async () => {
    const instance = await harness()
    instance.workers.script({
      identity,
      actions: [
        { type: 'write-artifact', uri: 'drafts/result.md', content: 'result' },
        {
          type: 'report',
          result: result({
            artifacts: [
              {
                kind: 'draft',
                uri: 'drafts/result.md',
                producerAttempt: { taskId: identity.taskId, dispatchId: identity.dispatchId }
              }
            ]
          })
        }
      ]
    })
    instance.crashes.arm('worker-provider.before-acknowledgement')

    await expect(instance.workers.run(identity)).rejects.toEqual(
      new InjectedHarnessCrash('worker-provider.before-acknowledgement')
    )
    await expect(instance.workers.run(identity)).resolves.toEqual(
      expect.objectContaining({ dispatchId: identity.dispatchId, outcome: 'succeeded' })
    )
    expect(await instance.artifacts.inspect('drafts/result.md')).toMatchObject({ exists: true })
  })

  it('fails closed on unscripted providers and mismatched report identities', async () => {
    const instance = await harness()
    await expect(instance.workers.run(identity)).rejects.toThrow('No fake worker script')
    instance.workers.script({
      identity,
      actions: [{ type: 'report', result: result({ taskId: 'wrong-task' }) }]
    })
    await expect(instance.workers.run(identity)).rejects.toThrow(
      'Fake worker report taskId did not match'
    )
  })

  it('models all effect states and retains uncertain state across a crash', async () => {
    const instance = await harness()
    await instance.effects.seed('publish-1', 'fake-publication')
    await instance.effects.script('publish-1', [
      'applied',
      'verified',
      'uncertain',
      'denied',
      'not_started'
    ])
    const observed: string[] = []
    for (let index = 0; index < 2; index += 1) {
      observed.push((await instance.effects.apply('publish-1')).state)
    }
    instance.crashes.arm('effect-adapter.before-acknowledgement')
    await expect(instance.effects.apply('publish-1')).rejects.toEqual(
      new InjectedHarnessCrash('effect-adapter.before-acknowledgement')
    )
    observed.push((await instance.reopen().effects.query('publish-1')).state)
    observed.push((await instance.effects.apply('publish-1')).state)
    observed.push((await instance.effects.apply('publish-1')).state)

    expect(observed).toEqual(['applied', 'verified', 'uncertain', 'denied', 'not_started'])
  })

  it('asserts exact event identities and ordering without sleeps', async () => {
    const instance = await harness(1_000)
    await instance.orchestration.putTask({ ...identity, state: 'ready' })
    const events = instance.trace.snapshot()
    const expected: HarnessEvent[] = [
      {
        sequence: 1,
        at: 1_000,
        type: 'orchestration-store.written',
        identity,
        detail: {}
      },
      {
        sequence: 2,
        at: 1_000,
        type: 'crash.boundary',
        identity,
        detail: { point: 'orchestration-store.after-durable-write' }
      },
      {
        sequence: 3,
        at: 1_000,
        type: 'crash.boundary',
        identity,
        detail: { point: 'orchestration-store.before-acknowledgement' }
      },
      {
        sequence: 4,
        at: 1_000,
        type: 'orchestration-store.acknowledged',
        identity,
        detail: {}
      }
    ]
    instance.trace.assertExact(expected)
    expect(events).toEqual(expected)
  })

  it('proves the harness is temp-only and has no production adapter imports', async () => {
    const instance = await harness()
    const proof = instance.isolationProof()
    expect(relative(resolve(tmpdir()), proof.root)).not.toMatch(/^\.\./)
    expect(proof).toMatchObject({
      mode: 'test-only',
      workerProvider: 'scripted-fake-worker-provider',
      effectAdapter: 'fake-effect-state-adapter',
      scheduler: 'in-process-fake-clock',
      blockedCapabilities: BLOCKED_HARNESS_CAPABILITIES
    })

    const directory = import.meta.dirname
    for (const file of [
      'event-time-crash.ts',
      'temporary-evidence-stores.ts',
      'temporary-artifact-store.ts',
      'isolated-adapters.ts',
      'coordinated-automation-test-harness.ts'
    ]) {
      const source = await readFile(join(directory, file), 'utf8')
      expect(source).not.toMatch(/src\/main\//)
      expect(source).not.toMatch(/child_process|fetch\(|setTimeout\(|setInterval\(/)
      expect(source).not.toMatch(
        /\/home\/djvibe\/projects|publish-content-production\.sh|run-production-daily\.sh/i
      )
    }
  })

  it('removes all temporary evidence on disposal', async () => {
    const instance = await harness()
    const root = instance.root
    await instance.artifacts.write('drafts/remove-me.md', 'temporary')
    await instance.dispose()
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
