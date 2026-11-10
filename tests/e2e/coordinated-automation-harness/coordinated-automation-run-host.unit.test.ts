import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { AutomationService } from '../../../src/main/automations/service'
import { CoordinatedHostStoppedError } from '../../../src/main/automations/coordinated-automation-recovery-context'
import { CoordinatedRunHostRefusedError } from '../../../src/main/automations/coordinated-automation-run-host-types'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import type { ScriptedWorkerAction } from './isolated-adapters'
import { InjectedCoordinatorCrash, LOCAL_STAGE_EFFECT } from './coordinated-automation-recovery-env'
import {
  SELF,
  disposeRunHostFixture,
  effectDefinition,
  enableSetting,
  env,
  holdLane,
  hostEnvironment,
  selectActiveProfileDirectory,
  hostProgress,
  injection,
  request,
  running,
  seedEffect,
  services,
  setupRunHostFixture,
  startService,
  storeWriteCounts
} from './coordinated-automation-run-host-fixture'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

beforeEach(setupRunHostFixture)
afterEach(disposeRunHostFixture)

describe('coordinated run host through the runtime automation service', () => {
  it('collapses duplicate manual starts into one run and one mapping set', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const [first, second] = await Promise.all([
      service.coordinatedRuns.startManualRun(request(automationId)),
      service.coordinatedRuns.startManualRun(request(automationId))
    ])
    expect([first.created, second.created]).toEqual([true, false])
    expect(second.automationRunId).toBe(first.automationRunId)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
    expect(first.state).toBe('completed')
    expect(second.inspection.stages.map((s) => s.mappedDispatchId)).toEqual(
      first.inspection.stages.map((s) => s.mappedDispatchId)
    )
    expect(env.dispatchIds(first.automationRunId, 'research')).toHaveLength(1)
    expect(second.inspection.receipt.kind).toBe('available')
    expect(second.inspection.stages[0].sessionTarget.kind).toBe('unavailable')
    expect(second.inspection.humanResolution.available).toBe(false)
  })

  it('restart on the same Store, SQLite, and progress keeps IDs and receipt without new effects', async () => {
    const automationId = await seedEffect(
      env.createDefinitionOnly(effectDefinition()).automationId,
      ['verified']
    )
    const first = await startService({ injection: injection() }).coordinatedRuns.startManualRun(
      request(automationId)
    )
    expect(first.state).toBe('completed')
    const effectId = env.effectId(first.automationRunId, 'stage', LOCAL_STAGE_EFFECT)

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    enableSetting()
    const restarted = startService({ injection: injection() })
    const replay = await restarted.coordinatedRuns.startManualRun(request(automationId))
    expect(replay.created).toBe(false)
    expect(replay.automationRunId).toBe(first.automationRunId)
    expect(replay.inspection.receipt).toEqual(first.inspection.receipt)
    expect(replay.inspection.stages.map((s) => [s.taskId, s.mappedDispatchId])).toEqual(
      first.inspection.stages.map((s) => [s.taskId, s.mappedDispatchId])
    )
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
  })

  it('startup recovery finishes an interrupted run before admitting manual work', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    env.crashAt('report.after-native-settle')
    await expect(
      startService({ injection: injection() }).coordinatedRuns.startManualRun(request(automationId))
    ).rejects.toThrow(InjectedCoordinatorCrash)
    const [run] = env.store.listAutomationRuns(automationId)
    expect(run.status).not.toBe('completed')

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    enableSetting()
    const restarted = startService({ injection: injection() })
    const inspected = await restarted.coordinatedRuns.startManualRun(request(automationId))
    expect(inspected).toMatchObject({ created: false, state: 'completed' })
    expect(inspected.automationRunId).toBe(run.id)
    expect(env.dispatchIds(run.id, 'research')).toHaveLength(1)
  })

  it('keeps uncertain holds non-final and unchanged across restart', async () => {
    const automationId = await seedEffect(
      env.createDefinitionOnly(effectDefinition()).automationId,
      ['uncertain']
    )
    const first = await startService({ injection: injection() }).coordinatedRuns.startManualRun(
      request(automationId)
    )
    expect(first.state).toBe('outcome_uncertain')
    expect(first.inspection.runStatus).toBe('dispatched')
    const effectId = env.effectId(first.automationRunId, 'stage', LOCAL_STAGE_EFFECT)

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    enableSetting()
    const again = await startService({ injection: injection() }).coordinatedRuns.reconcileRun({
      automationId,
      automationRunId: first.automationRunId,
      expectedOwner: SELF
    })
    expect(again.state).toBe('outcome_uncertain')
    expect(again.inspection.runStatus).toBe('dispatched')
    expect(again.inspection.runError).toBe(first.inspection.runError)
    expect(again.inspection.receipt.kind).toBe('absent')
    expect((await env.harness.effects.query(effectId)).applyCount).toBe(1)
  })

  it('stop fences an in-flight attempt and refuses further dispatch', async () => {
    let release: (actions: ScriptedWorkerAction[]) => void = () => {}
    env.scripts.set('research', () => new Promise((resolve) => (release = resolve)))
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const service = startService({ injection: injection() })
    const pending = service.coordinatedRuns.startManualRun(request(automationId))
    await vi.waitFor(() => expect(env.store.listAutomationRuns(automationId)).toHaveLength(1))
    const [run] = env.store.listAutomationRuns(automationId)
    await vi.waitFor(() => expect(env.dispatchIds(run.id, 'research')).toHaveLength(1))

    service.stop()
    release([
      {
        type: 'report',
        result: env.report({
          automationRunId: run.id,
          orchestrationRunId: env.run(run.id).orchestrationRunId!,
          childDefinitionId: 'research',
          taskId: env.taskId(run.id, 'research'),
          dispatchId: env.dispatchIds(run.id, 'research')[0]
        })
      }
    ])
    await expect(pending).rejects.toThrow(CoordinatedHostStoppedError)
    expect(env.dispatchIds(run.id, 'writer')).toHaveLength(0)
    await expect(
      service.coordinatedRuns.startManualRun(request(automationId, 'manual-2'))
    ).rejects.toThrow(CoordinatedRunHostRefusedError)
  })
})

describe('coordinated run host refusals happen before any write', () => {
  async function expectRefused(service: AutomationService, automationId: string) {
    const before = storeWriteCounts(automationId)
    expect(service.coordinatedRuns.availability.available).toBe(false)
    await expect(service.coordinatedRuns.startManualRun(request(automationId))).rejects.toThrow(
      CoordinatedRunHostRefusedError
    )
    expect(storeWriteCounts(automationId)).toEqual(before)
    expect(before.progress).toBe(false)
  }

  it('is unavailable by default', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService(), automationId)
  })

  it('refuses packaged builds', async () => {
    hostEnvironment({ isPackaged: true })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService({ injection: injection() }), automationId)
  })

  it('refuses a foreign profile root', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const foreign = mkdtempSync(join(tmpdir(), 'orca-foreign-profile-'))
    await expectRefused(
      startService({ injection: injection({ profile: { kind: 'isolated_test', root: foreign } }) }),
      automationId
    )
  })

  it('refuses headless and remote hosts', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    await expectRefused(startService({ injection: injection(), headless: true }), automationId)
  })

  it('refuses real providers', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const provider = { ...env.workerProvider(), capability: 'claude' }
    await expectRefused(
      startService({ injection: injection({ workerProvider: provider }) }),
      automationId
    )
  })

  // Enabled coordinated definitions are already refused by the Store at creation.
  it('refuses remote-target and non-self-owner requests before any write', async () => {
    const service = startService({ injection: injection() })
    const remote = env.createDefinitionOnly(coordinatedCreateInput({ projectId: 'repo-ssh' }))
    const local = env.createDefinitionOnly(coordinatedCreateInput())
    for (const [automationId, req] of [
      [remote.automationId, request(remote.automationId)],
      [
        local.automationId,
        {
          ...request(local.automationId),
          expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
        }
      ]
    ] as const) {
      const before = env.store.listAutomationRuns(automationId).length
      await expect(service.coordinatedRuns.startManualRun(req)).rejects.toThrow(
        CoordinatedRunHostRefusedError
      )
      expect(env.store.listAutomationRuns(automationId)).toHaveLength(before)
    }
  })

  it('leaves retained coordinated runs untouched and the legacy runNow route refused by default', async () => {
    const { automationId, runId } = env.createRun(coordinatedCreateInput())
    const service = startService()
    expect(env.run(runId).status).toBe('pending')
    expect(existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))).toBe(false)
    await expect(service.runNow(automationId)).rejects.toThrow()
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
  })
})

describe('coordinated run host lifecycle gate and exact scope', () => {
  it('reports not_started, running, and stopped from the live lifecycle', async () => {
    const service = startService({ injection: injection(), start: false })
    expect(service.coordinatedRuns.availability).toMatchObject({
      available: false,
      state: 'not_started'
    })
    service.start()
    await running(service)
    expect(service.coordinatedRuns.availability).toEqual({ available: true, state: 'running' })
    service.stop()
    expect(service.coordinatedRuns.availability).toMatchObject({
      available: false,
      state: 'stopped'
    })
  })

  it('revokes while the profile authority is foreign and reopens when it returns', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
    const sequence =
      done.inspection.progress.kind === 'available' ? done.inspection.progress.sequence : -1

    selectActiveProfileDirectory(mkdtempSync(join(tmpdir(), 'orca-revoked-profile-')))
    expect(service.coordinatedRuns.availability).toMatchObject({
      available: false,
      state: 'revoked'
    })
    expect(() => service.coordinatedRuns.inspectRun(scope)).toThrow(CoordinatedRunHostRefusedError)
    await expect(service.coordinatedRuns.reconcileRun(scope)).rejects.toThrow(
      CoordinatedRunHostRefusedError
    )
    await expect(
      service.coordinatedRuns.startManualRun(request(automationId, 'manual-2'))
    ).rejects.toThrow(CoordinatedRunHostRefusedError)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(1)
    expect(hostProgress(done.automationRunId)?.sequence).toBe(sequence)

    selectActiveProfileDirectory(testState.dir)
    expect(service.coordinatedRuns.availability.state).toBe('running')
    const healthy = service.coordinatedRuns.inspectRun(scope)
    expect(healthy.receipt.kind).toBe('available')
    expect(healthy.progress.kind === 'available' && healthy.progress.sequence).toBe(sequence)
  })

  it('refuses inspection after stop and for a mismatched parent or owner', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const other = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
    expect(service.coordinatedRuns.inspectRun(scope).automationRunId).toBe(done.automationRunId)
    for (const bad of [
      { ...scope, automationId: other.automationId },
      {
        ...scope,
        expectedOwner: {
          selector: { kind: 'ssh' as const, targetId: 'ssh-1', targetGeneration: 7 }
        }
      },
      { ...scope, automationRunId: 'missing-run' }
    ]) {
      expect(() => service.coordinatedRuns.inspectRun(bad)).toThrow(CoordinatedRunHostRefusedError)
      await expect(service.coordinatedRuns.reconcileRun(bad)).rejects.toThrow(
        CoordinatedRunHostRefusedError
      )
    }
    service.stop()
    expect(() => service.coordinatedRuns.inspectRun(scope)).toThrow(CoordinatedRunHostRefusedError)
  })

  it('stop while a manual start is queued refuses before any write', async () => {
    const service = startService({ injection: injection() })
    await running(service)
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const lane = holdLane(service, automationId)
    const queued = service.coordinatedRuns.startManualRun(request(automationId))
    service.stop()
    lane.release()
    await expect(queued).rejects.toThrow(CoordinatedRunHostRefusedError)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(0)
    expect(existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))).toBe(false)
  })

  it('stop during startup recovery refuses admission without new writes', async () => {
    const { automationId, runId } = env.createRun(coordinatedCreateInput())
    const service = startService({ injection: injection(), start: false })
    const lane = holdLane(service, automationId)
    service.start()
    expect(service.coordinatedRuns.availability.state).toBe('recovering')
    const queued = service.coordinatedRuns.startManualRun(request(automationId, 'manual-2'))
    service.stop()
    lane.release()
    await expect(queued).rejects.toThrow(CoordinatedRunHostRefusedError)
    expect(env.store.listAutomationRuns(automationId).map((r) => r.id)).toEqual([runId])
    expect(env.run(runId).materializationPhase).toBe('intent_persisted')
  })

  it('a definition revision edit or parent archive while queued refuses the queued start', async () => {
    const service = startService({ injection: injection() })
    await running(service)
    const edited = env.createDefinitionOnly(coordinatedCreateInput())
    const archived = env.createDefinitionOnly(coordinatedCreateInput())

    const editLane = holdLane(service, edited.automationId)
    const queuedEdit = service.coordinatedRuns.startManualRun(request(edited.automationId))
    env.store.updateCoordinatedAutomation(edited.automationId, {
      expectedDefinitionRevision: 1,
      children: [
        child('research'),
        child('writer', { dependencies: [{ childId: 'research', condition: 'accepted' }] })
      ]
    })
    editLane.release()
    await expect(queuedEdit).rejects.toThrow(/revision changed/)

    const archiveLane = holdLane(service, archived.automationId)
    const queuedArchive = service.coordinatedRuns.startManualRun(request(archived.automationId))
    env.store.archiveCoordinatedAutomation({ automationId: archived.automationId })
    archiveLane.release()
    await expect(queuedArchive).rejects.toThrow(CoordinatedRunHostRefusedError)
    expect(env.store.listAutomationRuns(edited.automationId)).toHaveLength(0)
    expect(env.store.listAutomationRuns(archived.automationId)).toHaveLength(0)
  })

  it('a reconcile queued behind the lane is refused when the parent is archived meanwhile', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
    const before = hostProgress(done.automationRunId)
    const lane = holdLane(service, automationId)
    const queued = service.coordinatedRuns.reconcileRun(scope)
    env.store.archiveCoordinatedAutomation({ automationId })
    lane.release()
    await expect(queued).rejects.toThrow(CoordinatedRunHostRefusedError)
    expect(hostProgress(done.automationRunId)).toEqual(before)
  })
})

describe('coordinated run host Store setting and desktop authority gate', () => {
  it('revokes while the experimental setting is off and refuses before any write', async () => {
    const service = startService({ injection: injection() })
    await running(service)
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    enableSetting(false)
    expect(service.coordinatedRuns.availability).toMatchObject({
      available: false,
      state: 'revoked'
    })
    await expect(service.coordinatedRuns.startManualRun(request(automationId))).rejects.toThrow(
      /not enabled in settings/
    )
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(0)
    enableSetting()
    expect(service.coordinatedRuns.availability.state).toBe('running')
    expect((await service.coordinatedRuns.startManualRun(request(automationId))).state).toBe(
      'completed'
    )
  })

  it('setting turned off while a start is queued refuses inside the lane', async () => {
    const service = startService({ injection: injection() })
    await running(service)
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const lane = holdLane(service, automationId)
    const queued = service.coordinatedRuns.startManualRun(request(automationId))
    enableSetting(false)
    lane.release()
    await expect(queued).rejects.toThrow(/not enabled in settings/)
    expect(env.store.listAutomationRuns(automationId)).toHaveLength(0)
    expect(existsSync(join(testState.dir, COORDINATED_PROGRESS_DIRECTORY))).toBe(false)
  })

  it('desktop authority lost while a reconcile is queued refuses before any progress write', async () => {
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
    const before = hostProgress(done.automationRunId)
    const lane = holdLane(service, automationId)
    const queued = service.coordinatedRuns.reconcileRun(scope)
    const authority = vi
      .spyOn(env.store, 'coordinatedAutomationDefinitionAuthority')
      .mockReturnValue('runtime')
    lane.release()
    await expect(queued).rejects.toThrow(/desktop authority/)
    expect(service.coordinatedRuns.availability).toMatchObject({ state: 'revoked' })
    expect(() => service.coordinatedRuns.inspectRun(scope)).toThrow(CoordinatedRunHostRefusedError)
    expect(hostProgress(done.automationRunId)).toEqual(before)
    authority.mockRestore()
    expect(service.coordinatedRuns.inspectRun(scope).receipt.kind).toBe('available')
  })
})
