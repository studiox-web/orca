import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { Store } from '../persistence/loading-store/store'
import type { CoordinatedWorkerProvider } from './coordinated-automation-recovery-context'

/** The deterministic no-effect provider the shadow implementation runs against by default. */
export function createDefaultFakeNoEffectsWorkerProvider(store: Store): CoordinatedWorkerProvider {
  return {
    capability: 'fake_no_effects',
    run: async (id): Promise<StructuredWorkerResult> => {
      const run = store.listAutomationRuns().find((r) => r.id === id.automationRunId)
      const checks = (run?.resolvedSnapshot?.outcomeContract.acceptanceCriteria ?? []).map((c) => ({
        id: c.id,
        outcome: 'passed' as const,
        evidence: [`Criterion ${c.id} verified passed by fake worker`]
      }))
      return {
        schemaVersion: 1,
        ...id,
        definitionRevision: run?.resolvedSnapshot?.definitionRevision ?? 1,
        resolvedConfigDigest: run?.resolvedSnapshot?.canonicalDigest ?? `sha256:${'0'.repeat(64)}`,
        outcome: 'succeeded',
        summary: `Fake worker ${id.childDefinitionId} completed`,
        reportMarkdown: `Fake worker ${id.childDefinitionId} report`,
        artifacts: [],
        checks,
        effects: [],
        blockers: []
      }
    }
  }
}
