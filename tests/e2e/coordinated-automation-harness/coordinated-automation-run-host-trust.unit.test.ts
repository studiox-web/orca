import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../src/shared/automations-types'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { CoordinatedHostStoppedError } from '../../../src/main/automations/coordinated-automation-recovery-context'
import { CoordinatedRunHostRefusedError } from '../../../src/main/automations/coordinated-automation-run-host-types'
import { COORDINATED_PROGRESS_DIRECTORY } from '../../../src/main/automations/coordinated-automation-run-host'
import { inspectCoordinatedRun } from '../../../src/main/automations/coordinated-automation-run-inspection'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import type { ScriptedWorkerAction } from './isolated-adapters'
import { InjectedCoordinatorCrash } from './coordinated-automation-recovery-env'
import {
  SELF,
  disposeRunHostFixture,
  enableSetting,
  env,
  hostProgress,
  injection,
  request,
  running,
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

const progressRoot = () => join(testState.dir, COORDINATED_PROGRESS_DIRECTORY)

function progressPath(automationRunId: string): string {
  return join(progressRoot(), `${createHash('sha256').update(automationRunId).digest('hex')}.json`)
}

/** Writes schema-valid but forged progress directly, bypassing every coordinator check. */
type ForgedProgress = Record<string, unknown> & {
  stages: Record<string, Record<string, unknown>>
}

function forgeProgress(automationRunId: string, mutate: (progress: ForgedProgress) => void) {
  const progress: ForgedProgress = JSON.parse(readFileSync(progressPath(automationRunId), 'utf8'))
  mutate(progress)
  writeFileSync(progressPath(automationRunId), JSON.stringify(progress))
}

async function completedRun() {
  const service = startService({ injection: injection() })
  const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
  const done = await service.coordinatedRuns.startManualRun(request(automationId))
  expect(done.state).toBe('completed')
  const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
  return { service, automationId, done, scope }
}

describe('manual start replay identity', () => {
  it('refuses a bogus revision on replay, accepts the exact repeat, and keeps it after a later edit', async () => {
    const { service, automationId, done } = await completedRun()
    const runs = () => env.store.listAutomationRuns(automationId).length

    await expect(
      service.coordinatedRuns.startManualRun({
        ...request(automationId),
        expectedDefinitionRevision: 999
      })
    ).rejects.toThrow(/recorded for revision 1/)
    expect(runs()).toBe(1)

    const repeat = await service.coordinatedRuns.startManualRun(request(automationId))
    expect(repeat).toMatchObject({ created: false, automationRunId: done.automationRunId })
    expect(repeat.inspection.receipt).toEqual(done.inspection.receipt)

    env.store.updateCoordinatedAutomation(automationId, {
      expectedDefinitionRevision: 1,
      children: [
        child('research'),
        child('writer', { dependencies: [{ childId: 'research', condition: 'accepted' }] })
      ]
    })
    const afterEdit = await service.coordinatedRuns.startManualRun(request(automationId))
    expect(afterEdit).toMatchObject({ created: false, automationRunId: done.automationRunId })
    expect(afterEdit.inspection.definitionRevision).toBe(1)
    // A distinct occurrence needs a distinct time; the fingerprint excludes the key.
    await env.harness.clock.advanceBy(1_000)
    await expect(
      service.coordinatedRuns.startManualRun({
        ...request(automationId, 'new-key'),
        expectedDefinitionRevision: 1
      })
    ).rejects.toThrow(/revision changed/)
    expect(runs()).toBe(1)
    const fresh = await service.coordinatedRuns.startManualRun({
      ...request(automationId, 'new-key'),
      expectedDefinitionRevision: 2
    })
    expect(fresh.created).toBe(true)
    expect(fresh.inspection.definitionRevision).toBe(2)
  })
})

describe('retained runs follow their frozen authority', () => {
  it('a later local-to-SSH target edit neither strands nor redirects the frozen local run', async () => {
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    env.crashAt('report.after-native-settle')
    await expect(
      startService({ injection: injection() }).coordinatedRuns.startManualRun(request(automationId))
    ).rejects.toThrow(InjectedCoordinatorCrash)
    const [run] = env.store.listAutomationRuns(automationId)
    env.store.updateCoordinatedAutomation(automationId, {
      expectedDefinitionRevision: 1,
      projectId: 'repo-ssh'
    })
    expect(
      env.store.listAutomations().find((a) => a.id === automationId)?.executionTargetType
    ).toBe('ssh')

    services.splice(0).forEach((service) => service.stop())
    await env.reopen()
    enableSetting()
    const restarted = startService({ injection: injection() })
    await running(restarted)
    const scope = { automationId, automationRunId: run.id, expectedOwner: SELF }
    const inspection = restarted.coordinatedRuns.inspectRun(scope)
    expect(inspection.receipt.kind).toBe('available')
    expect(inspection.canonicalDigest).toBe(run.resolvedSnapshot!.canonicalDigest)
    expect(env.dispatchIds(run.id, 'research')).toHaveLength(1)
    // New work is still fenced by the current (now SSH) owner.
    await expect(
      restarted.coordinatedRuns.startManualRun(request(automationId, 'after-edit'))
    ).rejects.toThrow(CoordinatedRunHostRefusedError)

    env.store.archiveCoordinatedAutomation({
      automationId,
      expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
    })
    expect(() => restarted.coordinatedRuns.inspectRun(scope)).toThrow(
      CoordinatedRunHostRefusedError
    )
  })
})

describe('inspection trusts only validated evidence', () => {
  it.each([
    ['automationId', (p: ForgedProgress) => (p.automationId = 'foreign-automation')],
    ['definitionRevision', (p: ForgedProgress) => (p.definitionRevision = 7)],
    ['executionAuthority', (p: ForgedProgress) => (p.executionAuthority = 'ssh:ssh-1')],
    ['orchestrationRunId', (p: ForgedProgress) => (p.orchestrationRunId = 'run_000000000000')],
    ['canonicalDigest', (p: ForgedProgress) => (p.canonicalDigest = `sha256:${'f'.repeat(64)}`)],
    [
      'foreign stage key',
      (p: ForgedProgress) => {
        p.stages.ghost = p.stages.research
      }
    ]
  ])('reports forged %s progress as unavailable', async (_field, mutate) => {
    const { service, done, scope } = await completedRun()
    const before = readFileSync(progressPath(done.automationRunId), 'utf8')
    forgeProgress(done.automationRunId, mutate)
    const forged = readFileSync(progressPath(done.automationRunId), 'utf8')
    const inspection = service.coordinatedRuns.inspectRun(scope)
    expect(inspection.progress.kind).toBe('unavailable')
    expect(inspection.stages.every((s) => s.semantic.kind === 'unavailable')).toBe(true)
    // Read-only: no generation claim or repair.
    expect(readFileSync(progressPath(done.automationRunId), 'utf8')).toBe(forged)
    expect(forged).not.toBe(before)
  })

  it.each([
    ['foreign accepted Dispatch', 'acceptedDispatchId', 'ctx_000000000000'],
    ['another stage’s Dispatch', 'acceptedDispatchId', 'OTHER_STAGE'],
    ['null accepted Dispatch', 'acceptedDispatchId', null],
    ['mismatched report digest', 'acceptedReportDigest', `sha256:${'e'.repeat(64)}`],
    ['foreign lineage Dispatch', 'activeDispatchId', 'ctx_000000000000']
  ])('reports a stage with %s as unavailable', async (_name, field, value) => {
    const { service, done, scope } = await completedRun()
    const writerDispatch = done.inspection.stages.find(
      (s) => s.childDefinitionId === 'writer'
    )!.mappedDispatchId
    forgeProgress(done.automationRunId, (p) => {
      const stage = p.stages.research
      stage[field] = value === 'OTHER_STAGE' ? writerDispatch : value
    })
    const inspection = service.coordinatedRuns.inspectRun(scope)
    expect(inspection.progress.kind).toBe('available')
    const research = inspection.stages.find((s) => s.childDefinitionId === 'research')!
    const writer = inspection.stages.find((s) => s.childDefinitionId === 'writer')!
    expect(research.semantic.kind).toBe('unavailable')
    expect(writer.semantic.kind).toBe('available')
  })

  it.each<[string, (run: AutomationRun) => AutomationRun]>([
    [
      'frozen digest',
      (run) => ({
        ...run,
        completionReceipt: {
          ...run.completionReceipt!,
          frozenConfigDigest: `sha256:${'a'.repeat(64)}`
        }
      })
    ],
    [
      'run identity',
      (run) => ({
        ...run,
        completionReceipt: {
          ...run.completionReceipt!,
          identityChain: { ...run.completionReceipt!.identityChain, automationRunId: 'foreign-run' }
        }
      })
    ],
    [
      'orchestration Run',
      (run) => ({
        ...run,
        completionReceipt: {
          ...run.completionReceipt!,
          identityChain: {
            ...run.completionReceipt!.identityChain,
            orchestrationRunId: 'run_000000000000'
          }
        }
      })
    ],
    [
      'revision',
      (run) => ({
        ...run,
        completionReceipt: {
          ...run.completionReceipt!,
          identityChain: { ...run.completionReceipt!.identityChain, definitionRevision: 9 }
        }
      })
    ],
    [
      'task mappings',
      (run) => ({
        ...run,
        completionReceipt: {
          ...run.completionReceipt!,
          identityChain: { ...run.completionReceipt!.identityChain, taskMappings: [] }
        }
      })
    ],
    ['missing trust', (run) => ({ ...run, completionTrust: null })],
    [
      'foreign active attempt',
      (run) => ({
        ...run,
        completionTrust: {
          ...run.completionTrust!,
          activeAttempt: { ...run.completionTrust!.activeAttempt, dispatchId: 'ctx_000000000000' }
        }
      })
    ]
  ])('reports a receipt with a forged %s as unavailable', async (_name, forge) => {
    const { done } = await completedRun()
    const run = env.run(done.automationRunId)
    const read = (candidate: AutomationRun) =>
      inspectCoordinatedRun({
        run: candidate,
        orchestrationDb: env.db,
        progressStore: createFileCoordinatedRunProgressStore(progressRoot())
      })
    expect(read(run).receipt.kind).toBe('available')
    expect(read(forge(run)).receipt.kind).toBe('unavailable')
  })
})

describe('progress publication seam', () => {
  it('publishes scoped run changes after durable progress writes and stops after stop()', async () => {
    const service = startService({ injection: injection() })
    const published: unknown[] = []
    vi.spyOn(service, 'publishAutomationsChanged').mockImplementation((payload) => {
      published.push(payload)
      throw new Error('listener failure must not undo a durable write')
    })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const done = await service.coordinatedRuns.startManualRun(request(automationId))
    expect(done.state).toBe('completed')
    expect(published.length).toBeGreaterThan(0)
    expect(
      published.every(
        (p) => JSON.stringify(p) === JSON.stringify({ reason: 'run', selector: { kind: 'self' } })
      )
    ).toBe(true)
    const count = published.length
    const scope = { automationId, automationRunId: done.automationRunId, expectedOwner: SELF }
    service.coordinatedRuns.inspectRun(scope)
    expect(published).toHaveLength(count)
    service.stop()
    expect(published).toHaveLength(count)
  })
})

describe('stop frees deadline timers', () => {
  it('a hung provider plus stop leaves no timer, settlement, or new dispatch', async () => {
    env.scripts.set('research', () => new Promise<ScriptedWorkerAction[]>(() => {}))
    const service = startService({ injection: injection() })
    const { automationId } = env.createDefinitionOnly(coordinatedCreateInput())
    const pending = service.coordinatedRuns.startManualRun(request(automationId))
    await vi.waitFor(() => expect(env.store.listAutomationRuns(automationId)).toHaveLength(1))
    const [run] = env.store.listAutomationRuns(automationId)
    await vi.waitFor(() => expect(env.harness.clock.pendingCount()).toBe(1))
    const [dispatchId] = env.dispatchIds(run.id, 'research')
    const progressBefore = hostProgress(run.id)

    service.stop()
    await expect(pending).rejects.toThrow(CoordinatedHostStoppedError)
    expect(env.harness.clock.pendingCount()).toBe(0)
    await env.harness.clock.advanceBy(3_600_000)
    expect(env.db.getDispatchContextById(dispatchId)!.status).not.toBe('failed')
    expect(env.db.getDispatchContextById(dispatchId)!.status).not.toBe('completed')
    expect(env.dispatchIds(run.id, 'research')).toEqual([dispatchId])
    expect(env.dispatchIds(run.id, 'writer')).toHaveLength(0)
    expect(hostProgress(run.id)).toEqual(progressBefore)
  })
})
