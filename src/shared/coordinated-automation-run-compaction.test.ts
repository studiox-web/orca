import { describe, expect, it } from 'vitest'
import type { AutomationRun } from './automations-types'
import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type { SemanticCompletionReceipt } from './coordinated-automation-receipt-types'
import { pruneAutomationRuns } from './automation-run-retention'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: retention reads only the fields this partial fixture sets.
const RECEIPT = { finalState: 'completed' } as unknown as SemanticCompletionReceipt

function snapshot(
  retentionPolicy: ResolvedAutomationRunSnapshot['retentionPolicy']
): ResolvedAutomationRunSnapshot {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: retention reads only the fields this partial fixture sets.
  return {
    automationId: 'a1',
    definitionRevision: 3,
    canonicalDigest: `sha256:${'a'.repeat(64)}`,
    executionTarget: { type: 'local', id: 'local' },
    resolvedChildren: [{ childDefinitionId: 'writer', name: 'Writer', role: 'author' }],
    retentionPolicy
  } as unknown as ResolvedAutomationRunSnapshot
}

function run(id: string, createdAt: number, extra: Partial<AutomationRun> = {}): AutomationRun {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: retention reads only the fields this partial fixture sets.
  return {
    id,
    automationId: 'a1',
    status: 'completed',
    createdAt,
    scheduledFor: createdAt,
    outputSnapshot: 'large output',
    ...extra
  } as AutomationRun
}

function coordinated(
  id: string,
  createdAt: number,
  policy: ResolvedAutomationRunSnapshot['retentionPolicy'] = {
    preserveCompletionReceipt: true,
    minimumEvidenceReferences: ['receipt:article']
  },
  receipt: SemanticCompletionReceipt | null = RECEIPT
): AutomationRun {
  return run(id, createdAt, {
    materializationPhase: 'ready_for_dispatch',
    automationDefinitionRevision: 3,
    orchestrationRunId: `orun-${id}`,
    resolvedSnapshot: snapshot(policy),
    completionReceipt: receipt,
    childMappings: [{ childDefinitionId: 'writer', taskId: `task-${id}` }],
    idempotencyKey: `scheduled:${createdAt}`
  })
}

describe('coordinated run retention', () => {
  it('compacts evicted runs to their receipt and minimum evidence instead of dropping them', () => {
    const kept = pruneAutomationRuns(
      [
        coordinated('old-receipt', 1),
        coordinated('old-no-receipt', 2, undefined, null),
        coordinated('old-opted-out', 3, { preserveCompletionReceipt: false }),
        run('old-single', 4),
        coordinated('new', 5)
      ],
      1,
      5
    )
    expect(kept.map((entry) => entry.id)).toEqual(['old-receipt', 'new'])
    const [compacted, full] = kept
    expect(full.resolvedSnapshot).not.toBeNull()
    expect(compacted).toMatchObject({
      completionReceipt: RECEIPT,
      orchestrationRunId: 'orun-old-receipt',
      childMappings: [{ childDefinitionId: 'writer', taskId: 'task-old-receipt' }],
      idempotencyKey: 'scheduled:1',
      outputSnapshot: null,
      resolvedSnapshot: null,
      retainedEvidence: {
        definitionRevision: 3,
        canonicalDigest: `sha256:${'a'.repeat(64)}`,
        executionAuthority: 'local:local',
        children: [{ childDefinitionId: 'writer', name: 'Writer', role: 'author' }],
        minimumEvidenceReferences: ['receipt:article']
      }
    })
    expect(pruneAutomationRuns(kept, 1, 5)).toEqual(kept)
  })

  it('bounds compacted history and leaves single-run pruning unchanged', () => {
    const runs = [coordinated('c1', 1), coordinated('c2', 2), run('s1', 3), run('s2', 4)]
    expect(pruneAutomationRuns(runs, 1, 1).map((entry) => entry.id)).toEqual(['c2', 's2'])
    const singles = [run('s1', 1), run('s2', 2), run('pending', 0, { status: 'pending' })]
    expect(pruneAutomationRuns(singles, 1)).toEqual([singles[1], singles[2]])
  })
})
