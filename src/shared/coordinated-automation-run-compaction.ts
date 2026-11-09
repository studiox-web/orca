import type { AutomationRun } from './automations-types'

/** Receipt-only rows are small, but still bounded so history cannot grow without limit. */
export const MAX_COMPACTED_COORDINATED_RUNS_PER_AUTOMATION = 400

export function retainsCompletionReceipt(run: AutomationRun): boolean {
  if (!run.completionReceipt) {
    return false
  }
  const policy = run.resolvedSnapshot?.retentionPolicy
  return run.retainedEvidence !== undefined || policy?.preserveCompletionReceipt !== false
}

/** Keep the identity chain, receipt, mappings, and frozen child labels; drop heavy payloads. */
export function compactCoordinatedRun(run: AutomationRun): AutomationRun {
  const snapshot = run.resolvedSnapshot
  if (!snapshot) {
    return run
  }
  return {
    ...run,
    outputSnapshot: null,
    precheckResult: null,
    resolvedSnapshot: snapshot.retentionPolicy.preserveSnapshot === true ? snapshot : null,
    retainedEvidence: {
      definitionRevision: snapshot.definitionRevision,
      canonicalDigest: snapshot.canonicalDigest,
      children: snapshot.resolvedChildren.map((child) => ({
        childDefinitionId: child.childDefinitionId,
        name: child.name,
        role: child.role
      })),
      minimumEvidenceReferences: [...(snapshot.retentionPolicy.minimumEvidenceReferences ?? [])]
    }
  }
}
