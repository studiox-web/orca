import { describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../../shared/automations-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { AUTOMATION_OWNER_CONFLICT_CODES } from '../../../shared/automation-owner-conflict'
import {
  MAX_QUARANTINED_PAYLOAD_BYTES,
  sealLoadedCoordinatedRun
} from '../../../shared/coordinated-automation-run-seal'
import { normalizeLoadedAutomationRuns } from '../loading-store/normalize-loaded-state-collections'
import { createCoordinatedAutomation } from './coordinated-automation-definition-operations'
import { createCoordinatedAutomationRun } from './coordinated-automation-run-operations'
import {
  linkCoordinatedOrchestrationRun,
  persistCoordinatedChildMappings
} from './coordinated-automation-run-links'
import { archiveCoordinatedAutomation } from './coordinated-automation-archive'
import { isCoordinatedRunDispatchable } from './coordinated-automation-run-records'
import {
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness,
  fakeOrchestration
} from './coordinated-automation-persistence.test-support'

type Harness = ReturnType<typeof durableHarness>

const owner = (targetGeneration: number) =>
  ({ selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration } }) as const

function reregisterSshTarget(harness: Harness, generation: number): void {
  harness.state.sshTargets = harness.state.sshTargets.map((t) =>
    t.id === 'ssh-1' ? { ...t, generation } : t
  )
  harness.state.automations = harness.state.automations.map((a) =>
    a.executionTargetId === 'ssh-1' ? { ...a, executionTargetGeneration: generation } : a
  )
}

describe('occurrence authority incarnation', () => {
  it('qualifies local authority by type and ID, and replays across restart', () => {
    const harness = durableHarness(coordinatedTestState())
    const parent = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
    const first = createCoordinatedAutomationRun(harness.runs(), {
      automationId: parent.id,
      scheduledFor: 100
    })
    expect(first.occurrence.executionAuthority).toBe('local:local')
    harness.restart()
    const replay = createCoordinatedAutomationRun(harness.runs(), {
      automationId: parent.id,
      scheduledFor: 100
    })
    expect(replay).toMatchObject({ created: false, occurrence: first.occurrence })
  })

  it('pins SSH occurrences to the target generation; a new incarnation conflicts, never replays', () => {
    const harness = durableHarness(coordinatedTestState(), 'runtime')
    const parent = createCoordinatedAutomation(
      harness.definitions(),
      coordinatedCreateInput({ projectId: 'repo-ssh' })
    )
    const create = (scheduledFor: number, generation: number) =>
      createCoordinatedAutomationRun(harness.runs(), {
        automationId: parent.id,
        scheduledFor,
        expectedOwner: owner(generation)
      })
    const first = create(100, 7)
    expect(first.occurrence.executionAuthority).toBe('ssh:ssh-1#7')

    harness.restart()
    expect(create(100, 7)).toMatchObject({ created: false, occurrence: first.occurrence })

    reregisterSshTarget(harness, 8)
    expect(() => create(100, 7)).toThrow(AUTOMATION_OWNER_CONFLICT_CODES.ownerChanged)
    expect(() => create(100, 8)).toThrow(/recorded under authority ssh:ssh-1#7, not ssh:ssh-1#8/)
    const next = create(200, 8)
    expect(next).toMatchObject({
      created: true,
      occurrence: { executionAuthority: 'ssh:ssh-1#8', definitionRevision: 2 }
    })
    expect(next.occurrence.occurrenceFingerprint).not.toBe(first.occurrence.occurrenceFingerprint)

    harness.restart()
    expect(create(200, 8)).toMatchObject({ created: false, occurrence: next.occurrence })
    expect(harness.state.automationRuns).toHaveLength(2)
  })
})

/** Reload a stored profile's runs through the real loader normalization. */
function reload(runs: AutomationRun[]): AutomationRun[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: run normalization reads only automationRuns.
  const parsed = { automationRuns: JSON.parse(JSON.stringify(runs)) } as PersistedState
  return normalizeLoadedAutomationRuns(parsed, () => {})
}

function linkedRun(harness: Harness): AutomationRun {
  const orchestration = fakeOrchestration()
  const parent = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
  const run = createCoordinatedAutomationRun(harness.runs(), {
    automationId: parent.id,
    scheduledFor: 1
  }).run!
  orchestration.createRun('orun-1')
  linkCoordinatedOrchestrationRun(harness.runs(), {
    automationRunId: run.id,
    orchestrationRunId: 'orun-1',
    probe: orchestration
  })
  orchestration.createTask('orun-1', 't1')
  orchestration.createTask('orun-1', 't2')
  return persistCoordinatedChildMappings(harness.runs(), {
    automationRunId: run.id,
    mappings: [
      { childDefinitionId: 'research', taskId: 't1' },
      { childDefinitionId: 'writer', taskId: 't2' }
    ],
    probe: orchestration
  })
}

describe('validated reload', () => {
  it('seals a valid coordinated row exactly like a fresh write', () => {
    const harness = durableHarness(coordinatedTestState())
    const run = linkedRun(harness)
    const [reloaded] = reload(harness.state.automationRuns)
    expect(reloaded).toEqual(harness.state.automationRuns[0])
    expect(reloaded.coordinatedQuarantine).toBeUndefined()
    expect(Object.isFrozen(reloaded.resolvedSnapshot)).toBe(true)
    expect(Object.isFrozen(reloaded.childMappings)).toBe(true)
    expect(reloaded.id).toBe(run.id)
  })

  it.each([
    [
      'a snapshot edited after its digest was computed',
      (run: AutomationRun) => {
        run.resolvedSnapshot!.resolvedChildren[0].name = 'tampered'
      },
      /does not match its canonical digest/
    ],
    [
      'a mapping that fails the contract schema',
      (run: AutomationRun) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deliberately malformed stored JSON.
        ;(run.childMappings![0] as unknown as { taskId: number }).taskId = 42
      },
      /contract schema: childMappings/
    ],
    [
      'a mapping to a child the snapshot does not have',
      (run: AutomationRun) => {
        run.childMappings![0].childDefinitionId = 'ghost'
      },
      /not an enabled child/
    ],
    [
      'a snapshot from another automation',
      (run: AutomationRun) => {
        run.resolvedSnapshot!.automationId = 'someone-else'
      },
      /different automation or revision/
    ],
    [
      'links recorded before the orchestration Run existed',
      (run: AutomationRun) => {
        run.materializationPhase = 'intent_persisted'
      },
      /before its orchestration Run/
    ]
  ])('quarantines %s and keeps it inert', (_label, corrupt, reason) => {
    const harness = durableHarness(coordinatedTestState())
    const valid = linkedRun(harness)
    const stored = structuredClone(harness.state.automationRuns)
    corrupt(stored[0])
    const [quarantined] = reload(stored)

    expect(quarantined.coordinatedQuarantine?.reason).toMatch(reason)
    expect(quarantined).toMatchObject({
      id: valid.id,
      resolvedSnapshot: null,
      childMappings: [],
      orchestrationRunId: null,
      materializationPhase: 'materialization_failed'
    })
    expect(JSON.parse(quarantined.coordinatedQuarantine!.payload!)).toMatchObject({
      materializationPhase: stored[0].materializationPhase
    })
    expect(isCoordinatedRunDispatchable(quarantined)).toBe(false)
    // Idempotent: reloading a quarantined row keeps it as is.
    expect(reload([quarantined])).toEqual([quarantined])

    harness.state.automationRuns = [quarantined]
    expect(() =>
      persistCoordinatedChildMappings(harness.runs(), {
        automationRunId: valid.id,
        mappings: [],
        probe: fakeOrchestration()
      })
    ).toThrow(/quarantined/)
    // Still pending, so the parent cannot be archived away from the damaged row.
    expect(() =>
      archiveCoordinatedAutomation(harness.runs(), { automationId: valid.automationId })
    ).toThrow(/not settled/)
  })

  it('bounds the kept payload and always keeps its digest', () => {
    const harness = durableHarness(coordinatedTestState())
    const stored = structuredClone(linkedRun(harness))
    stored.resolvedSnapshot!.resolvedChildren[0].name = 'x'.repeat(MAX_QUARANTINED_PAYLOAD_BYTES)
    const quarantined = sealLoadedCoordinatedRun(stored)
    expect(quarantined.coordinatedQuarantine).toMatchObject({
      payload: null,
      payloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    })
    expect(quarantined.coordinatedQuarantine!.reason.length).toBeLessThanOrEqual(512)
  })

  it('leaves single runs untouched on reload', () => {
    const single = {
      id: 's1',
      automationId: 'a1',
      runNumber: 1,
      status: 'completed',
      createdAt: 1,
      scheduledFor: 1
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a minimal legacy row; the loader only backfills and prunes it.
    expect(reload([single as AutomationRun])).toEqual([single])
  })
})
