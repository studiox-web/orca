import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../src/shared/automations-types'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import { coordinatedCreateInput } from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import {
  CoordinatedHostStoppedError,
  FAKE_EFFECT_ADAPTER_KIND,
  type CoordinatedFakeEffectAdapter
} from '../../../src/main/automations/coordinated-automation-recovery-context'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import { inspectCoordinatedRun } from '../../../src/main/automations/coordinated-automation-run-inspection'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import { LOCAL_STAGE_EFFECT } from './coordinated-automation-recovery-env'
import {
  SELF,
  disposeRunHostFixture,
  effectDefinition,
  enableSetting,
  env,
  hostProgress,
  injection,
  request,
  seedEffect,
  services,
  setupRunHostFixture,
  startService
} from './coordinated-automation-run-host-fixture'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

beforeEach(setupRunHostFixture)
afterEach(disposeRunHostFixture)

/** Wraps the harness fake effect adapter so one apply or query can be held open. */
function heldEffects() {
  let armed: 'apply' | 'query' | null = null
  let reached = false
  let release: (outcome: 'resolve' | 'reject') => void = () => {}
  const hold = async <T>(operation: 'apply' | 'query', run: () => Promise<T>): Promise<T> => {
    if (armed !== operation) {
      return run()
    }
    armed = null
    reached = true
    const outcome = await new Promise<'resolve' | 'reject'>((resolve) => (release = resolve))
    if (outcome === 'reject') {
      throw new Error(`fake ${operation} transport failed`)
    }
    return run()
  }
  const adapter: CoordinatedFakeEffectAdapter = {
    kind: FAKE_EFFECT_ADAPTER_KIND,
    apply: (effectId) => hold('apply', () => env.harness.effects.apply(effectId)),
    query: (effectId) => hold('query', () => env.harness.effects.query(effectId))
  }
  return {
    adapter,
    arm: (operation: 'apply' | 'query') => (armed = operation),
    reached: () => reached,
    release: (outcome: 'resolve' | 'reject') => release(outcome)
  }
}

async function restartAndFinish(automationId: string) {
  services.splice(0).forEach((service) => service.stop())
  await env.reopen()
  enableSetting()
  return startService({ injection: injection() }).coordinatedRuns.startManualRun(
    request(automationId)
  )
}

describe('stop fences post-await effect continuations', () => {
  it.each(['resolve', 'reject'] as const)(
    'a pending apply that settles late (%s) writes nothing; restart queries without a second apply',
    async (late) => {
      const held = heldEffects()
      const automationId = await seedEffect(
        env.createDefinitionOnly(effectDefinition()).automationId,
        ['verified']
      )
      const service = startService({
        injection: injection({ effects: { policy: 'fake', adapter: held.adapter } })
      })
      held.arm('apply')
      const pending = service.coordinatedRuns.startManualRun(request(automationId))
      await vi.waitFor(() => expect(held.reached()).toBe(true))
      const [run] = env.store.listAutomationRuns(automationId)
      const before = hostProgress(run.id)
      expect(Object.values(before!.effects).map((e) => e.status)).toEqual(['intent_recorded'])

      service.stop()
      held.release(late)
      await expect(pending).rejects.toThrow(
        late === 'resolve' ? CoordinatedHostStoppedError : /transport failed/
      )
      expect(hostProgress(run.id)).toEqual(before)
      expect(env.run(run.id).completionReceipt).toBeNull()
      expect(env.run(run.id).status).not.toBe('completed')

      const effectId = env.effectId(run.id, 'stage', LOCAL_STAGE_EFFECT)
      const finished = await restartAndFinish(automationId)
      expect(finished).toMatchObject({ created: false, state: 'completed' })
      expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
      expect(finished.inspection.receipt.kind).toBe('available')
    }
  )

  it('a pending query that resolves after stop writes nothing; restart verifies without replay', async () => {
    const held = heldEffects()
    const automationId = await seedEffect(
      env.createDefinitionOnly(effectDefinition()).automationId,
      ['applied']
    )
    const service = startService({
      injection: injection({ effects: { policy: 'fake', adapter: held.adapter } })
    })
    const waiting = await service.coordinatedRuns.startManualRun(request(automationId))
    expect(waiting.state).toBe('waiting')
    const scope = { automationId, automationRunId: waiting.automationRunId, expectedOwner: SELF }
    const effectId = env.effectId(waiting.automationRunId, 'stage', LOCAL_STAGE_EFFECT)
    const before = hostProgress(waiting.automationRunId)

    held.arm('query')
    const pending = service.coordinatedRuns.reconcileRun(scope)
    await vi.waitFor(() => expect(held.reached()).toBe(true))
    service.stop()
    await env.harness.effects.exposeExternalState(effectId, 'verified', 'fake-receipt:late')
    held.release('resolve')
    await expect(pending).rejects.toThrow(CoordinatedHostStoppedError)
    const after = hostProgress(waiting.automationRunId)!
    expect(Object.values(after.effects).map((e) => e.status)).toEqual(['applied'])
    expect(after.sequence).toBe(before!.sequence + 1)
    expect(env.run(waiting.automationRunId).completionReceipt).toBeNull()

    const finished = await restartAndFinish(automationId)
    expect(finished.state).toBe('completed')
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
  })
})

const progressRoot = () => join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)

function progressBytes(automationRunId: string): string | null {
  const path = join(
    progressRoot(),
    `${createHash('sha256').update(automationRunId).digest('hex')}.json`
  )
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function nativeRows(): string {
  return JSON.stringify([
    env.db.db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    env.db.db.prepare('SELECT * FROM dispatch_contexts ORDER BY id').all(),
    env.db.db.prepare('SELECT * FROM runs ORDER BY id').all()
  ])
}

function mappingsOf(run: AutomationRun) {
  return run.childMappings ?? []
}

function taskOf(run: AutomationRun, index: number): string {
  return mappingsOf(run)[index].taskId
}

function dispatchOf(run: AutomationRun, index: number): string {
  const dispatchId = mappingsOf(run)[index].dispatchId
  if (!dispatchId) {
    throw new Error(`Child ${index} has no mapped Dispatch`)
  }
  return dispatchId
}

function orchestrationRunOf(run: AutomationRun): string {
  if (!run.orchestrationRunId) {
    throw new Error('Run has no orchestration Run')
  }
  return run.orchestrationRunId
}

describe('inspection validates the whole child mapping', () => {
  async function completedTwoChildRun() {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    expect(done.state).toBe('completed')
    return env.run(done.automationRunId)
  }

  const read = (run: AutomationRun) =>
    inspectCoordinatedRun({
      run,
      orchestrationDb: env.db,
      progressStore: createFileCoordinatedRunProgressStore(progressRoot())
    })

  it('trusts a valid two-child history', async () => {
    const run = await completedTwoChildRun()
    const inspection = read(run)
    expect(inspection.stages.map((s) => [s.native.kind, s.semantic.kind])).toEqual([
      ['available', 'available'],
      ['available', 'available']
    ])
    expect(inspection.receipt.kind).toBe('available')
  })

  const sql = (statement: string, ...params: string[]) =>
    env.db.db.prepare(statement).run(...params)

  it.each<[string, (run: AutomationRun) => AutomationRun]>([
    [
      'same-run Task swap',
      (run) => ({
        ...run,
        childMappings: mappingsOf(run).map((m, i, all) => ({ ...m, taskId: all[1 - i].taskId }))
      })
    ],
    [
      'same-run Dispatch swap',
      (run) => ({
        ...run,
        childMappings: mappingsOf(run).map((m, i, all) => ({
          ...m,
          dispatchId: all[1 - i].dispatchId
        }))
      })
    ],
    [
      'duplicate mapping',
      (run) => ({ ...run, childMappings: [mappingsOf(run)[0], mappingsOf(run)[0]] })
    ],
    ['incomplete mapping', (run) => ({ ...run, childMappings: [mappingsOf(run)[0]] })],
    [
      'altered spec',
      (run) => (sql('UPDATE tasks SET spec = ? WHERE id = ?', 'forged spec', taskOf(run, 0)), run)
    ],
    [
      'altered owner',
      (run) => (
        sql(
          'UPDATE tasks SET created_by_terminal_handle = ? WHERE id = ?',
          'term_foreign',
          taskOf(run, 0)
        ),
        run
      )
    ],
    [
      'altered dependencies',
      (run) => (sql('UPDATE tasks SET deps = ? WHERE id = ?', '[]', taskOf(run, 1)), run)
    ],
    [
      'foreign Dispatch creator',
      (run) => (
        sql(
          'UPDATE dispatch_contexts SET creator_handle = ? WHERE id = ?',
          'term_foreign',
          dispatchOf(run, 0)
        ),
        run
      )
    ],
    [
      'cross-Task retry lineage',
      (run) => (
        sql(
          'UPDATE dispatch_contexts SET retry_of_dispatch_id = ? WHERE id = ?',
          dispatchOf(run, 0),
          dispatchOf(run, 1)
        ),
        run
      )
    ],
    [
      'foreign native Run objective',
      (run) => (
        sql('UPDATE runs SET objective = ? WHERE id = ?', 'forged', orchestrationRunOf(run)),
        run
      )
    ]
  ])('reports %s as unavailable without leaking or mutating evidence', async (_name, corrupt) => {
    const run = await completedTwoChildRun()
    const forged = corrupt(run)
    const bytes = progressBytes(run.id)
    const rows = nativeRows()
    const inspection = read(forged)
    for (const stage of inspection.stages) {
      expect(stage.native).toMatchObject({
        kind: 'unavailable',
        reason: expect.stringContaining('Child mappings are not trusted')
      })
      expect(stage.semantic.kind).toBe('unavailable')
      expect([stage.taskId, stage.mappedDispatchId]).toEqual([null, null])
    }
    expect(inspection.receipt.kind).toBe('unavailable')
    expect(progressBytes(run.id)).toBe(bytes)
    expect(nativeRows()).toBe(rows)
  })
})
