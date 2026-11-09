import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  Automation,
  AutomationRun,
  AutomationUpdateInput
} from '../../../shared/automations-types'
import {
  closeTestStores,
  createSqliteTestStore,
  createStore as createFreshStore,
  dataFile,
  readPersistedState,
  testState,
  writeDataFile
} from '../persistence-test-harness'
import { installFakeAppEnvironment } from '../../../../config/scripts/vitest-host-ports-setup'
import { resetRetirementCollisionKeyCacheForTests } from '../../worktree-name-retirement'
import { isCoordinatedRunDispatchable } from '../scheduling-automations/coordinated-automation-run-records'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness,
  fakeOrchestration
} from '../scheduling-automations/coordinated-automation-persistence.test-support'
import { createCoordinatedAutomation } from '../scheduling-automations/coordinated-automation-definition-operations'
import { createCoordinatedAutomationRun } from '../scheduling-automations/coordinated-automation-run-operations'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

/** A profile written before coordinated automations existed. */
const LEGACY_AUTOMATION: Automation = {
  id: 'legacy-1',
  name: 'Nightly',
  prompt: 'go',
  precheck: null,
  agentId: 'claude',
  projectId: 'repo-local',
  executionTargetType: 'local',
  executionTargetId: 'local',
  schedulerOwner: 'local_host_service',
  workspaceMode: 'new_per_run',
  workspaceId: null,
  baseBranch: null,
  reuseSession: false,
  timezone: 'UTC',
  rrule: 'FREQ=DAILY',
  dtstart: 0,
  enabled: true,
  nextRunAt: 0,
  missedRunPolicy: 'run_once_within_grace',
  missedRunGraceMinutes: 720,
  createdAt: 1,
  updatedAt: 1
}

const LEGACY_RUN: AutomationRun = {
  id: 'legacy-run-1',
  automationId: 'legacy-1',
  runNumber: 1,
  runContext: null,
  sourceContext: null,
  title: 'Nightly run 1',
  scheduledFor: 10,
  status: 'completed',
  trigger: 'scheduled',
  workspaceId: null,
  workspaceDisplayName: null,
  sessionKind: 'terminal',
  chatSessionId: null,
  terminalSessionId: null,
  terminalPaneKey: null,
  terminalPtyId: null,
  outputSnapshot: null,
  precheckResult: null,
  usage: null,
  error: null,
  startedAt: 11,
  dispatchedAt: 12,
  createdAt: 10
}

let opened = 0

function runRow(
  store: Awaited<ReturnType<typeof openStore>>,
  input: Parameters<Awaited<ReturnType<typeof openStore>>['createCoordinatedAutomationRun']>[0]
): AutomationRun {
  const { run } = store.createCoordinatedAutomationRun(input)
  if (!run) {
    throw new Error('Expected a retained run row.')
  }
  return run
}

async function openStore() {
  opened += 1
  if (opened === 1) {
    return createFreshStore()
  }
  vi.resetModules()
  installFakeAppEnvironment({ getPath: () => testState.dir })
  const { Store } = await import('./store')
  const { initDataPath } = await import('./user-data-path')
  initDataPath()
  return createSqliteTestStore(Store, { dataFile: dataFile() })
}

async function restart() {
  await closeTestStores()
  return openStore()
}

beforeEach(() => {
  opened = 0
  resetRetirementCollisionKeyCacheForTests()
  testState.dir = mkdtempSync(join(tmpdir(), 'coordinated-automation-store-'))
  writeDataFile({
    ...coordinatedTestState(),
    automations: [LEGACY_AUTOMATION],
    automationRuns: [LEGACY_RUN]
  })
})

afterEach(async () => {
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('coordinated automation profile persistence', () => {
  it('loads a pre-coordinated profile unchanged and keeps single records free of new keys', async () => {
    let store = await openStore()
    expect(store.listAutomationRuns('legacy-1')).toEqual([LEGACY_RUN])
    expect(store.listAutomations()[0]).toMatchObject(LEGACY_AUTOMATION)
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
    store = await restart()
    // Baseline after the loader's existing legacy-context backfill.
    const [baseline] = readPersistedState().automations

    const explicitSingle: AutomationUpdateInput & { kind: 'single' } = {
      name: 'Nightly 2',
      kind: 'single'
    }
    store.updateAutomation('legacy-1', explicitSingle)
    expect(() => store.createAutomationRun(store.listAutomations()[0], 20)).not.toThrow()
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
    await restart()
    const persisted = readPersistedState()
    expect(persisted.automations).toEqual([
      {
        ...baseline,
        name: 'Nightly 2',
        updatedAt: expect.any(Number)
      }
    ])
    expect(Object.keys(persisted.automations[0]).sort()).toEqual(Object.keys(baseline).sort())
    expect(persisted.automationRuns[0]).toEqual(LEGACY_RUN)
    expect(Object.keys(persisted.automationRuns[1]).sort()).toEqual(Object.keys(LEGACY_RUN).sort())
  })

  it('round-trips revisions, frozen snapshots, links, and tombstones through restart', async () => {
    let store = await openStore()
    const orchestration = fakeOrchestration()
    const parent = store.createCoordinatedAutomation(coordinatedCreateInput())
    const first = runRow(store, {
      automationId: parent.id,
      scheduledFor: 100
    })
    orchestration.createRun('orun-1')
    store.linkCoordinatedOrchestrationRun({
      automationRunId: first.id,
      orchestrationRunId: 'orun-1',
      probe: orchestration
    })
    orchestration.createTask('orun-1', 't-research')
    orchestration.createTask('orun-1', 't-writer')
    store.persistCoordinatedChildMappings({
      automationRunId: first.id,
      mappings: [
        { childDefinitionId: 'research', taskId: 't-research' },
        { childDefinitionId: 'writer', taskId: 't-writer' }
      ],
      probe: orchestration
    })
    store.markCoordinatedRunReadyForDispatch({ automationRunId: first.id, probe: orchestration })
    store.updateCoordinatedAutomation(parent.id, {
      expectedDefinitionRevision: 1,
      children: [child('research', { name: 'Renamed researcher' })]
    })
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })

    store = await restart()
    const reloadedParent = store.listAutomations().find((a) => a.id === parent.id)!
    expect(reloadedParent).toMatchObject({
      kind: 'coordinated',
      definitionRevision: 2,
      enabled: false,
      childTombstones: [expect.objectContaining({ childDefinitionId: 'writer' })]
    })
    const [reloadedFirst] = store.listAutomationRuns(parent.id)
    expect(reloadedFirst.id).toBe(first.id)
    expect(reloadedFirst.resolvedSnapshot).toEqual(first.resolvedSnapshot)
    expect(reloadedFirst.childMappings).toEqual([
      { childDefinitionId: 'research', taskId: 't-research', dispatchId: null },
      { childDefinitionId: 'writer', taskId: 't-writer', dispatchId: null }
    ])
    expect(isCoordinatedRunDispatchable(reloadedFirst)).toBe(true)

    // The scheduler redelivers the same occurrence after restart.
    expect(runRow(store, { automationId: parent.id, scheduledFor: 100 }).id).toBe(first.id)
    const second = runRow(store, {
      automationId: parent.id,
      scheduledFor: 200
    })
    expect(second.resolvedSnapshot!.resolvedChildren.map((c) => c.name)).toEqual([
      'Renamed researcher'
    ])
    expect(isCoordinatedRunDispatchable(second)).toBe(false)
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
    await restart()
    expect(readPersistedState().automationRuns.map((run) => run.id)).toEqual([
      LEGACY_RUN.id,
      first.id,
      second.id
    ])
  })

  it('persists replay records and archive tombstones through SQLite restart', async () => {
    let store = await openStore()
    const parent = store.createCoordinatedAutomation(coordinatedCreateInput())
    const first = store.createCoordinatedAutomationRun({
      automationId: parent.id,
      scheduledFor: 100
    })
    store.recordCoordinatedMaterializationFailure({
      automationRunId: first.run!.id,
      phase: 'materialization_failed',
      error: 'settled for archive'
    })
    expect(() => store.deleteAutomation(parent.id)).toThrow(/archive them/)
    const tombstone = store.archiveCoordinatedAutomation({ automationId: parent.id })
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })

    store = await restart()
    const persisted = readPersistedState()
    expect(persisted.coordinatedAutomationLedger).toMatchObject({
      parentTombstones: [tombstone],
      occurrences: [first.occurrence]
    })
    expect(store.listAutomations().map((a) => a.id)).toEqual(['legacy-1'])
    const [history] = store.listAutomationRuns(parent.id)
    expect(history).toMatchObject({
      id: first.run!.id,
      materializationPhase: 'materialization_failed',
      resolvedSnapshot: first.run!.resolvedSnapshot
    })
    history.resolvedSnapshot!.resolvedChildren[0].name = 'caller edit'
    expect(store.listAutomationRuns(parent.id)[0].resolvedSnapshot!.resolvedChildren[0].name).toBe(
      'research worker'
    )
  })

  it('quarantines a malformed coordinated row on SQLite reload instead of trusting it', async () => {
    const harness = durableHarness(coordinatedTestState())
    const parent = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
    const created = createCoordinatedAutomationRun(harness.runs(), {
      automationId: parent.id,
      scheduledFor: 5
    }).run!
    const tampered = structuredClone(created)
    tampered.resolvedSnapshot!.resolvedChildren[0].name = 'edited on disk'
    writeDataFile({
      ...coordinatedTestState(),
      automations: [LEGACY_AUTOMATION, parent],
      automationRuns: [LEGACY_RUN, tampered]
    })

    const store = await openStore()
    const reloaded = store.listAutomationRuns(parent.id)[0]
    expect(reloaded).toMatchObject({
      id: created.id,
      resolvedSnapshot: null,
      materializationPhase: 'materialization_failed',
      coordinatedQuarantine: { reason: expect.stringMatching(/canonical digest/) }
    })
    // Callers only ever see the bounded summary; the rejected payload stays store-private.
    expect(reloaded.coordinatedQuarantine).toEqual({
      reason: expect.any(String),
      payloadDigest: expect.stringMatching(/^sha256:/),
      payloadRetained: true
    })
    expect(JSON.stringify(store.listAutomationRuns())).not.toContain('edited on disk')
    expect(store.listAutomationRuns('legacy-1')).toEqual([LEGACY_RUN])

    // The repair is persisted, and the private payload survives on disk only.
    await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
    await restart()
    const persisted = readPersistedState().automationRuns.find((run) => run.id === created.id)!
    const privateRecord = persisted.coordinatedQuarantine
    const payload = privateRecord && 'payload' in privateRecord ? privateRecord.payload : null
    expect(payload).not.toBeNull()
    expect(JSON.parse(payload ?? 'null').resolvedSnapshot.resolvedChildren[0].name).toBe(
      'edited on disk'
    )
    expect(persisted.resolvedSnapshot).toBeNull()
  })
})
