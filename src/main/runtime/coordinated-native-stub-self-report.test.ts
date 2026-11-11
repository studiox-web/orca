import './rpc/unused-default-rpc-methods.test-fixture'
// The pinned stub's own completion report: built fixture-side from nothing but the brief the stub
// received on its stdin and the environment it was spawned with, then sent through the same
// authenticated orchestration.send ingress every worker uses. The test harness injects no
// credential. Readiness (READY marker), turn start (SUBMITTED echo) and the report stay separate.
// PTY bytes are emulated; the real stub binary is not started.

import { expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import {
  buildNativeStubCompletionReport,
  type NativeStubCompletionRefusal
} from '../../shared/native-stub-fixture-report'
import {
  formatCoordinatedReportContract,
  parseCoordinatedReportContract
} from '../../shared/coordinated-automation-report-contract'
import { nativeAttemptSettlementProblem } from '../automations/coordinated-automation-native-attempt'
import {
  installNativeStubAttemptHooks,
  setStubPtyBehavior,
  setStubSelfReport,
  setupNativeStubAttempt as setup,
  type NativeStubAttemptFixture
} from './coordinated-native-stub-attempt.test-support'
import { createNativeRun } from './coordinated-native-stub-run.test-support'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

installNativeStubAttemptHooks(native.spawn)

type StubReportAttempt =
  | { kind: 'sent'; params: unknown; ok: boolean }
  | { kind: 'refused'; reason: NativeStubCompletionRefusal }

/** Plays the stub's side: act on its own input and environment, over the real RPC dispatcher. */
function letStubReport(
  f: NativeStubAttemptFixture,
  tamperEnv: (env: Record<string, string>) => Record<string, string> = (env) => env
) {
  const attempts: StubReportAttempt[] = []
  let sent = 0
  let done: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    done = resolve
  })
  setStubSelfReport((transcript, env) => {
    const built = buildNativeStubCompletionReport({ brief: transcript, env: tamperEnv(env) })
    if (built.kind === 'refused') {
      // The stub keeps reading until the whole brief has arrived.
      if (built.reason !== 'brief_has_no_report_contract') {
        attempts.push(built)
        done()
      }
      return
    }
    if (sent > 0) {
      return
    }
    sent += 1
    const { orchestrationCompatibilityEvidence, ...message } = built.request
    void f.dispatcher
      .dispatch({
        id: 'stub-report',
        authToken: 'test',
        ...message,
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationRequestId: 'stub-report-1',
        orchestrationCompatibilityEvidence
      })
      .then((response) => {
        attempts.push({ kind: 'sent', params: message.params, ok: response.ok })
        done()
      })
  })
  return { attempts, settled }
}

it('lets the stub submit its own authenticated completion report from its stdin brief and spawn environment', async () => {
  const f = await setup()
  const report = letStubReport(f)
  const { run, writerTaskId } = await createNativeRun(f)
  await f.adapter.reconcileRun(run.id)
  await report.settled
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const terminal = f.createdTerminals.at(-1)!

  expect(report.attempts).toMatchObject([{ kind: 'sent', ok: true }])
  // The launch token reached the stub only through its environment, and left only in the envelope.
  const [file, args, options] = native.spawn.mock.calls[0]
  expect(options.env.ORCA_AGENT_LAUNCH_TOKEN).toBe(terminal.launchToken)
  expect(JSON.stringify([file, args])).not.toContain(terminal.launchToken)
  expect(JSON.stringify(report.attempts)).not.toContain(terminal.launchToken)

  // Settled by the authenticated ingress itself: exact assignee, token, pane and process.
  const dispatch = f.db.getDispatchContextById(dispatchId)!
  expect(dispatch.status).toBe('completed')
  expect(dispatch.assignee_handle).toBe(terminal.handle)
  expect(f.db.getWorkerDispatch(dispatchId)).toMatchObject({ state: 'succeeded', stage: 'settled' })
  expect(
    f.db.getAttemptObservationFacts(dispatchId).find((fact) => fact.facet === 'worker_report')
  ).toMatchObject({
    authorityId: `run_home:${run.orchestrationRunId}`,
    payload: { status: 'accepted', outcome: 'succeeded' }
  })
  const current = f.store.listAutomationRuns().find((r) => r.id === run.id)!
  expect(nativeAttemptSettlementProblem(f.db, current, dispatchId)).toBeNull()

  const completed = await f.adapter.reconcileRun(run.id)
  expect(completed.state).toBe('completed')
  expect(completed.run.completionReceipt).toBeTruthy()
  // One process, one Dispatch, one report.
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
})

it('refuses the stub report at the commit boundary when its environment token is not the minted one', async () => {
  const f = await setup()
  const report = letStubReport(f, (env) => ({ ...env, ORCA_AGENT_LAUNCH_TOKEN: 'not-the-token' }))
  const { run, writerTaskId } = await createNativeRun(f)
  await f.adapter.reconcileRun(run.id)
  await report.settled
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id

  expect(report.attempts).toMatchObject([{ kind: 'sent', ok: false }])
  expect(f.db.getDispatchContextById(dispatchId)!.status).not.toBe('completed')
  expect(f.db.getWorkerDispatch(dispatchId)!.state).not.toBe('succeeded')
  const outcome = await f.adapter.reconcileRun(run.id)
  expect(outcome.state).toBe('outcome_uncertain')
  expect(outcome.run.completionReceipt ?? null).toBeNull()
})

it.each<[NativeStubCompletionRefusal, (env: Record<string, string>) => Record<string, string>]>([
  ['environment_has_no_launch_identity', ({ ORCA_AGENT_LAUNCH_TOKEN: _token, ...env }) => env],
  ['brief_addressed_to_another_terminal', (env) => ({ ...env, ORCA_TERMINAL_HANDLE: 'term_other' })]
])('never sends a stub report when the fixture side sees %s', async (reason, tamper) => {
  const f = await setup()
  const report = letStubReport(f, tamper)
  const { run, writerTaskId } = await createNativeRun(f)
  await f.adapter.reconcileRun(run.id)
  await report.settled

  expect(report.attempts[0]).toEqual({ kind: 'refused', reason })
  expect(report.attempts.some((attempt) => attempt.kind === 'sent')).toBe(false)
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  expect(f.db.getDispatchContextById(dispatchId)!.status).not.toBe('completed')
  expect((await f.adapter.reconcileRun(run.id)).state).toBe('outcome_uncertain')
})

it('keeps a ready stub that never echoes its submission start-unknown within the frozen launch budget', async () => {
  const f = await setup()
  setStubPtyBehavior('never_submits')
  const { run, writerTaskId } = await createNativeRun(f, undefined, 3)
  const startedAt = Date.now()
  const first = await f.adapter.reconcileRun(run.id)
  const elapsedMs = Date.now() - startedAt

  expect(first.state).toBe('outcome_uncertain')
  // Bounded by the child's frozen 3 s budget, not by a fixed prompt-effect timeout.
  expect(elapsedMs).toBeLessThan(6_000)
  const dispatchId = f.db.getDispatchContext(writerTaskId)!.id
  const process = native.spawn.mock.results[0].value
  // Readiness was proven and the brief was written; only the turn start is unproven.
  expect(process.write).toHaveBeenCalled()
  const worker = f.db.getWorkerDispatch(dispatchId)!
  expect(['ready', 'succeeded', 'failed']).not.toContain(worker.state)
  expect(f.db.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
    ownership_state: 'owned'
  })

  const again = await f.adapter.reconcileRun(run.id)
  expect(again.state).toBe('outcome_uncertain')
  expect(native.spawn).toHaveBeenCalledTimes(1)
  expect(f.db.getDispatchContext(writerTaskId)!.id).toBe(dispatchId)
  expect(again.run.completionReceipt ?? null).toBeNull()
})

it('reads a report contract back only when the brief still carries it unaltered', () => {
  const contract = {
    schemaVersion: 1 as const,
    automationRunId: 'run',
    orchestrationRunId: 'orch',
    childDefinitionId: 'writer',
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    definitionRevision: 2,
    resolvedConfigDigest: `sha256:${'a'.repeat(64)}`,
    requiredCheckIds: ['draft-ready']
  }
  const brief = `Do the work.\n\n${formatCoordinatedReportContract(contract)}`
  expect(parseCoordinatedReportContract(brief)).toEqual(contract)
  expect(parseCoordinatedReportContract('Do the work.')).toBeNull()
  expect(
    parseCoordinatedReportContract(brief.replace('"definitionRevision":2', '"x":2'))
  ).toBeNull()
  expect(buildNativeStubCompletionReport({ brief: 'no contract here', env: {} })).toEqual({
    kind: 'refused',
    reason: 'brief_has_no_report_contract'
  })
})
