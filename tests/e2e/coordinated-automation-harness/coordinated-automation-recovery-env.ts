import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import type { StructuredWorkerResult } from '../../../src/shared/coordinated-automation-receipt-types'
import type { StageEffectRequirement } from '../../../src/shared/coordinated-automation-types'
import {
  closeTestStores,
  createStore,
  testState,
  writeDataFile
} from '../../../src/main/persistence/persistence-test-harness'
import { coordinatedTestState } from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { OrchestrationDb } from '../../../src/main/runtime/orchestration/db'
import { CoordinatedAutomationTestHarness } from './coordinated-automation-test-harness'
import type { ScriptedWorkerAction } from './isolated-adapters'
import {
  CoordinatedAutomationAdapter,
  type CoordinatedAutomationAdapterContext,
  type CoordinatedHostApproval,
  type CoordinatedWorkerIdentity,
  type CoordinatedWorkerProvider
} from '../../../src/main/automations/coordinated-automation-adapter'
import { deterministicCoordinatedEffectId } from '../../../src/main/automations/coordinated-automation-effect-gate'
import type {
  CoordinatedBoundaryHook,
  CoordinatedDurableBoundary
} from '../../../src/main/automations/coordinated-automation-progress-ledger'
import { createFileCoordinatedRunProgressStore } from '../../../src/main/automations/coordinated-automation-progress-store'
import type { CoordinatedLaneLockProvider } from '../../../src/main/automations/coordinated-automation-recovery-context'

export class InjectedCoordinatorCrash extends Error {
  constructor(
    readonly boundary: string,
    readonly occurrence: number
  ) {
    super(`Injected coordinator crash at ${boundary} #${occurrence}`)
    this.name = 'InjectedCoordinatorCrash'
  }
}

export type WorkerScript = (
  identity: CoordinatedWorkerIdentity,
  attempt: number,
  env: RecoveryEnv
) => ScriptedWorkerAction[] | Promise<ScriptedWorkerAction[]>

export type BoundaryVisit = { boundary: CoordinatedDurableBoundary; label: string }

/** Real Store + file-backed orchestration DB + harness fakes, all under one temp root. */
export class RecoveryEnv {
  store!: ReturnType<typeof createStore>
  db!: OrchestrationDb
  adapter!: CoordinatedAutomationAdapter
  readonly scripts = new Map<string, WorkerScript>()
  readonly attempts = new Map<string, number>()
  readonly boundaries: BoundaryVisit[] = []
  crashAtBoundaryIndex: number | null = null
  crashOn: { boundary: CoordinatedDurableBoundary; occurrence: number; seen: number } | null = null
  approvals: () => readonly CoordinatedHostApproval[] = () => []
  costPerAttemptUsd = 0
  laneLocks?: CoordinatedLaneLockProvider
  running = 0
  maxRunning = 0

  private constructor(readonly harness: CoordinatedAutomationTestHarness) {}

  static async create(options: { nestedProfile?: boolean } = {}): Promise<RecoveryEnv> {
    const env = new RecoveryEnv(await CoordinatedAutomationTestHarness.create())
    testState.dir = options.nestedProfile
      ? join(env.harness.root, 'profiles', 'local')
      : join(env.harness.root, 'profile')
    mkdirSync(testState.dir, { recursive: true })
    mkdirSync(env.workspacePath, { recursive: true })
    writeDataFile(coordinatedTestState())
    env.#open()
    return env
  }

  get workspacePath(): string {
    return join(this.harness.root, 'artifacts')
  }

  #open(): void {
    this.store = createStore()
    this.db = new OrchestrationDb(join(this.harness.root, 'orchestration.sqlite'))
    this.adapter = new CoordinatedAutomationAdapter(this.#adapterContext())
  }

  #adapterContext(): CoordinatedAutomationAdapterContext {
    return {
      store: this.store,
      orchestrationDb: this.db,
      workspacePath: this.workspacePath,
      progressStore: createFileCoordinatedRunProgressStore(join(this.harness.root, 'progress')),
      clock: this.clock(),
      effectAdapter: this.harness.effects,
      laneLocks: this.laneLocks,
      hostApprovals: () => this.approvals(),
      durableBoundary: this.boundaryHook(),
      workerProvider: this.workerProvider()
    }
  }

  /** Records every coordinator durable boundary and throws at an armed one. */
  boundaryHook(): CoordinatedBoundaryHook {
    return (boundary, detail) => {
      const index = this.boundaries.length
      this.boundaries.push({ boundary, label: detail.label ?? '' })
      this.harness.trace.record(this.harness.clock.now(), 'coordinator.boundary', detail, {
        boundary
      })
      if (this.crashAtBoundaryIndex === index) {
        this.crashAtBoundaryIndex = null
        throw new InjectedCoordinatorCrash(boundary, index)
      }
      if (this.crashOn?.boundary === boundary) {
        this.crashOn.seen += 1
        if (this.crashOn.seen === this.crashOn.occurrence) {
          this.crashOn = null
          throw new InjectedCoordinatorCrash(boundary, index)
        }
      }
    }
  }

  /** Harness clock with deadline timers; shared by every coordinator generation. */
  clock(): { now: () => number; setTimer: (delayMs: number, callback: () => void) => () => void } {
    return {
      now: () => this.harness.clock.now(),
      setTimer: (delayMs, callback) => {
        const id = this.harness.clock.scheduleIn('stage-deadline', delayMs, callback)
        return () => void this.harness.clock.cancel(id)
      }
    }
  }

  /** Scripted fake_no_effects provider; never a real agent. */
  workerProvider(): CoordinatedWorkerProvider {
    return {
      capability: 'fake_no_effects',
      estimateCostUsd: () => this.costPerAttemptUsd,
      run: async (identity) => {
        const attempt = (this.attempts.get(identity.childDefinitionId) ?? 0) + 1
        this.attempts.set(identity.childDefinitionId, attempt)
        const script = this.scripts.get(identity.childDefinitionId)
        if (!script) {
          throw new Error(`No script for ${identity.childDefinitionId}`)
        }
        this.running += 1
        this.maxRunning = Math.max(this.maxRunning, this.running)
        try {
          const actions = await script(identity, attempt, this)
          this.harness.workers.script({ identity, actions })
          return await this.harness.workers.run(identity)
        } finally {
          this.running -= 1
        }
      }
    }
  }

  crashAt(boundary: CoordinatedDurableBoundary, occurrence = 1): void {
    this.crashOn = { boundary, occurrence, seen: 0 }
  }

  /** A second coordinator over the same live Store and DB, e.g. while the first is still awaiting a worker. */
  replacementAdapter(): CoordinatedAutomationAdapter {
    return new CoordinatedAutomationAdapter(this.#adapterContext())
  }

  /** Simulates a coordinator process replacement over the same durable evidence. */
  async reopen(): Promise<void> {
    this.db.close()
    await closeTestStores()
    this.#open()
  }

  async dispose(): Promise<void> {
    this.db.close()
    await closeTestStores()
    await this.harness.dispose()
  }

  createRun(input: CoordinatedAutomationCreateInput): { automationId: string; runId: string } {
    const automation = this.store.createCoordinatedAutomation(input)
    const { run } = this.store.createCoordinatedAutomationRun({
      automationId: automation.id,
      scheduledFor: 1000
    })
    return { automationId: automation.id, runId: run!.id }
  }

  createDefinitionOnly(input: CoordinatedAutomationCreateInput): { automationId: string } {
    return { automationId: this.store.createCoordinatedAutomation(input).id }
  }

  run(runId: string) {
    return this.store.listAutomationRuns().find((r) => r.id === runId)!
  }

  taskId(runId: string, childDefinitionId: string): string {
    const mapping = (this.run(runId).childMappings ?? []).find(
      (m) => m.childDefinitionId === childDefinitionId
    )
    if (!mapping) {
      throw new Error(`Child ${childDefinitionId} is not mapped`)
    }
    return mapping.taskId
  }

  dispatchIds(runId: string, childDefinitionId: string): string[] {
    const rows = this.db.db
      .prepare('SELECT id FROM dispatch_contexts WHERE task_id = ? ORDER BY rowid')
      .all(this.taskId(runId, childDefinitionId))
    return rows.flatMap((row) =>
      typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string'
        ? [row.id]
        : []
    )
  }

  effectId(runId: string, childDefinitionId: string, requirement: StageEffectRequirement): string {
    return deterministicCoordinatedEffectId(runId, childDefinitionId, requirement)
  }

  report(
    identity: CoordinatedWorkerIdentity,
    overrides: Partial<StructuredWorkerResult> = {}
  ): StructuredWorkerResult {
    const snapshot = this.run(identity.automationRunId).resolvedSnapshot!
    return {
      schemaVersion: 1,
      ...identity,
      definitionRevision: snapshot.definitionRevision,
      resolvedConfigDigest: snapshot.canonicalDigest,
      outcome: 'succeeded',
      summary: `${identity.childDefinitionId} done`,
      reportMarkdown: `${identity.childDefinitionId} readable report`,
      artifacts: [],
      checks: snapshot.outcomeContract.acceptanceCriteria.map((c) => ({
        id: c.id,
        outcome: 'passed' as const,
        evidence: [`${c.id} verified`]
      })),
      effects: [],
      blockers: [],
      ...overrides
    }
  }

  /** A worker that writes `drafts/<child>.md` and reports it with its real digest. */
  artifactReport(
    identity: CoordinatedWorkerIdentity,
    content: string,
    overrides: Partial<StructuredWorkerResult> = {}
  ): ScriptedWorkerAction[] {
    const uri = `drafts/${identity.childDefinitionId}.md`
    const sha256 = `sha256:${createHash('sha256').update(content).digest('hex')}`
    return [
      { type: 'write-artifact', uri, content },
      {
        type: 'report',
        result: this.report(identity, {
          artifacts: [{ kind: 'draft', uri, sha256 }],
          ...overrides
        })
      }
    ]
  }
}

export const LOCAL_STAGE_EFFECT: StageEffectRequirement = {
  kind: 'local-stage',
  allowedStatuses: ['verified']
}
