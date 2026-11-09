import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  DeterministicEventTrace,
  FakeClockScheduler,
  HarnessCrashInjector
} from './event-time-crash'
import { FakeEffectAdapter, ScriptedFakeWorkerProvider } from './isolated-adapters'
import { TemporaryArtifactStore } from './temporary-artifact-store'
import { TemporaryAutomationStore, TemporaryOrchestrationStore } from './temporary-evidence-stores'

export const BLOCKED_HARNESS_CAPABILITIES = [
  'real-provider',
  'external-effect',
  'live-automation-store',
  'live-orchestration-store',
  'publisher',
  'system-schedule',
  'backup',
  'djvibe-production'
] as const

export class CoordinatedAutomationTestHarness {
  readonly trace: DeterministicEventTrace
  readonly clock: FakeClockScheduler
  readonly crashes: HarnessCrashInjector
  readonly automations: TemporaryAutomationStore
  readonly orchestration: TemporaryOrchestrationStore
  readonly artifacts: TemporaryArtifactStore
  readonly workers: ScriptedFakeWorkerProvider
  readonly effects: FakeEffectAdapter
  #disposed = false

  private constructor(
    readonly root: string,
    startAt: number,
    trace = new DeterministicEventTrace(),
    clock = new FakeClockScheduler(trace, startAt),
    crashes = new HarnessCrashInjector(clock, trace)
  ) {
    this.trace = trace
    this.clock = clock
    this.crashes = crashes
    const runtime = { root, clock, trace, crashes }
    this.automations = new TemporaryAutomationStore(runtime)
    this.orchestration = new TemporaryOrchestrationStore(runtime)
    this.artifacts = new TemporaryArtifactStore(runtime)
    this.workers = new ScriptedFakeWorkerProvider(clock, trace, crashes, this.artifacts)
    this.effects = new FakeEffectAdapter(root, clock, trace, crashes)
  }

  static async create(startAt = 1_700_000_000_000): Promise<CoordinatedAutomationTestHarness> {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-coordinated-harness-')))
    CoordinatedAutomationTestHarness.#assertTemporaryRoot(root)
    return new CoordinatedAutomationTestHarness(root, startAt)
  }

  reopen(): CoordinatedAutomationTestHarness {
    this.#assertActive()
    this.trace.record(this.clock.now(), 'harness.reopened')
    return new CoordinatedAutomationTestHarness(
      this.root,
      this.clock.now(),
      this.trace,
      this.clock,
      this.crashes
    )
  }

  isolationProof(): Readonly<{
    mode: 'test-only'
    root: string
    workerProvider: 'scripted-fake-worker-provider'
    effectAdapter: 'fake-effect-state-adapter'
    scheduler: 'in-process-fake-clock'
    blockedCapabilities: typeof BLOCKED_HARNESS_CAPABILITIES
  }> {
    this.#assertActive()
    CoordinatedAutomationTestHarness.#assertTemporaryRoot(this.root)
    return Object.freeze({
      mode: 'test-only',
      root: this.root,
      workerProvider: this.workers.kind,
      effectAdapter: this.effects.kind,
      scheduler: 'in-process-fake-clock',
      blockedCapabilities: BLOCKED_HARNESS_CAPABILITIES
    })
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return
    }
    this.#disposed = true
    await rm(this.root, { recursive: true, force: true })
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('Coordinated Automation test harness is disposed')
    }
  }

  static #assertTemporaryRoot(root: string): void {
    const temporaryRoot = resolve(tmpdir())
    const childPath = relative(temporaryRoot, resolve(root))
    if (!childPath || childPath === '..' || childPath.startsWith(`..${sep}`)) {
      throw new Error(
        `Harness root must be an isolated child of the system temp directory: ${root}`
      )
    }
  }
}
