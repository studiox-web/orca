import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StructuredWorkerResultSchema } from '../../../src/shared/coordinated-automation-receipt-schemas'
import type { StructuredWorkerResult } from '../../../src/shared/coordinated-automation-receipt-types'
import type {
  DeterministicEventTrace,
  FakeClockScheduler,
  HarnessCrashInjector,
  HarnessEventIdentity
} from './event-time-crash'

export type TemporaryAutomationRecord = Readonly<{
  automationId: string
  automationRunId: string
  definitionRevision: number
  resolvedConfigDigest: string
  state: string
  evidence?: Readonly<Record<string, unknown>>
}>

export type TemporaryOrchestrationRunRecord = Readonly<{
  orchestrationRunId: string
  automationRunId: string
  state: string
}>

export type TemporaryOrchestrationTaskRecord = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  childDefinitionId: string
  taskId: string
  dispatchId?: string
  state: string
}>

type AutomationDocument = {
  records: Record<string, TemporaryAutomationRecord>
}

type OrchestrationDocument = {
  runs: Record<string, TemporaryOrchestrationRunRecord>
  tasks: Record<string, TemporaryOrchestrationTaskRecord>
  reports: Record<string, StructuredWorkerResult>
}

export type StoreRuntime = {
  root: string
  clock: FakeClockScheduler
  trace: DeterministicEventTrace
  crashes: HarnessCrashInjector
}

async function readDocument<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) {
      return fallback
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function replaceDocument(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const nextPath = `${path}.next`
  await writeFile(nextPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(nextPath, path)
}

function identityFromAutomation(record: TemporaryAutomationRecord): HarnessEventIdentity {
  return {
    automationId: record.automationId,
    automationRunId: record.automationRunId
  }
}

export class TemporaryAutomationStore {
  readonly #path: string

  constructor(readonly runtime: StoreRuntime) {
    this.#path = join(runtime.root, 'stores', 'automations.json')
  }

  async put(record: TemporaryAutomationRecord): Promise<void> {
    const document = await readDocument<AutomationDocument>(this.#path, { records: {} })
    document.records[record.automationRunId] = structuredClone(record)
    await replaceDocument(this.#path, document)
    const identity = identityFromAutomation(record)
    this.runtime.trace.record(this.runtime.clock.now(), 'automation-store.written', identity)
    this.runtime.crashes.reach('automation-store.after-durable-write', identity)
    this.runtime.crashes.reach('automation-store.before-acknowledgement', identity)
    this.runtime.trace.record(this.runtime.clock.now(), 'automation-store.acknowledged', identity)
  }

  async get(automationRunId: string): Promise<TemporaryAutomationRecord | undefined> {
    const document = await readDocument<AutomationDocument>(this.#path, { records: {} })
    const record = document.records[automationRunId]
    return record ? structuredClone(record) : undefined
  }

  async list(): Promise<readonly TemporaryAutomationRecord[]> {
    const document = await readDocument<AutomationDocument>(this.#path, { records: {} })
    return Object.values(document.records)
      .sort((left, right) => left.automationRunId.localeCompare(right.automationRunId))
      .map((record) => structuredClone(record))
  }
}

export class TemporaryOrchestrationStore {
  readonly #path: string

  constructor(readonly runtime: StoreRuntime) {
    this.#path = join(runtime.root, 'stores', 'orchestration.json')
  }

  async putRun(record: TemporaryOrchestrationRunRecord): Promise<void> {
    await this.#update(
      { orchestrationRunId: record.orchestrationRunId, automationRunId: record.automationRunId },
      (document) => {
        document.runs[record.orchestrationRunId] = structuredClone(record)
      }
    )
  }

  async putTask(record: TemporaryOrchestrationTaskRecord): Promise<void> {
    await this.#update(
      {
        automationRunId: record.automationRunId,
        orchestrationRunId: record.orchestrationRunId,
        childDefinitionId: record.childDefinitionId,
        taskId: record.taskId,
        dispatchId: record.dispatchId
      },
      (document) => {
        document.tasks[record.taskId] = structuredClone(record)
      }
    )
  }

  async putReport(report: StructuredWorkerResult): Promise<void> {
    const parsed = StructuredWorkerResultSchema.parse(report)
    await this.#update(
      {
        automationRunId: parsed.automationRunId,
        orchestrationRunId: parsed.orchestrationRunId,
        childDefinitionId: parsed.childDefinitionId,
        taskId: parsed.taskId,
        dispatchId: parsed.dispatchId
      },
      (document) => {
        document.reports[parsed.dispatchId] = structuredClone(parsed)
      }
    )
  }

  async read(): Promise<OrchestrationDocument> {
    return structuredClone(await this.#document())
  }

  async #document(): Promise<OrchestrationDocument> {
    return readDocument<OrchestrationDocument>(this.#path, { runs: {}, tasks: {}, reports: {} })
  }

  async #update(
    identity: HarnessEventIdentity,
    mutate: (document: OrchestrationDocument) => void
  ): Promise<void> {
    const document = await this.#document()
    mutate(document)
    await replaceDocument(this.#path, document)
    this.runtime.trace.record(this.runtime.clock.now(), 'orchestration-store.written', identity)
    this.runtime.crashes.reach('orchestration-store.after-durable-write', identity)
    this.runtime.crashes.reach('orchestration-store.before-acknowledgement', identity)
    this.runtime.trace.record(
      this.runtime.clock.now(),
      'orchestration-store.acknowledged',
      identity
    )
  }
}
