import { deepStrictEqual } from 'node:assert/strict'

export type HarnessEventIdentity = Readonly<{
  automationId?: string
  automationRunId?: string
  orchestrationRunId?: string
  childDefinitionId?: string
  taskId?: string
  dispatchId?: string
  effectId?: string
  artifactUri?: string
}>

export type HarnessEvent = Readonly<{
  sequence: number
  at: number
  type: string
  identity: HarnessEventIdentity
  detail: Readonly<Record<string, unknown>>
}>

export class DeterministicEventTrace {
  readonly #events: HarnessEvent[] = []

  record(
    at: number,
    type: string,
    identity: HarnessEventIdentity = {},
    detail: Readonly<Record<string, unknown>> = {}
  ): HarnessEvent {
    const event = Object.freeze({
      sequence: this.#events.length + 1,
      at,
      type,
      identity: Object.freeze({ ...identity }),
      detail: Object.freeze({ ...detail })
    })
    this.#events.push(event)
    return event
  }

  snapshot(): readonly HarnessEvent[] {
    return this.#events.map((event) => ({
      ...event,
      identity: { ...event.identity },
      detail: { ...event.detail }
    }))
  }

  assertExact(expected: readonly HarnessEvent[]): void {
    deepStrictEqual(this.snapshot(), expected)
  }
}

type ScheduledAction = {
  id: string
  label: string
  runAt: number
  insertionOrder: number
  action: () => void | Promise<void>
}

export class FakeClockScheduler {
  readonly #scheduled = new Map<string, ScheduledAction>()
  #nextActionId = 1
  #nextInsertionOrder = 1

  constructor(
    readonly trace: DeterministicEventTrace,
    private currentTime = 1_700_000_000_000
  ) {}

  now(): number {
    return this.currentTime
  }

  scheduleAt(label: string, runAt: number, action: () => void | Promise<void>): string {
    if (!Number.isSafeInteger(runAt) || runAt < this.currentTime) {
      throw new Error(
        `Scheduled time ${runAt} must be a safe integer at or after ${this.currentTime}`
      )
    }
    const id = `scheduled-${this.#nextActionId++}`
    this.#scheduled.set(id, {
      id,
      label,
      runAt,
      insertionOrder: this.#nextInsertionOrder++,
      action
    })
    this.trace.record(this.currentTime, 'scheduler.scheduled', {}, { id, label, runAt })
    return id
  }

  scheduleIn(label: string, delayMs: number, action: () => void | Promise<void>): string {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error(`Delay ${delayMs} must be a non-negative safe integer`)
    }
    return this.scheduleAt(label, this.currentTime + delayMs, action)
  }

  cancel(id: string): boolean {
    const action = this.#scheduled.get(id)
    if (!action) {
      return false
    }
    this.#scheduled.delete(id)
    this.trace.record(this.currentTime, 'scheduler.cancelled', {}, { id, label: action.label })
    return true
  }

  async advanceBy(deltaMs: number): Promise<void> {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new Error(`Advance ${deltaMs} must be a non-negative safe integer`)
    }
    await this.advanceTo(this.currentTime + deltaMs)
  }

  async advanceTo(targetTime: number): Promise<void> {
    if (!Number.isSafeInteger(targetTime) || targetTime < this.currentTime) {
      throw new Error(`Target ${targetTime} must be a safe integer at or after ${this.currentTime}`)
    }
    for (;;) {
      const next = this.#nextScheduled(targetTime)
      if (!next) {
        break
      }
      this.#scheduled.delete(next.id)
      this.currentTime = next.runAt
      this.trace.record(
        this.currentTime,
        'scheduler.started',
        {},
        {
          id: next.id,
          label: next.label
        }
      )
      await next.action()
      this.trace.record(
        this.currentTime,
        'scheduler.completed',
        {},
        {
          id: next.id,
          label: next.label
        }
      )
    }
    this.currentTime = targetTime
  }

  async runUntilIdle(): Promise<void> {
    while (this.#scheduled.size > 0) {
      const next = this.#nextScheduled(Number.MAX_SAFE_INTEGER)
      if (!next) {
        return
      }
      await this.advanceTo(next.runAt)
    }
  }

  pendingCount(): number {
    return this.#scheduled.size
  }

  #nextScheduled(atOrBefore: number): ScheduledAction | undefined {
    return [...this.#scheduled.values()]
      .filter((action) => action.runAt <= atOrBefore)
      .sort((left, right) =>
        left.runAt === right.runAt
          ? left.insertionOrder - right.insertionOrder
          : left.runAt - right.runAt
      )[0]
  }
}

export const HARNESS_CRASH_POINTS = [
  'automation-store.after-durable-write',
  'automation-store.before-acknowledgement',
  'orchestration-store.after-durable-write',
  'orchestration-store.before-acknowledgement',
  'artifact-store.after-durable-write',
  'artifact-store.before-acknowledgement',
  'worker-provider.before-acknowledgement',
  'effect-adapter.after-durable-write',
  'effect-adapter.before-acknowledgement'
] as const

export type HarnessCrashPoint = (typeof HARNESS_CRASH_POINTS)[number]

export class InjectedHarnessCrash extends Error {
  constructor(readonly point: HarnessCrashPoint) {
    super(`Injected harness crash at ${point}`)
    this.name = 'InjectedHarnessCrash'
  }
}

export class HarnessCrashInjector {
  #armedPoint: HarnessCrashPoint | null = null

  constructor(
    readonly clock: FakeClockScheduler,
    readonly trace: DeterministicEventTrace
  ) {}

  arm(point: HarnessCrashPoint): void {
    this.#armedPoint = point
    this.trace.record(this.clock.now(), 'crash.armed', {}, { point })
  }

  disarm(): void {
    this.#armedPoint = null
  }

  reach(point: HarnessCrashPoint, identity: HarnessEventIdentity = {}): void {
    this.trace.record(this.clock.now(), 'crash.boundary', identity, { point })
    if (this.#armedPoint !== point) {
      return
    }
    this.#armedPoint = null
    this.trace.record(this.clock.now(), 'crash.injected', identity, { point })
    throw new InjectedHarnessCrash(point)
  }
}
