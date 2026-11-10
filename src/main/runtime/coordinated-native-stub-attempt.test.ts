import './rpc/unused-default-rpc-methods.test-fixture'
// A coordinated native stub attempt runs through the real Store, orchestration DB, pinned golden
// stub composition and launch path; only the physical PTY spawn is mocked. The pinned stub is not
// a Codex process, so this file controls the readiness/foreground runtime effects (composer wait,
// foreground proof, prompt write receipt) the way the host contract allows; that control never
// claims the pinned stub itself passes the app's real Codex readiness path, and no test here
// enables any production/default-root capability.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../persistence/persistence-test-harness'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import type { AutomationRun } from '../../shared/automations-types'
import type { RuntimeTerminalCreate } from '../../shared/runtime-terminal-create-contract'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { ChildLaunchConfig } from '../../shared/coordinated-automation-types'
import { OrcaRuntimeService } from './orca-runtime'
import { createNativeStubSessionTestComposition } from './native-stub-session-test-host'
import {
  LocalPtyProvider,
  _resetLocalPtyProviderStateForTest
} from '../providers/local-pty/local-pty-provider'
import {
  createLocalPtyMockProcess,
  type LocalPtyExitCallback
} from '../providers/local-pty/local-pty-provider-test-harness'
import { getLocalPtyProvider, setLocalPtyProvider } from '../ipc/pty/provider/registry'
import { makeRuntimePtySpawnTestDeps } from '../ipc/pty/runtime/spawn-preflight-test-deps-fixture'
import { spawnPtyFromRuntimeController } from '../ipc/pty/runtime/spawn'
import * as invalidators from '../ipc/worktree-change-invalidators'
import { _resetTerminalModelQueryAuthorityForTest } from './terminal-model-query-authority'
import { _resetTerminalViewAttributesForTest } from './terminal-view-attribute-store'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_SEND_METHODS } from './rpc/methods/orchestration/messaging/send-methods'
import { CoordinatedAutomationAdapter } from '../automations/coordinated-automation-adapter'
import { createCoordinatedNativeStubWorker } from '../automations/coordinated-automation-native-stub-worker'
import { nativeAttemptSettlementProblem } from '../automations/coordinated-automation-native-attempt'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const originalProvider = getLocalPtyProvider()
let root = ''
const disposers: (() => void)[] = []
let rpcRequests = 0

let exitCallback: LocalPtyExitCallback | undefined

beforeEach(() => {
  exitCallback = undefined
  native.spawn.mockReset()
  native.spawn.mockImplementation(() =>
    createLocalPtyMockProcess({
      get: () => exitCallback,
      set: (callback) => {
        exitCallback = callback
      }
    })
  )
})

afterEach(async () => {
  _resetLocalPtyProviderStateForTest()
  setLocalPtyProvider(originalProvider)
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  await closeTestStores()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  _resetTerminalModelQueryAuthorityForTest()
  _resetTerminalViewAttributesForTest()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = ''
})

type Fixture = Awaited<ReturnType<typeof setup>>

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'orca-coordinated-native-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  testState.dir = join(root, 'profiles', 'local')
  for (const path of [home, workspace, testState.dir]) {
    mkdirSync(path, { recursive: true })
  }
  writeDataFile(coordinatedTestState())
  const store = createStore()
  installFakeAppEnvironment({ getPath: (name) => (name === 'home' ? home : root) })
  const buildSpawnEnv = vi.fn(() => {
    throw new Error('account environment must not run')
  })
  const provider = new LocalPtyProvider({ buildSpawnEnv })
  setLocalPtyProvider(provider)
  const host = createNativeStubSessionTestComposition({
    userDataDirectory: root,
    homeDirectory: home
  })
  disposers.push(host.revoke)
  const registration = vi.spyOn(invalidators, 'registerWorktreeChangeInvalidator')
  const runtime = new OrcaRuntimeService(store, undefined, { nativeStubSessionTest: host })
  for (const result of registration.mock.results) {
    if (result.type === 'return') {
      disposers.push(result.value)
    }
  }
  const group = store.createProjectGroup({
    name: 'Stub',
    parentPath: workspace,
    createdFrom: 'folder-scan'
  })
  const folder = store.createFolderWorkspace({ projectGroupId: group.id })
  const workspaceId = folderWorkspaceKey(folder.id)
  const deps = makeRuntimePtySpawnTestDeps()
  deps.store = store
  deps.runtime = runtime
  deps.getSettings = () => store.getSettings()
  deps.prepareClaudeAuth = vi.fn()
  deps.prepareCodexResumeHome = vi.fn()
  deps.options = { onCodexHomePtySpawned: vi.fn() }
  const spawn = vi.fn((args: Parameters<typeof spawnPtyFromRuntimeController>[1]) =>
    spawnPtyFromRuntimeController(deps, args)
  )
  Object.defineProperty(runtime, 'ptyController', { value: { spawn } })
  Object.defineProperty(runtime, 'getAvailableAuthoritativeWindow', { value: () => null })
  const db = runtime.getOrchestrationDb()
  const createdTerminals: RuntimeTerminalCreate[] = []
  const createTerminal = runtime.createTerminal.bind(runtime)
  vi.spyOn(runtime, 'createTerminal').mockImplementation(async (selector, options) => {
    const created = await createTerminal(selector, options)
    createdTerminals.push(created)
    return created
  })
  // The pinned stub cannot satisfy Codex readiness itself; the host-controlled effects stand in.
  vi.spyOn(runtime, 'waitForFreshWorkerComposer').mockImplementation(async (handle: string) => ({
    handle,
    condition: 'tui-idle' as const,
    satisfied: true,
    status: 'running' as const,
    exitCode: null
  }))
  vi.spyOn(runtime, 'waitForTerminal').mockImplementation(async (handle: string) => ({
    handle,
    condition: 'tui-idle' as const,
    satisfied: true,
    status: 'running' as const,
    exitCode: null
  }))
  vi.spyOn(runtime, 'readLaunchedAgentForeground').mockResolvedValue('agent')
  vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockImplementation(async (handle, body, options) => {
    const created = createdTerminals.find((terminal) => terminal.handle === handle)
    await options.beforeWrite?.(created?.ptyId ?? 'unknown-pty')
    return {
      handle,
      accepted: true,
      bytesWritten: body.length,
      prompt: {
        requestId: options.requestId ?? 'request',
        stages: ['input_accepted', 'turn_started'] as const,
        provider: 'codex',
        observation: 'supported',
        processIncarnation: created?.incarnationId ?? 'unknown',
        generation: 1,
        baselineWorkingSequence: 0
      }
    }
  })
  const nativeStubWorker = createCoordinatedNativeStubWorker({
    runtime,
    store,
    db,
    composition: host
  })
  const adapter = new CoordinatedAutomationAdapter({ store, orchestrationDb: db, nativeStubWorker })
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_SEND_METHODS })
  return {
    store,
    host,
    runtime,
    db,
    adapter,
    dispatcher,
    createdTerminals,
    workspaceId,
    home,
    workspace
  }
}

function nativeLaunchConfig(workspaceId: string): ChildLaunchConfig {
  return {
    agentId: 'codex',
    model: null,
    reasoningEffort: null,
    surface: 'terminal' as const,
    extraAgentArgs: '',
    reuseSession: false,
    workspaceMode: 'existing' as const,
    workspaceId,
    baseBranch: null,
    setupDecision: 'skip' as const,
    timeoutSeconds: 30,
    maxRetries: 0,
    maxReviewIterations: 0
  }
}

async function createNativeRun(f: Fixture, children = [child('writer')]) {
  const automation = f.store.createCoordinatedAutomation(
    coordinatedCreateInput({
      children: children.map((c) =>
        c.id === 'writer' || c.id === 'reviewer'
          ? { ...c, launchConfig: nativeLaunchConfig(f.workspaceId) }
          : c
      )
    })
  )
  const { run } = f.store.createCoordinatedAutomationRun({
    automationId: automation.id,
    scheduledFor: 1000
  })
  const materialized = await f.adapter.materializeRun(run!.id)
  const writerTaskId = materialized.childMappings!.find(
    (m) => m.childDefinitionId === 'writer'
  )!.taskId
  return { automation, run: materialized, writerTaskId }
}

function structuredReport(
  run: AutomationRun,
  identity: { childDefinitionId: string; taskId: string; dispatchId: string },
  overrides: Partial<StructuredWorkerResult> = {}
): StructuredWorkerResult {
  return {
    schemaVersion: 1,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId!,
    childDefinitionId: identity.childDefinitionId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    resolvedConfigDigest: run.resolvedSnapshot!.canonicalDigest,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} done`,
    reportMarkdown: `${identity.childDefinitionId} report`,
    artifacts: [],
    checks: run.resolvedSnapshot!.outcomeContract.acceptanceCriteria.map((c) => ({
      id: c.id,
      outcome: 'passed' as const,
      evidence: [`Criterion ${c.id} verified`]
    })),
    effects: [],
    blockers: [],
    ...overrides
  }
}

function evidenceFor(created: RuntimeTerminalCreate) {
  return {
    terminalHandle: created.handle,
    paneKey: created.paneKey,
    launchToken: created.launchToken
  }
}

async function sendWorkerDone(
  f: Fixture,
  input: {
    handle: string
    dispatchId: string
    taskId: string
    outcome: 'succeeded' | 'failed'
    structuredResult?: unknown
    evidence?: unknown
  }
) {
  rpcRequests += 1
  const response = await f.dispatcher.dispatch({
    id: `rpc-${rpcRequests}`,
    authToken: 'test',
    method: 'orchestration.send',
    params: {
      from: input.handle,
      type: 'worker_done',
      subject: 'Done',
      payload: JSON.stringify({
        taskId: input.taskId,
        dispatchId: input.dispatchId,
        outcome: input.outcome,
        ...(input.structuredResult !== undefined
          ? { structuredResult: input.structuredResult }
          : {})
      })
    },
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: `req-${rpcRequests}`,
    ...(input.evidence ? { orchestrationCompatibilityEvidence: input.evidence } : {})
  })
  return response
}

async function dispatchWriter(f: Fixture, runId: string): Promise<string> {
  const first = await f.adapter.reconcileRun(runId)
  expect(first.state).toBe('outcome_uncertain')
  const run = f.store.listAutomationRuns().find((r) => r.id === runId)!
  return run.childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId!
}

it('dispatches one mapped native attempt and completes on an authenticated late worker_done', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)
  expect(native.spawn).toHaveBeenCalledTimes(1)

  const dispatch = f.db.getDispatchContextById(dispatchId)!
  expect(dispatch.consumer_generation).toBeLessThanOrEqual(1)
  expect(dispatch.status).toBe('dispatched')
  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(worker.state).toBe('ready')
  const custody = f.db.getWorkerTerminalResourceByOwner(dispatchId)
  expect(custody).toMatchObject({
    ownership_state: 'owned',
    terminal_handle: dispatch.assignee_handle
  })
  const current = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(nativeAttemptSettlementProblem(f.db, current, dispatchId)).toMatch(/no authenticated/)

  const created = f.createdTerminals.find(
    (terminal) => terminal.handle === dispatch.assignee_handle
  )!
  const evidence = evidenceFor(created)
  const report = structuredReport(current, {
    childDefinitionId: 'writer',
    taskId: writerTaskId,
    dispatchId
  })
  const sent = await sendWorkerDone(f, {
    handle: created.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: report,
    evidence
  })
  expect(sent.ok).toBe(true)

  const settledDispatch = f.db.getDispatchContextById(dispatchId)!
  expect(settledDispatch.status).toBe('completed')
  const settledWorker = f.db.getWorkerDispatch(dispatchId)!
  expect(settledWorker.state).toBe('succeeded')
  expect(settledWorker.stage).toBe('settled')
  const fact = f.db
    .getAttemptObservationFacts(dispatchId)
    .find((entry) => entry.facet === 'worker_report')
  expect(fact).toMatchObject({
    authorityId: `run_home:${run.orchestrationRunId}`,
    payload: { status: 'accepted', outcome: 'succeeded' }
  })
  expect(nativeAttemptSettlementProblem(f.db, current, dispatchId)).toBeNull()

  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('completed')
  expect(outcome.run.status).toBe('completed')
  expect(outcome.run.completionReceipt).toBeTruthy()
  expect(native.spawn).toHaveBeenCalledTimes(1)
})

it('serializes concurrent duplicate dispatches to one retained attempt, kept after host revocation', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const [first, second] = await Promise.all([
    f.adapter.dispatchTask(run.id, writerTaskId),
    f.adapter.dispatchTask(run.id, writerTaskId)
  ])
  expect(new Set([first.dispatchId, second.dispatchId]).size).toBe(1)
  expect([first.outcome, second.outcome]).toContain('native_retained')
  expect(native.spawn).toHaveBeenCalledTimes(1)

  f.host.revoke()
  const retained = await f.adapter.dispatchTask(run.id, writerTaskId)
  expect(retained).toMatchObject({ dispatchId: first.dispatchId, outcome: 'native_retained' })
  expect(native.spawn).toHaveBeenCalledTimes(1)
  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/host stopped/i)
})

it.each(['missing', 'forged-token', 'wrong-pane', 'wrong-attempt'])(
  'refuses a native worker_done with %s proof at the commit boundary',
  async (tamper) => {
    const f = await setup()
    const { run, writerTaskId } = await createNativeRun(f)
    const dispatchId = await dispatchWriter(f, run.id)
    const dispatch = f.db.getDispatchContextById(dispatchId)!
    const created = f.createdTerminals.find(
      (terminal) => terminal.handle === dispatch.assignee_handle
    )!
    const evidence = evidenceFor(created)
    const tampered =
      tamper === 'forged-token'
        ? { ...evidence, launchToken: 'forged-token' }
        : tamper === 'wrong-pane'
          ? { ...evidence, paneKey: 'tab_forged:00000000-0000-4000-8000-000000000000' }
          : evidence
    const response = await sendWorkerDone(f, {
      handle: tamper === 'wrong-attempt' ? 'term_forged_handle' : created.handle,
      dispatchId,
      taskId: writerTaskId,
      outcome: 'succeeded',
      structuredResult: structuredReport(
        f.store.listAutomationRuns().find((r) => r.id === run.id)!,
        { childDefinitionId: 'writer', taskId: writerTaskId, dispatchId }
      ),
      ...(tamper === 'missing' ? {} : { evidence: tampered })
    })
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('consumer_fenced')
    expect(f.db.getDispatchContextById(dispatchId)!.status).toBe('dispatched')
  }
)

it('settles an authenticated report once; a duplicate replay cannot double-settle', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)
  const dispatch = f.db.getDispatchContextById(dispatchId)!
  const created = f.createdTerminals.find(
    (terminal) => terminal.handle === dispatch.assignee_handle
  )!
  const evidence = evidenceFor(created)
  const current = () => f.store.listAutomationRuns().find((r) => r.id === run.id)!
  const report = structuredReport(current(), {
    childDefinitionId: 'writer',
    taskId: writerTaskId,
    dispatchId
  })
  const first = await sendWorkerDone(f, {
    handle: created.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: report,
    evidence
  })
  expect(first.ok).toBe(true)
  const replay = await sendWorkerDone(f, {
    handle: created.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: report,
    evidence
  })
  expect(replay.ok).toBe(true)
  // The replay is acknowledged against the settled attempt without a second settlement.
  expect(f.db.getDispatchContextById(dispatchId)!.status).toBe('completed')
  expect(f.db.getTask(writerTaskId)!.status).toBe('completed')
  expect(nativeAttemptSettlementProblem(f.db, current(), dispatchId)).toBeNull()
  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('completed')
})

it('refuses reports after the runtime generation changed, while the durable settlement still reads', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f, [
    child('writer'),
    child('reviewer', { dependencies: [{ childId: 'writer', condition: 'accepted' }] })
  ])
  const reviewerTaskId = run.childMappings!.find((m) => m.childDefinitionId === 'reviewer')!.taskId
  const dispatchId = await dispatchWriter(f, run.id)
  const dispatch = f.db.getDispatchContextById(dispatchId)!
  const created = f.createdTerminals.find(
    (terminal) => terminal.handle === dispatch.assignee_handle
  )!
  Object.defineProperty(f.runtime, 'runtimeId', { value: 'restarted-generation' })
  const refused = await sendWorkerDone(f, {
    handle: created.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(
      f.store.listAutomationRuns().find((r) => r.id === run.id)!,
      { childDefinitionId: 'writer', taskId: writerTaskId, dispatchId }
    ),
    evidence: evidenceFor(created)
  })
  expect(refused.ok).toBe(false)
  expect(JSON.stringify(refused)).toContain('consumer_fenced')

  // Without the native host the run is still read honestly: the retained attempt is not
  // respawned, and a fresh launch is refused rather than silently mixed with the fake protocol.
  const plain = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })
  const retained = await plain.dispatchTask(run.id, writerTaskId)
  expect(retained).toMatchObject({ dispatchId, outcome: 'native_retained' })
  await expect(plain.dispatchTask(run.id, reviewerTaskId)).rejects.toThrow(
    /without the native host/
  )
})

it('completes a durably settled native run through an adapter without the native host', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const dispatchId = await dispatchWriter(f, run.id)
  const dispatch = f.db.getDispatchContextById(dispatchId)!
  const created = f.createdTerminals.find(
    (terminal) => terminal.handle === dispatch.assignee_handle
  )!
  const accepted = await sendWorkerDone(f, {
    handle: created.handle,
    dispatchId,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(
      f.store.listAutomationRuns().find((r) => r.id === run.id)!,
      { childDefinitionId: 'writer', taskId: writerTaskId, dispatchId }
    ),
    evidence: evidenceFor(created)
  })
  expect(accepted.ok).toBe(true)

  const plain = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })
  const outcome = await plain.reconcileRun(run.id)
  expect(outcome.state).toBe('completed')
  expect(outcome.run.completionReceipt).toBeTruthy()
})

it('holds outcome_uncertain instead of dispatch_failed while a sibling native attempt is uncertain', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f, [child('writer'), child('reviewer')])
  const reviewerTaskId = run.childMappings!.find((m) => m.childDefinitionId === 'reviewer')!.taskId
  const first = await f.adapter.reconcileRun(run.id)
  expect(first.state).toBe('outcome_uncertain')
  expect(native.spawn).toHaveBeenCalledTimes(2)
  const mappings = f.store.listAutomationRuns().find((r) => r.id === run.id)!.childMappings!
  const writerDispatch = mappings.find((m) => m.childDefinitionId === 'writer')!.dispatchId!
  const reviewerDispatch = mappings.find((m) => m.childDefinitionId === 'reviewer')!.dispatchId!
  const current = () => f.store.listAutomationRuns().find((r) => r.id === run.id)!
  const writerTerminal = f.createdTerminals.find(
    (terminal) => terminal.handle === f.db.getDispatchContextById(writerDispatch)!.assignee_handle
  )!

  // A natively settled attempt whose semantic report is invalid rejects the stage; the sibling
  // stays uncertain, so the run must not project failure yet.
  const invalid = await sendWorkerDone(f, {
    handle: writerTerminal.handle,
    dispatchId: writerDispatch,
    taskId: writerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(
      current(),
      {
        childDefinitionId: 'writer',
        taskId: writerTaskId,
        dispatchId: writerDispatch
      },
      { outcome: 'failed', summary: 'Writer produced no usable draft.' }
    ),
    evidence: evidenceFor(writerTerminal)
  })
  expect(invalid.ok).toBe(true)
  const held = await f.adapter.reconcileRun(run.id)
  expect(held.state).toBe('outcome_uncertain')
  expect(held.run.status).not.toBe('dispatch_failed')

  const reviewerTerminal = f.createdTerminals.find(
    (terminal) => terminal.handle === f.db.getDispatchContextById(reviewerDispatch)!.assignee_handle
  )!
  const reviewerDone = await sendWorkerDone(f, {
    handle: reviewerTerminal.handle,
    dispatchId: reviewerDispatch,
    taskId: reviewerTaskId,
    outcome: 'succeeded',
    structuredResult: structuredReport(current(), {
      childDefinitionId: 'reviewer',
      taskId: reviewerTaskId,
      dispatchId: reviewerDispatch
    }),
    evidence: evidenceFor(reviewerTerminal)
  })
  expect(reviewerDone.ok).toBe(true)
  const failed = await f.adapter.reconcileRun(run.id)
  expect(failed.state).toBe('failed')
  expect(failed.run.status).toBe('dispatch_failed')
})

it('repairs the Store child mapping after a crash between Dispatch creation and mapping write', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const record = f.store.recordCoordinatedChildDispatch.bind(f.store)
  let crashed = false
  vi.spyOn(f.store, 'recordCoordinatedChildDispatch').mockImplementation((input) => {
    if (!crashed) {
      crashed = true
      throw new Error('Simulated crash between native Dispatch creation and Store mapping')
    }
    return record(input)
  })
  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/Simulated crash/)

  const crashRun = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(
    crashRun.childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId
  ).toBeNull()
  expect(f.db.getDispatchContext(writerTaskId)).toBeDefined()
  expect(native.spawn).not.toHaveBeenCalled()

  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('outcome_uncertain')
  const repaired = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  const dispatchId = repaired.childMappings!.find(
    (m) => m.childDefinitionId === 'writer'
  )!.dispatchId!
  expect(dispatchId).toBe(f.db.getDispatchContext(writerTaskId)!.id)
  // Repair never respawns the attempt.
  expect(native.spawn).not.toHaveBeenCalled()
  expect(nativeAttemptSettlementProblem(f.db, repaired, dispatchId)).toMatch(/no authenticated/)
})

it('holds safely without respawn when the crashed mapping cannot be proven exactly', async () => {
  const f = await setup()
  const { run, writerTaskId } = await createNativeRun(f)
  const record = f.store.recordCoordinatedChildDispatch.bind(f.store)
  let crashed = false
  vi.spyOn(f.store, 'recordCoordinatedChildDispatch').mockImplementation((input) => {
    if (!crashed) {
      crashed = true
      throw new Error('Simulated crash between native Dispatch creation and Store mapping')
    }
    return record(input)
  })
  await expect(f.adapter.reconcileRun(run.id)).rejects.toThrow(/Simulated crash/)
  const tampered = f.db.getDispatchContext(writerTaskId)!.id
  const row = f.db.getWorkerDispatch(tampered)!
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(row.start_options!.replace('"version":1', '"version":9'), tampered)

  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('outcome_uncertain')
  expect(outcome.reason).toContain('cannot be proven exactly')
  const held = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(held.childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId).toBeNull()
  expect(native.spawn).not.toHaveBeenCalled()
})

it('keeps the fake_no_effects path unchanged without a native host', async () => {
  const f = await setup()
  const automation = f.store.createCoordinatedAutomation(coordinatedCreateInput())
  const { run } = f.store.createCoordinatedAutomationRun({
    automationId: automation.id,
    scheduledFor: 1000
  })
  const plain = new CoordinatedAutomationAdapter({ store: f.store, orchestrationDb: f.db })
  const materialized = await plain.materializeRun(run!.id)
  const outcome = await plain.reconcileRun(materialized.id)
  expect(outcome.state).toBe('completed')
  expect(outcome.run.completionReceipt).toBeTruthy()
})
