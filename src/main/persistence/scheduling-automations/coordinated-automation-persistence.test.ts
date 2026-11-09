import { describe, expect, it } from 'vitest'
import type { Automation, AutomationUpdateInput } from '../../../shared/automations-types'
import type { AutomationOwnerPrecondition } from '../../../shared/automation-owner-precondition'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { AUTOMATION_OWNER_CONFLICT_CODES } from '../../../shared/automation-owner-conflict'
import { createAutomation, updateAutomation } from './automation-definition-operations'
import { createAutomationRun, updateAutomationRun } from './automation-run-operations'
import {
  createCoordinatedAutomation,
  updateCoordinatedAutomation
} from './coordinated-automation-definition-operations'
import {
  linkCoordinatedOrchestrationRun,
  markCoordinatedRunReadyForDispatch,
  persistCoordinatedChildMappings,
  recordCoordinatedMaterializationFailure
} from './coordinated-automation-run-links'
import { isCoordinatedRunDispatchable } from './coordinated-automation-run-records'
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

function createParent(harness: Harness, overrides = {}): Automation {
  return createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput(overrides))
}

/** Drive the materialization saga; each step is one durable write. */
function materialize(
  harness: Harness,
  orchestration: ReturnType<typeof fakeOrchestration>,
  automation: Automation,
  scheduledFor: number
) {
  const run = createRun(harness.runs(), {
    automationId: automation.id,
    scheduledFor
  })
  const orchestrationRunId = `orun-${run.id}`
  orchestration.createRun(orchestrationRunId)
  linkCoordinatedOrchestrationRun(harness.runs(), {
    automationRunId: run.id,
    orchestrationRunId,
    probe: orchestration
  })
  const mappings = run.resolvedSnapshot!.resolvedChildren.map((resolved) => ({
    childDefinitionId: resolved.childDefinitionId,
    taskId: `task-${run.id}-${resolved.childDefinitionId}`
  }))
  for (const mapping of mappings) {
    orchestration.createTask(orchestrationRunId, mapping.taskId)
  }
  persistCoordinatedChildMappings(harness.runs(), {
    automationRunId: run.id,
    mappings,
    probe: orchestration
  })
  return markCoordinatedRunReadyForDispatch(harness.runs(), {
    automationRunId: run.id,
    probe: orchestration
  })
}

describe('coordinated definitions', () => {
  it('stores a validated revision 1 definition that stays disabled', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    expect(created).toMatchObject({ kind: 'coordinated', definitionRevision: 1, enabled: false })
    expect(created.definitionFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(() => createParent(harness, { enabled: true })).toThrow(/stay disabled/)
    expect(() => updateAutomation(harness.definitions(), created.id, { enabled: true })).toThrow(
      /stay disabled/
    )
    expect(() =>
      createParent(harness, {
        children: [child('a', { dependencies: [{ childId: 'missing' }] })]
      })
    ).toThrow(/invalid/)
  })

  it('opens a new revision only when a resolution input changes', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const renamed = updateAutomation(harness.definitions(), created.id, { name: 'Renamed' })
    expect(renamed.definitionRevision).toBe(1)

    const inherited = updateAutomation(harness.definitions(), created.id, { agentId: 'codex' })
    expect(inherited.definitionRevision).toBe(2)

    const edited = updateCoordinatedAutomation(harness.definitions(), created.id, {
      expectedDefinitionRevision: 2,
      children: [child('research', { name: 'Researcher v2' }), child('writer')]
    })
    expect(edited.definitionRevision).toBe(3)
    expect(() =>
      updateCoordinatedAutomation(harness.definitions(), created.id, {
        expectedDefinitionRevision: 2,
        children: [child('research')]
      })
    ).toThrow(/expected 2, stored 3/)
  })

  it('keeps generic writes from creating, flipping, or editing coordinated state', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const ops = harness.definitions()
    const single = coordinatedCreateInput()
    expect(() => createAutomation(ops, single)).toThrow(/coordinated definition path/)
    const toCoordinated: AutomationUpdateInput & { kind: 'coordinated' } = { kind: 'coordinated' }
    const childEdit: AutomationUpdateInput & { children: [] } = { children: [] }
    const toSingle: AutomationUpdateInput & { kind: 'single' } = { kind: 'single' }
    expect(() => updateAutomation(ops, created.id, toCoordinated)).toThrow(
      /coordinated definition path/
    )
    expect(() => updateAutomation(ops, created.id, childEdit)).toThrow(
      /coordinated field "children"/
    )
    const flipped = updateAutomation(ops, created.id, toSingle)
    expect(flipped.kind).toBe('coordinated')
    const { kind: _kind, outcomeContract: _contract, children: _children, ...base } = single
    const creationKeyClash = createAutomation(harness.definitions(), { ...base, creationKey: 'k1' })
    expect(() =>
      createCoordinatedAutomation(
        harness.definitions(),
        coordinatedCreateInput({ creationKey: 'k1' })
      )
    ).toThrow(/different kind/)
    expect(creationKeyClash.kind).toBeUndefined()
  })

  it('tombstones removed children and refuses to reissue their IDs', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const removed = updateCoordinatedAutomation(harness.definitions(), created.id, {
      children: [child('research')]
    })
    expect(removed.definitionRevision).toBe(2)
    expect(removed.childTombstones).toEqual([
      expect.objectContaining({
        childDefinitionId: 'writer',
        name: 'writer worker',
        lastDefinitionRevision: 1,
        removedInRevision: 2
      })
    ])
    expect(() =>
      updateCoordinatedAutomation(harness.definitions(), created.id, {
        children: [child('research'), child('writer')]
      })
    ).toThrow(/belonged to a removed child/)
  })
})

describe('coordinated run history', () => {
  it('keeps each run rendering from its own frozen snapshot across rename, removal, and restart', () => {
    const harness = durableHarness(coordinatedTestState())
    const orchestration = fakeOrchestration()
    const created = createParent(harness)
    const first = materialize(harness, orchestration, created, 1000)

    updateCoordinatedAutomation(harness.definitions(), created.id, {
      children: [child('research', { name: 'Renamed researcher' }), child('editor')]
    })
    const second = materialize(harness, orchestration, created, 2000)
    harness.restart()

    const [secondReloaded, firstReloaded] = [second, first].map((run) =>
      harness.state.automationRuns.find((entry) => entry.id === run.id)!
    )
    expect(firstReloaded.automationDefinitionRevision).toBe(1)
    expect(firstReloaded.resolvedSnapshot!.resolvedChildren.map((c) => c.name)).toEqual([
      'research worker',
      'writer worker'
    ])
    expect(firstReloaded.childMappings!.map((m) => m.childDefinitionId)).toEqual([
      'research',
      'writer'
    ])
    expect(secondReloaded.automationDefinitionRevision).toBe(2)
    expect(secondReloaded.resolvedSnapshot!.resolvedChildren.map((c) => c.name)).toEqual([
      'Renamed researcher',
      'editor worker'
    ])
    expect(firstReloaded.resolvedSnapshot!.canonicalDigest).not.toBe(
      secondReloaded.resolvedSnapshot!.canonicalDigest
    )
    expect(isCoordinatedRunDispatchable(firstReloaded)).toBe(true)
    expect(isCoordinatedRunDispatchable(secondReloaded)).toBe(true)
    const parent = harness.state.automations.find((a) => a.id === created.id)!
    expect(parent.childTombstones?.map((t) => t.childDefinitionId)).toEqual(['writer'])
  })

  it('bumps the revision in the run write when an out-of-band edit changed resolution', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const first = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1
    })
    harness.state.automations = harness.state.automations.map((a) =>
      a.id === created.id ? { ...a, executionTargetGeneration: 9 } : a
    )
    const second = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 2
    })
    expect(first.automationDefinitionRevision).toBe(1)
    expect(second.automationDefinitionRevision).toBe(2)
    harness.restart()
    expect(harness.state.automations.find((a) => a.id === created.id)!.definitionRevision).toBe(2)
  })

  it('creates exactly one run for a duplicated occurrence, before and after restart', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const input = { automationId: created.id, scheduledFor: 5000 }
    const first = createRun(harness.runs(), input)
    expect(createRun(harness.runs(), input).id).toBe(first.id)
    harness.restart()
    expect(createRun(harness.runs(), input).id).toBe(first.id)
    expect(createRun(harness.runs(), { ...input, trigger: 'manual' }).id).not.toBe(first.id)
    expect(coordinatedRuns(harness.state, created)).toHaveLength(2)
  })

  it('refuses single-run execution and single-run rewrites of coordinated records', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = createParent(harness)
    const runOps = {
      ...harness.runs(),
      recordManualRun: () => {}
    }
    expect(() => createAutomationRun(runOps, created, 1, 'manual')).toThrow(/cannot run yet/)
    const run = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1
    })
    expect(() =>
      updateAutomationRun(runOps, { runId: run.id, status: 'dispatch_failed', error: 'stranded' })
    ).toThrow(/coordinated materialization path/)
    expect(harness.state.automationRuns.find((r) => r.id === run.id)!.status).toBe('pending')
  })
})

describe('materialization crash boundaries', () => {
  // Writes: 1 create parent, 2 run intent, 3 link, 4 mappings, 5 ready.
  it.each([2, 3, 4, 5])(
    'never leaves a half-linked dispatchable run when write %i fails',
    (failingWrite) => {
      const harness = durableHarness(coordinatedTestState())
      const orchestration = fakeOrchestration()
      const created = createParent(harness)
      harness.failAt = failingWrite
      expect(() => materialize(harness, orchestration, created, 7000)).toThrow(
        /simulated write failure/
      )
      expect(harness.state.automationRuns).toEqual(harness.disk.automationRuns)

      harness.restart()
      const survivors = coordinatedRuns(harness.state, created)
      expect(survivors.filter(isCoordinatedRunDispatchable)).toEqual([])
      expect(survivors.length).toBe(failingWrite === 2 ? 0 : 1)

      // Resuming the same occurrence converges on one dispatchable run.
      const resumed = materialize(harness, orchestration, created, 7000)
      expect(coordinatedRuns(harness.state, created)).toHaveLength(1)
      expect(isCoordinatedRunDispatchable(resumed)).toBe(true)
    }
  )

  it('only links records the orchestration store confirms, one AutomationRun per Run', () => {
    const harness = durableHarness(coordinatedTestState())
    const orchestration = fakeOrchestration()
    const created = createParent(harness)
    const run = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1
    })
    const other = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 2
    })
    const link = (automationRunId: string, orchestrationRunId: string) =>
      linkCoordinatedOrchestrationRun(harness.runs(), {
        automationRunId,
        orchestrationRunId,
        probe: orchestration
      })
    expect(() => link(run.id, 'orun-1')).toThrow(/must exist/)
    orchestration.createRun('orun-1')
    link(run.id, 'orun-1')
    expect(link(run.id, 'orun-1').orchestrationRunId).toBe('orun-1')
    expect(() => link(other.id, 'orun-1')).toThrow(/another AutomationRun/)
    orchestration.createRun('orun-2')
    expect(() => link(run.id, 'orun-2')).toThrow(/another orchestration Run/)

    const map = (mappings: { childDefinitionId: string; taskId: string }[]) =>
      persistCoordinatedChildMappings(harness.runs(), {
        automationRunId: run.id,
        mappings,
        probe: orchestration
      })
    expect(() => map([{ childDefinitionId: 'research', taskId: 't1' }])).toThrow(/exactly one/)
    expect(() =>
      map([
        { childDefinitionId: 'research', taskId: 't1' },
        { childDefinitionId: 'writer', taskId: 't2' }
      ])
    ).toThrow(/does not exist/)
    orchestration.createTask('orun-1', 't1')
    orchestration.createTask('orun-1', 't2')
    expect(() =>
      map([
        { childDefinitionId: 'research', taskId: 't1' },
        { childDefinitionId: 'writer', taskId: 't1' }
      ])
    ).toThrow(/more than one child/)
    map([
      { childDefinitionId: 'research', taskId: 't1' },
      { childDefinitionId: 'writer', taskId: 't2' }
    ])
    orchestration.runs.get('orun-1')!.delete('t2')
    expect(() =>
      markCoordinatedRunReadyForDispatch(harness.runs(), {
        automationRunId: run.id,
        probe: orchestration
      })
    ).toThrow(/no longer present/)
    const failed = recordCoordinatedMaterializationFailure(harness.runs(), {
      automationRunId: run.id,
      phase: 'materialization_failed',
      error: 'Task vanished'
    })
    expect(failed).toMatchObject({
      status: 'dispatch_failed',
      materializationPhase: 'materialization_failed'
    })
    expect(isCoordinatedRunDispatchable(failed)).toBe(false)
  })
})

describe('owner fencing and authority', () => {
  function sshParent(harness: Harness): Automation {
    return createParent(harness, { projectId: 'repo-ssh' })
  }

  it('requires a captured, current owner before creating a run for an SSH-owned parent', () => {
    const harness = durableHarness(coordinatedTestState(), 'runtime')
    const created = sshParent(harness)
    expect(created).toMatchObject({ executionTargetType: 'ssh', executionTargetId: 'ssh-1' })
    const run = (expectedOwner?: AutomationOwnerPrecondition) =>
      createRun(harness.runs(), {
        automationId: created.id,
        scheduledFor: 1,
        expectedOwner
      })
    expect(run).toThrow(AUTOMATION_OWNER_CONFLICT_CODES.fencingRequired)
    expect(() =>
      run({ selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 6 } })
    ).toThrow(AUTOMATION_OWNER_CONFLICT_CODES.ownerChanged)
    const owned = run({ selector: { kind: 'ssh', targetId: 'ssh-1', targetGeneration: 7 } })
    expect(owned.resolvedSnapshot!.executionTarget).toEqual({
      type: 'ssh',
      id: 'ssh-1',
      generation: 7
    })
  })

  it('refuses to create runs for a parent whose host was removed', () => {
    const harness = durableHarness(coordinatedTestState())
    const created = sshParent(harness)
    harness.state.sshTargets = []
    expect(() =>
      createRun(harness.runs(), {
        automationId: created.id,
        scheduledFor: 1,
        expectedOwner: { selector: { kind: 'orphan' } }
      })
    ).toThrow(AUTOMATION_OWNER_CONFLICT_CODES.targetRemoved)
    expect(harness.state.automationRuns).toEqual([])
  })

  it('freezes a local runtime-authority parent without a fence', () => {
    const harness = durableHarness(coordinatedTestState(), 'runtime')
    const created = createParent(harness)
    const run = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1
    })
    expect(run.resolvedSnapshot!.executionTarget.type).toBe('local')
  })
})

describe('folder workspaces', () => {
  it('snapshots a folder workspace without inventing git worktree fields', () => {
    const harness = durableHarness(coordinatedTestState())
    const workspaceId = folderWorkspaceKey('fw-1')
    const created = createParent(harness, {
      projectId: 'repo-folder',
      workspaceMode: 'existing',
      workspaceId,
      baseBranch: undefined
    })
    const run = createRun(harness.runs(), {
      automationId: created.id,
      scheduledFor: 1
    })
    harness.restart()
    const reloaded = harness.state.automationRuns.find((entry) => entry.id === run.id)!
    expect(reloaded.workspaceId).toBe(workspaceId)
    for (const resolved of reloaded.resolvedSnapshot!.resolvedChildren) {
      expect(resolved.launchConfig).toMatchObject({
        workspaceMode: 'existing',
        workspaceId,
        baseBranch: null
      })
    }
  })
})
