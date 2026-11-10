import { createHash } from 'node:crypto'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import { reviewIterationLimit } from './coordinated-automation-ceilings'
import { withEscalation, withHalt, withStage } from './coordinated-automation-progress-ledger'

/** Material findings are the blockers a reviewer routes back upstream; order does not matter. */
export function upstreamFindingFingerprint(report: StructuredWorkerResult): string | null {
  const findings = report.blockers
    .filter((blocker) => blocker.resolvableBy === 'upstream_fix')
    .map((blocker) => `${blocker.code}\u0000${blocker.message.trim()}`)
    .sort()
  if (findings.length === 0) {
    return null
  }
  return `finding:${createHash('sha256').update(JSON.stringify(findings)).digest('hex').slice(0, 24)}`
}

/** Every enabled stage that transitively depends on one of `roots`. */
function downstreamStages(
  snapshot: ResolvedAutomationRunSnapshot,
  roots: Set<string>
): Set<string> {
  const affected = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const child of snapshot.resolvedChildren) {
      if (!child.enabled || affected.has(child.childDefinitionId)) {
        continue
      }
      if (child.dependencies.some((dep) => roots.has(dep.childId) || affected.has(dep.childId))) {
        affected.add(child.childDefinitionId)
        changed = true
      }
    }
  }
  return affected
}

/**
 * Sends one reviewer finding back to the reviewed stages. A repeated finding or an exhausted
 * iteration budget escalates once and halts instead of opening another fix attempt.
 */
export function applyReviewFindings(
  progress: CoordinatedRunProgress,
  snapshot: ResolvedAutomationRunSnapshot,
  reviewer: ResolvedChildSnapshot,
  fingerprint: string,
  reason: string,
  now: number
): CoordinatedRunProgress {
  const targets = reviewer.dependencies
    .map((dep) => snapshot.resolvedChildren.find((c) => c.childDefinitionId === dep.childId))
    .filter((child): child is ResolvedChildSnapshot => Boolean(child?.enabled))
  let next = progress
  for (const target of targets) {
    const stage = next.stages[target.childDefinitionId]
    if (stage?.findings.includes(fingerprint)) {
      next = withEscalation(next, {
        key: `repeated_finding:${target.childDefinitionId}:${fingerprint}`,
        code: 'repeated_finding',
        childDefinitionId: target.childDefinitionId,
        detail: `Reviewer "${reviewer.childDefinitionId}" repeated finding ${fingerprint}: ${reason}`,
        requiresHumanDecision: true,
        at: now
      })
      return withHalt(next, { state: 'blocked', reason: 'A review finding repeated.', at: now })
    }
    const limit = reviewIterationLimit(snapshot, target)
    if ((stage?.reviewIterations ?? 0) >= limit) {
      next = withEscalation(next, {
        key: `review_limit:${target.childDefinitionId}`,
        code: 'review_limit',
        childDefinitionId: target.childDefinitionId,
        detail: `Stage "${target.childDefinitionId}" used all ${limit} review iterations.`,
        requiresHumanDecision: true,
        at: now
      })
      return withHalt(next, {
        state: 'blocked',
        reason: 'Review iteration limit reached.',
        at: now
      })
    }
  }
  const targetIds = new Set(targets.map((t) => t.childDefinitionId))
  for (const id of targetIds) {
    next = withStage(next, id, (stage) => ({
      ...stage,
      status: 'revision_requested',
      attempts: 0,
      reviewIterations: stage.reviewIterations + 1,
      findings: [...stage.findings, fingerprint],
      lastError: reason
    }))
  }
  for (const id of downstreamStages(snapshot, targetIds)) {
    next = withStage(next, id, (stage) => ({
      ...stage,
      status: 'pending',
      attempts: 0,
      acceptedDispatchId: null,
      acceptedReportDigest: null,
      acceptedArtifacts: [],
      lastError:
        id === reviewer.childDefinitionId ? `Requested revision: ${reason}` : stage.lastError
    }))
  }
  return next
}
