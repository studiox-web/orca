import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StructuredWorkerResultSchema } from '../../../src/shared/coordinated-automation-receipt-schemas'
import type {
  StructuredWorkerEffect,
  StructuredWorkerResult
} from '../../../src/shared/coordinated-automation-receipt-types'
import type {
  DeterministicEventTrace,
  FakeClockScheduler,
  HarnessCrashInjector,
  HarnessEventIdentity
} from './event-time-crash'
import type { TemporaryArtifactStore } from './temporary-artifact-store'

export type ScriptedWorkerIdentity = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId: string
}>

export type ScriptedWorkerAction =
  | Readonly<{ type: 'write-artifact'; uri: string; content: string }>
  | Readonly<{ type: 'report'; result: StructuredWorkerResult }>
  | Readonly<{ type: 'exit'; code: number }>

export type ScriptedWorkerInvocation = Readonly<{
  identity: ScriptedWorkerIdentity
  actions: readonly ScriptedWorkerAction[]
}>

export class ScriptedWorkerExit extends Error {
  constructor(readonly code: number) {
    super(`Scripted fake worker exited with code ${code}`)
    this.name = 'ScriptedWorkerExit'
  }
}

export class ScriptedFakeWorkerProvider {
  readonly kind = 'scripted-fake-worker-provider'
  readonly #scripts = new Map<string, ScriptedWorkerInvocation>()

  constructor(
    readonly clock: FakeClockScheduler,
    readonly trace: DeterministicEventTrace,
    readonly crashes: HarnessCrashInjector,
    readonly artifacts: TemporaryArtifactStore
  ) {}

  script(invocation: ScriptedWorkerInvocation): void {
    this.#scripts.set(invocation.identity.dispatchId, structuredClone(invocation))
  }

  async run(identity: ScriptedWorkerIdentity): Promise<StructuredWorkerResult> {
    const invocation = this.#scripts.get(identity.dispatchId)
    if (!invocation) {
      throw new Error(`No fake worker script for ${identity.dispatchId}`)
    }
    if (JSON.stringify(invocation.identity) !== JSON.stringify(identity)) {
      throw new Error(`Fake worker identity mismatch for ${identity.dispatchId}`)
    }
    this.trace.record(this.clock.now(), 'worker-provider.started', identity)
    let report: StructuredWorkerResult | undefined
    for (const action of invocation.actions) {
      if (action.type === 'write-artifact') {
        await this.artifacts.write(action.uri, action.content)
        continue
      }
      if (action.type === 'exit') {
        this.trace.record(this.clock.now(), 'worker-provider.exited', identity, {
          code: action.code
        })
        throw new ScriptedWorkerExit(action.code)
      }
      report = StructuredWorkerResultSchema.parse(action.result)
      this.#assertReportIdentity(identity, report)
      this.trace.record(this.clock.now(), 'worker-provider.reported', identity, {
        outcome: report.outcome
      })
    }
    if (!report) {
      throw new Error(`Fake worker ${identity.dispatchId} produced no report`)
    }
    this.crashes.reach('worker-provider.before-acknowledgement', identity)
    this.trace.record(this.clock.now(), 'worker-provider.acknowledged', identity)
    return structuredClone(report)
  }

  #assertReportIdentity(identity: ScriptedWorkerIdentity, report: StructuredWorkerResult): void {
    for (const key of [
      'automationRunId',
      'orchestrationRunId',
      'childDefinitionId',
      'taskId',
      'dispatchId'
    ] as const) {
      if (identity[key] !== report[key]) {
        throw new Error(`Fake worker report ${key} did not match its scripted invocation`)
      }
    }
  }
}

export type FakeEffectState = StructuredWorkerEffect['status']

type EffectRecord = {
  effectId: string
  kind: string
  state: FakeEffectState
  receipt?: string
  applyCount: number
  queryCount: number
  scriptedStates: FakeEffectState[]
}

type EffectDocument = {
  records: Record<string, EffectRecord>
}

export class FakeEffectAdapter {
  readonly kind = 'fake-effect-state-adapter'
  readonly #path: string

  constructor(
    readonly root: string,
    readonly clock: FakeClockScheduler,
    readonly trace: DeterministicEventTrace,
    readonly crashes: HarnessCrashInjector
  ) {
    this.#path = join(root, 'stores', 'effects.json')
  }

  async seed(
    effectId: string,
    kind: string,
    state: FakeEffectState = 'not_started',
    receipt?: string
  ): Promise<void> {
    const document = await this.#read()
    document.records[effectId] = {
      effectId,
      kind,
      state,
      receipt,
      applyCount: 0,
      queryCount: 0,
      scriptedStates: []
    }
    await this.#write(document, effectId)
    this.#acknowledge(effectId, 'effect-adapter.seed-acknowledged', state)
  }

  async script(effectId: string, states: readonly FakeEffectState[]): Promise<void> {
    const document = await this.#read()
    const record = this.#record(document, effectId)
    record.scriptedStates = [...states]
    await this.#write(document, effectId)
    this.#acknowledge(effectId, 'effect-adapter.script-acknowledged', record.state)
  }

  async apply(effectId: string): Promise<Readonly<EffectRecord>> {
    const document = await this.#read()
    const record = this.#record(document, effectId)
    record.applyCount += 1
    record.state = record.scriptedStates.shift() ?? record.state
    if (record.state === 'applied' || record.state === 'verified') {
      record.receipt ??= `fake-receipt:${effectId}:${record.applyCount}`
    }
    await this.#write(document, effectId)
    this.#acknowledge(effectId, 'effect-adapter.acknowledged', record.state)
    return structuredClone(record)
  }

  async query(effectId: string): Promise<Readonly<EffectRecord>> {
    const document = await this.#read()
    const record = this.#record(document, effectId)
    record.queryCount += 1
    await this.#write(document, effectId)
    this.crashes.reach('effect-adapter.before-acknowledgement', { effectId })
    this.trace.record(
      this.clock.now(),
      'effect-adapter.queried',
      { effectId },
      {
        state: record.state
      }
    )
    return structuredClone(record)
  }

  async #read(): Promise<EffectDocument> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { records: {} }
      }
      throw error
    }
  }

  async #write(document: EffectDocument, effectId: string): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true })
    const nextPath = `${this.#path}.next`
    await writeFile(nextPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(nextPath, this.#path)
    this.trace.record(this.clock.now(), 'effect-adapter.written', { effectId })
    this.crashes.reach('effect-adapter.after-durable-write', { effectId })
  }

  #acknowledge(effectId: string, type: string, state: FakeEffectState): void {
    this.crashes.reach('effect-adapter.before-acknowledgement', { effectId })
    this.trace.record(this.clock.now(), type, { effectId }, { state })
  }

  #record(document: EffectDocument, effectId: string): EffectRecord {
    const record = document.records[effectId]
    if (!record) {
      throw new Error(`Unknown fake effect ${effectId}`)
    }
    return record
  }
}

export function workerIdentityEvent(identity: ScriptedWorkerIdentity): HarnessEventIdentity {
  return identity
}
