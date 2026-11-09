import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../../shared/automations-types'
import { sha256Hex } from '../../../shared/coordinated-automation-canonical-digest'
import { pruneAutomationRuns } from '../../../shared/automation-run-retention'
import { AUTOMATION_OWNER_CONFLICT_CODES } from '../../../shared/automation-owner-conflict'
import { emptyCoordinatedAutomationLedger } from '../../../shared/coordinated-automation-ledger-schemas'
import { AutomationRunCompletionWatcher } from '../../automations/run-completion-watcher'
import { deleteAutomation } from './automation-definition-removal'
import {
  createCoordinatedAutomation,
  updateCoordinatedAutomation
} from './coordinated-automation-definition-operations'
import { createCoordinatedAutomationRun } from './coordinated-automation-run-operations'
import {
  linkCoordinatedOrchestrationRun,
  persistCoordinatedChildMappings,
  recordCoordinatedMaterializationFailure
} from './coordinated-automation-run-links'
import { archiveCoordinatedAutomation } from './coordinated-automation-archive'
import {
  coordinatedOccurrenceFingerprint,
  CoordinatedReplayHorizonError,
  ledgerWithOccurrence,
  lookupCoordinatedOccurrence
} from './coordinated-automation-occurrence-ledger'
import {
  child,
  coordinatedCreateInput,
  coordinatedRuns,
  coordinatedTestState,
  createRun,
  durableHarness,
  fakeOrchestration
} from './coordinated-automation-persistence.test-support'

type Harness = ReturnType<typeof durableHarness>

const WRITER_TEXT = 'Write the article from the accepted brief.'
const WRITER_DIGEST = `sha256:${sha256Hex(WRITER_TEXT)}`

function parent(harness: Harness, overrides = {}): Automation {
  return createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput(overrides))
}

function settle(harness: Harness, run: AutomationRun): void {
  recordCoordinatedMaterializationFailure(harness.runs(), {
    automationRunId: run.id,
    phase: 'materialization_failed',
    error: 'test settle'
  })
}

describe('coordinated parent archive', () => {
  it('refuses generic delete and archives only through the owner-fenced path', () => {
    const harness = durableHarness(coordinatedTestState())
    const orchestration = fakeOrchestration()
    const created = parent(harness)
    expect(() => deleteAutomation(harness.definitions(), created.id)).toThrow(/archive them/)

    const run = createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })
    orchestration.createRun('orun-1')
    linkCoordinatedOrchestrationRun(harness.runs(), {
      automationRunId: run.id,
      orchestrationRunId: 'orun-1',
      probe: orchestration
    })
    orchestration.createTask('orun-1', 't1')
    orchestration.createTask('orun-1', 't2')
    persistCoordinatedChildMappings(harness.runs(), {
      automationRunId: run.id,
      mappings: [
        { childDefinitionId: 'research', taskId: 't1' },
        { childDefinitionId: 'writer', taskId: 't2' }
      ],
      probe: orchestration
    })
    const archive = () => archiveCoordinatedAutomation(harness.runs(), { automationId: created.id })
    expect(archive).toThrow(/not settled/)

    settle(harness, run)
    const before = structuredClone(harness.state.automationRuns)
    const tombstone = archive()
    harness.restart()

    expect(harness.state.automations.some((a) => a.id === created.id)).toBe(false)
    expect(harness.state.automationRuns).toEqual(before)
    expect(harness.state.coordinatedAutomationLedger?.parentTombstones).toEqual([tombstone])
    expect(tombstone).toMatchObject({
      automationId: created.id,
      lastDefinitionRevision: 1,
      children: [
        { childDefinitionId: 'research', name: 'research worker', role: 'research-role' },
        { childDefinitionId: 'writer', name: 'writer worker', role: 'writer-role' }
      ]
    })
    expect(harness.state.coordinatedAutomationLedger?.occurrences).toHaveLength(1)
    expect(() => createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })).toThrow(
      /not found/
    )
  })

  it('requires the captured owner to archive an SSH-owned parent', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness, { projectId: 'repo-ssh' })
    expect(() =>
      archiveCoordinatedAutomation(harness.runs(), { automationId: created.id })
    ).toThrow(AUTOMATION_OWNER_CONFLICT_CODES.fencingRequired)
    expect(
      archiveCoordinatedAutomation(harness.runs(), {
        automationId: created.id,
        expectedOwner: { selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } }
      }).executionTarget
    ).toEqual({ type: 'ssh', id: 'ssh-1', generation: 7 })
  })
})

describe('source_reference prompt digests', () => {
  const sourced = (digest?: string) =>
    child('writer', {
      promptSource: { kind: 'source_reference', path: 'goals/writer.md', digest }
    })

  it('refuses an unpinned source prompt on create and update', () => {
    const harness = durableHarness(coordinatedTestState())
    expect(() => parent(harness, { children: [sourced()] })).toThrow(/pinned sha256/)
    const created = parent(harness)
    expect(() =>
      updateCoordinatedAutomation(harness.definitions(), created.id, { children: [sourced()] })
    ).toThrow(/pinned sha256/)
  })

  it('resolves one revision to one canonical snapshot and refuses drifted content', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness, { children: [sourced(WRITER_DIGEST)] })
    const resolver = vi.fn(() => ({ text: WRITER_TEXT }))
    const first = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1,
      promptResolver: resolver
    })
    const second = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 2,
      promptResolver: resolver
    })
    expect([first.automationDefinitionRevision, second.automationDefinitionRevision]).toEqual([
      1, 1
    ])
    expect(second.resolvedSnapshot!.canonicalDigest).toBe(first.resolvedSnapshot!.canonicalDigest)
    expect(() =>
      createRun(harness.runs(), {
        automationId: created.id,
        scheduledFor: 3,
        promptResolver: () => ({ text: 'edited on disk' })
      })
    ).toThrow(/digest mismatch/)
    expect(coordinatedRuns(harness.state, created)).toHaveLength(2)
  })

  it('fails closed if a revision would ever produce a second canonical digest', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })
    const ledger = harness.state.coordinatedAutomationLedger!
    harness.state.coordinatedAutomationLedger = {
      ...ledger,
      revisionDigests: { [`${created.id}:1`]: `sha256:${'0'.repeat(64)}` }
    }
    expect(() => createRun(harness.runs(), { automationId: created.id, scheduledFor: 2 })).toThrow(
      /already resolved/
    )
  })
})

describe('occurrence replay', () => {
  it('returns the original identity for duplicates and rejects conflicting keys', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    const input = { automationId: created.id, scheduledFor: 10, idempotencyKey: 'delivery-10' }
    const first = createCoordinatedAutomationRun(harness.runs(), input)
    expect(first.created).toBe(true)
    expect(first.occurrence.occurrenceFingerprint).toBe(
      coordinatedOccurrenceFingerprint({
        automationId: created.id,
        trigger: 'scheduled',
        scheduledFor: 10,
        executionAuthority: 'local:local'
      })
    )
    const replay = createCoordinatedAutomationRun(harness.runs(), input)
    expect(replay).toMatchObject({ created: false, occurrence: first.occurrence })
    expect(replay.run!.id).toBe(first.run!.id)
    expect(() =>
      createCoordinatedAutomationRun(harness.runs(), { ...input, idempotencyKey: 'other' })
    ).toThrow(/different idempotency key/)
    expect(() =>
      createCoordinatedAutomationRun(harness.runs(), { ...input, scheduledFor: 11 })
    ).toThrow(/different occurrence/)
    expect(coordinatedRuns(harness.state, created)).toHaveLength(1)
  })

  it('refuses the same occurrence under a different execution authority', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    createRun(harness.runs(), { automationId: created.id, scheduledFor: 10 })
    harness.state.automations = harness.state.automations.map((a) =>
      a.id === created.id ? { ...a, executionTargetId: 'local-moved' } : a
    )
    expect(() => createRun(harness.runs(), { automationId: created.id, scheduledFor: 10 })).toThrow(
      /recorded under authority local:local/
    )
  })

  it('replays the original identity after its run row was pruned', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    const first = createRun(harness.runs(), { automationId: created.id, scheduledFor: 10 })
    settle(harness, first)
    harness.state.automationRuns = pruneAutomationRuns(harness.state.automationRuns, 0, 0)
    harness.persist()
    harness.restart()
    expect(harness.state.automationRuns).toEqual([])

    const replay = createCoordinatedAutomationRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 10
    })
    expect(replay).toMatchObject({
      created: false,
      run: null,
      occurrence: { automationRunId: first.id }
    })
    expect(harness.state.automationRuns).toEqual([])
  })

  it('refuses unprovable deliveries at or before the replay horizon', () => {
    let ledger = emptyCoordinatedAutomationLedger()
    for (const scheduledFor of [10, 20, 30]) {
      ledger = ledgerWithOccurrence(
        ledger,
        {
          automationId: 'a1',
          occurrenceFingerprint: coordinatedOccurrenceFingerprint({
            automationId: 'a1',
            trigger: 'scheduled',
            scheduledFor,
            executionAuthority: 'local:local'
          }),
          idempotencyKey: `k${scheduledFor}`,
          trigger: 'scheduled',
          scheduledFor,
          executionAuthority: 'local:local',
          automationRunId: `run-${scheduledFor}`,
          definitionRevision: 1,
          canonicalDigest: `sha256:${'a'.repeat(64)}`,
          recordedAt: scheduledFor
        },
        2
      )
    }
    expect(ledger.replayHorizons).toEqual({ a1: 10 })
    const lookup = (scheduledFor: number) =>
      lookupCoordinatedOccurrence(ledger, {
        automationId: 'a1',
        trigger: 'scheduled',
        scheduledFor,
        executionAuthority: 'local:local'
      })
    expect(() => lookup(10)).toThrow(CoordinatedReplayHorizonError)
    expect(() => lookup(5)).toThrow(CoordinatedReplayHorizonError)
    expect(lookup(20)).toMatchObject({ kind: 'replay' })
    expect(lookup(25)).toMatchObject({ kind: 'new' })
  })

  it('refuses every coordinated run write while the ledger is unreadable', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    harness.state.coordinatedAutomationLedger = {
      ...emptyCoordinatedAutomationLedger(),
      unreadable: true
    }
    expect(() => createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })).toThrow(
      /unreadable/
    )
    expect(() =>
      archiveCoordinatedAutomation(harness.runs(), { automationId: created.id })
    ).toThrow(/unreadable/)
  })
})

describe('store-owned history', () => {
  it('keeps frozen private copies and hands callers detached values', () => {
    const harness = durableHarness(coordinatedTestState())
    const orchestration = fakeOrchestration()
    const created = parent(harness)
    const returned = createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })
    returned.resolvedSnapshot!.resolvedChildren[0].name = 'tampered'

    const stored = () => harness.state.automationRuns.find((r) => r.id === returned.id)!
    expect(stored().resolvedSnapshot!.resolvedChildren[0].name).toBe('research worker')
    expect(Object.isFrozen(stored().resolvedSnapshot!.resolvedChildren[0])).toBe(true)

    orchestration.createRun('orun-1')
    linkCoordinatedOrchestrationRun(harness.runs(), {
      automationRunId: returned.id,
      orchestrationRunId: 'orun-1',
      probe: orchestration
    })
    orchestration.createTask('orun-1', 't1')
    orchestration.createTask('orun-1', 't2')
    const mappings = [
      { childDefinitionId: 'research', taskId: 't1' },
      { childDefinitionId: 'writer', taskId: 't2' }
    ]
    const linked = persistCoordinatedChildMappings(harness.runs(), {
      automationRunId: returned.id,
      mappings,
      probe: orchestration
    })
    mappings[0].taskId = 'caller-edit'
    linked.childMappings![1].taskId = 'result-edit'
    expect(stored().childMappings).toEqual([
      { childDefinitionId: 'research', taskId: 't1', dispatchId: null },
      { childDefinitionId: 'writer', taskId: 't2', dispatchId: null }
    ])
    expect(Object.isFrozen(stored().childMappings)).toBe(true)

    const replay = createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })
    expect(Object.isFrozen(replay.resolvedSnapshot)).toBe(false)
    harness.restart()
    expect(stored().resolvedSnapshot!.resolvedChildren[0].name).toBe('research worker')
  })

  it('refuses a snapshot that fails the contract schema', () => {
    const harness = durableHarness(coordinatedTestState())
    const orchestration = fakeOrchestration()
    const created = parent(harness)
    const run = createRun(harness.runs(), { automationId: created.id, scheduledFor: 1 })
    harness.state.automationRuns = harness.state.automationRuns.map((r) =>
      r.id === run.id
        ? { ...r, resolvedSnapshot: { ...r.resolvedSnapshot!, canonicalDigest: 'x' } }
        : r
    )
    orchestration.createRun('orun-1')
    expect(() =>
      linkCoordinatedOrchestrationRun(harness.runs(), {
        automationRunId: run.id,
        orchestrationRunId: 'orun-1',
        probe: orchestration
      })
    ).toThrow(/canonicalDigest/)
  })
})

describe('retained-run recovery routing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('routes coordinated runs to the coordinated recovery hook and never strands them', async () => {
    vi.useFakeTimers()
    const harness = durableHarness(coordinatedTestState())
    const created = parent(harness)
    const coordinated = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1,
      trigger: 'manual'
    })
    const single = { ...coordinated, id: 'single-run', materializationPhase: undefined }
    const markDispatchResult = vi.fn(async () => {})
    const recoverCoordinatedRuns = vi.fn()
    const watcher = new AutomationRunCompletionWatcher({
      observer: {
        resolveRunTerminal: () => null,
        observeCompletion: () => new Promise(() => {})
      },
      readRun: (_automationId, runId) =>
        runId === single.id ? single : runId === coordinated.id ? coordinated : null,
      markDispatchResult,
      recoverCoordinatedRuns
    })
    watcher.reconcileRetainedRuns([coordinated, single])
    watcher.markTerminalSurfaceReady()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(recoverCoordinatedRuns).toHaveBeenCalledTimes(1)
    expect(recoverCoordinatedRuns).toHaveBeenCalledWith([coordinated])
    expect(markDispatchResult).toHaveBeenCalledTimes(1)
    expect(markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'single-run', status: 'dispatch_failed' })
    )
    watcher.dispose()
  })
})
