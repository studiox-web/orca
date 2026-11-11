import type { RuntimeTerminalWait } from '../../shared/runtime-terminal-contracts'
import {
  isDispatchedNativeStubLaunch,
  type PreparedNativeStubLaunch
} from './native-stub-session-test-host'

/**
 * The pinned golden stub is not a Codex process: it cannot draw Codex's composer, hold Codex's
 * foreground, or fire Codex's turn hooks. Its whole observable protocol is three markers on its
 * own PTY. This module is the only readiness a host-admitted stub launch may claim, and it reads
 * those markers from the exact PTY incarnation the permit spawned — never from a handle, a
 * caller, or a serialized option. Ordinary agents never reach it.
 */
export const NATIVE_STUB_READY_MARKER = '[GOLDEN_STUB_AGENT_READY]'
export const NATIVE_STUB_SUBMITTED_MARKER = '[GOLDEN_STUB_AGENT_SUBMITTED] '
export const NATIVE_STUB_EXIT_MARKER = '[GOLDEN_STUB_AGENT_EXITED]'

const MARKERS = [NATIVE_STUB_READY_MARKER, NATIVE_STUB_SUBMITTED_MARKER, NATIVE_STUB_EXIT_MARKER]
const CARRY_CHARS = Math.max(...MARKERS.map((marker) => marker.length)) - 1

type FixtureDataSource = {
  subscribeToTerminalData: (ptyId: string, listener: (data: string) => void) => () => void
}

type Observation = {
  ptyId: string
  incarnationId: string
  ready: boolean
  submitted: boolean
  exited: boolean
  writeBegun: boolean
  carry: string
  changed: Set<() => void>
  unsubscribe: () => void
}

const observations = new WeakMap<PreparedNativeStubLaunch, Observation>()

/** Starts at physical spawn, before the stub's first render can arrive; one observation per permit. */
export function beginNativeStubFixtureObservation(
  permit: PreparedNativeStubLaunch,
  source: FixtureDataSource,
  physical: { ptyId: string; incarnationId: string }
): void {
  if (!isDispatchedNativeStubLaunch(permit) || observations.has(permit)) {
    throw new Error('native_stub_fixture_observation_refused')
  }
  const observation: Observation = {
    ptyId: physical.ptyId,
    incarnationId: physical.incarnationId,
    ready: false,
    submitted: false,
    exited: false,
    writeBegun: false,
    carry: '',
    changed: new Set(),
    unsubscribe: () => {}
  }
  observations.set(permit, observation)
  observation.unsubscribe = source.subscribeToTerminalData(physical.ptyId, (data) => {
    const window = observation.carry + data
    observation.carry = window.slice(-CARRY_CHARS)
    const before = `${observation.ready}${observation.submitted}${observation.exited}`
    observation.ready ||= window.includes(NATIVE_STUB_READY_MARKER)
    // A submission seen before this launch wrote anything is not this launch's turn.
    observation.submitted ||=
      observation.writeBegun && window.includes(NATIVE_STUB_SUBMITTED_MARKER)
    observation.exited ||= window.includes(NATIVE_STUB_EXIT_MARKER)
    if (before !== `${observation.ready}${observation.submitted}${observation.exited}`) {
      for (const notify of observation.changed) {
        notify()
      }
    }
  })
}

export function endNativeStubFixtureObservation(permit: PreparedNativeStubLaunch): void {
  observations.get(permit)?.unsubscribe()
}

function requireObservation(permit: PreparedNativeStubLaunch, ptyId?: string): Observation {
  const observation = observations.get(permit)
  if (!observation || (ptyId !== undefined && observation.ptyId !== ptyId)) {
    throw new Error('native_stub_fixture_unobserved')
  }
  return observation
}

function waitFor(
  observation: Observation,
  settled: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  if (settled()) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const finish = (value: boolean): void => {
      clearTimeout(timer)
      observation.changed.delete(check)
      resolve(value)
    }
    const check = (): void => {
      if (settled()) {
        finish(true)
      }
    }
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
    observation.changed.add(check)
  })
}

/** Readiness of the stub itself: its READY marker on the permit's own PTY, and no exit. */
export async function waitForNativeStubFixtureReady(
  permit: PreparedNativeStubLaunch,
  input: { handle: string; ptyId: string | null | undefined; timeoutMs: number }
): Promise<RuntimeTerminalWait> {
  const observation = requireObservation(permit, input.ptyId ?? undefined)
  await waitFor(observation, () => observation.ready || observation.exited, input.timeoutMs)
  return {
    handle: input.handle,
    condition: 'tui-idle',
    satisfied: observation.ready && !observation.exited,
    status: observation.exited ? 'exited' : 'running',
    exitCode: null
  }
}

/** The prompt-write guard for the stub: its own ready, live process — never a Codex foreground. */
export function assertNativeStubFixtureWritable(
  permit: PreparedNativeStubLaunch,
  ptyId: string
): void {
  const observation = requireObservation(permit, ptyId)
  if (!observation.ready || observation.exited) {
    throw new Error('native_stub_fixture_not_ready')
  }
  observation.writeBegun = true
}

/** Turn-start evidence: the stub echoed a submission after this launch began writing. */
export async function waitForNativeStubFixtureSubmission(
  permit: PreparedNativeStubLaunch,
  timeoutMs: number
): Promise<boolean> {
  const observation = requireObservation(permit)
  await waitFor(observation, () => observation.submitted || observation.exited, timeoutMs)
  return observation.submitted && !observation.exited
}
