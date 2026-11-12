import { describe, expect, it } from 'vitest'
import { CoordinatedAutomationCreateRequest } from '../../../shared/rpc-contract/coordinated-automation-params'
import { computeSnapshotCanonicalDigest } from '../../../shared/coordinated-automation-snapshot'
import {
  createCoordinatedAutomation,
  updateCoordinatedAutomation
} from './coordinated-automation-definition-operations'
import { createCoordinatedAutomationRun } from './coordinated-automation-run-operations'
import { listAutomations, updateAutomation } from './automation-definition-operations'
import {
  advanceAutomationNextRun,
  getLatestAutomationOccurrence
} from './automation-schedule-operations'
import {
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness
} from './coordinated-automation-persistence.test-support'

function manualInput() {
  const { rrule: _rrule, dtstart: _dtstart, ...input } = coordinatedCreateInput()
  return { ...input, triggerPolicy: 'manual_only' as const }
}

describe('manual-only coordinated definitions', () => {
  it('admits absent schedule on the wire and refuses recurrence, enabling and implicit manual mode', () => {
    const { projectId: _projectId, ...input } = manualInput()
    const request = { ...input, destination: { selector: { kind: 'self' } } }
    expect(CoordinatedAutomationCreateRequest.parse(request)).not.toHaveProperty('rrule')
    for (const patch of [
      { rrule: 'FREQ=DAILY' },
      { dtstart: 0 },
      { enabled: true },
      { triggerPolicy: undefined }
    ]) {
      expect(CoordinatedAutomationCreateRequest.safeParse({ ...request, ...patch }).success).toBe(
        false
      )
    }
  })

  it('retains no recurrence across restart, refuses scheduler mutation and freezes exact manual run identity', () => {
    const harness = durableHarness(coordinatedTestState())
    const definition = createCoordinatedAutomation(harness.definitions(), manualInput())
    expect(definition).toMatchObject({
      triggerPolicy: 'manual_only',
      enabled: false,
      rrule: '',
      dtstart: 0,
      nextRunAt: 0
    })
    expect(getLatestAutomationOccurrence(definition, 100)).toBeNull()
    const writes = harness.writes
    expect(() =>
      advanceAutomationNextRun(harness.state, () => harness.persist(), definition.id)
    ).toThrow(/no schedule/)
    expect(() =>
      createCoordinatedAutomationRun(harness.runs(), {
        automationId: definition.id,
        scheduledFor: 100
      })
    ).toThrow(/scheduled runs/)
    for (const updates of [{ enabled: true }, { rrule: 'FREQ=DAILY' }, { dtstart: 100 }]) {
      expect(() => updateAutomation(harness.definitions(), definition.id, updates)).toThrow(
        /scheduled or enabled/
      )
      expect(() =>
        updateCoordinatedAutomation(harness.definitions(), definition.id, updates)
      ).toThrow(/scheduled or enabled/)
    }
    expect(harness.writes).toBe(writes)
    const updated = updateCoordinatedAutomation(harness.definitions(), definition.id, {
      name: 'Reviewed draft',
      expectedDefinitionRevision: 1
    })
    expect(updated.triggerPolicy).toBe('manual_only')
    harness.restart()
    expect(listAutomations(harness.state).find((entry) => entry.id === definition.id)).toEqual(
      updated
    )
    const request = {
      automationId: definition.id,
      trigger: 'manual' as const,
      scheduledFor: 100,
      idempotencyKey: 'one-article',
      expectedOwner: { selector: { kind: 'self' as const } },
      expectedDefinitionRevision: 1
    }
    const first = createCoordinatedAutomationRun(harness.runs(), request)
    expect(first.run!.resolvedSnapshot!.triggerPolicy).toBe('manual_only')
    expect(computeSnapshotCanonicalDigest(first.run!.resolvedSnapshot!)).toBe(
      first.run!.resolvedSnapshot!.canonicalDigest
    )
    harness.restart()
    expect(createCoordinatedAutomationRun(harness.runs(), request)).toMatchObject({
      created: false,
      occurrence: first.occurrence,
      run: first.run
    })
    expect(harness.state.automationRuns).toHaveLength(1)
  })

  it('does not migrate or change an existing scheduled coordinated definition', () => {
    const harness = durableHarness(coordinatedTestState())
    const scheduled = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
    const before = structuredClone(scheduled)
    createCoordinatedAutomation(harness.definitions(), manualInput())
    harness.restart()
    expect(listAutomations(harness.state).find((entry) => entry.id === scheduled.id)).toEqual(
      before
    )
    expect(scheduled).not.toHaveProperty('triggerPolicy')
    expect(getLatestAutomationOccurrence(scheduled, scheduled.dtstart + 86_400_000)).not.toBeNull()
  })
})
