import { createHash } from 'node:crypto'
import type {
  CoordinatedEffectEntry,
  CoordinatedEffectStatus,
  CoordinatedRunProgress
} from '../../shared/coordinated-automation-progress-types'
import type { SemanticReceiptEffect } from '../../shared/coordinated-automation-receipt-types'
import type {
  ResolvedAutomationRunSnapshot,
  StageEffectRequirement
} from '../../shared/coordinated-automation-types'
import { withEscalation, withHalt } from './coordinated-automation-progress-ledger'
import {
  assertCoordinatorActive,
  type CoordinatedFakeEffectObservation,
  type CoordinatedPassContext
} from './coordinated-automation-recovery-context'

/** One effect per run, stage, kind, and namespace, so retries and fixes can never mint another. */
export function deterministicCoordinatedEffectId(
  automationRunId: string,
  childDefinitionId: string,
  requirement: Pick<StageEffectRequirement, 'kind' | 'namespace'>
): string {
  const key = JSON.stringify([
    automationRunId,
    childDefinitionId,
    requirement.kind,
    requirement.namespace ?? null
  ])
  return `effect_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

type DeclaredStageEffect = {
  childDefinitionId: string
  effectId: string
  requirement: StageEffectRequirement
}

export function declaredStageEffects(
  snapshot: ResolvedAutomationRunSnapshot,
  automationRunId: string
): DeclaredStageEffect[] {
  return snapshot.resolvedChildren
    .filter((child) => child.enabled)
    .flatMap((child) =>
      (child.stageAcceptance?.requiredEffects ?? []).map((requirement) => ({
        childDefinitionId: child.childDefinitionId,
        effectId: deterministicCoordinatedEffectId(
          automationRunId,
          child.childDefinitionId,
          requirement
        ),
        requirement
      }))
    )
}

function observedStatus(
  observation: CoordinatedFakeEffectObservation
): CoordinatedEffectStatus | null {
  if (
    (observation.state === 'verified' || observation.state === 'applied') &&
    observation.receipt
  ) {
    return observation.state
  }
  if (observation.state === 'denied') {
    return 'denied'
  }
  if (observation.state === 'not_started') {
    return null
  }
  return 'uncertain'
}

function recordObservation(
  ctx: CoordinatedPassContext,
  entry: CoordinatedEffectEntry,
  status: CoordinatedEffectStatus,
  receipt: string | null,
  label: string
): void {
  const now = ctx.clock.now()
  ctx.ledger.update(
    label,
    (progress) => {
      const current = progress.effects[entry.effectId]
      if (current && current.status === status && current.receipt === receipt) {
        return progress
      }
      let next: CoordinatedRunProgress = {
        ...progress,
        effects: {
          ...progress.effects,
          [entry.effectId]: { ...entry, status, receipt, updatedAt: now }
        }
      }
      if (status === 'uncertain') {
        next = withEscalation(next, {
          key: `uncertain_effect:${entry.effectId}`,
          code: 'uncertain_effect',
          childDefinitionId: entry.childDefinitionId,
          detail: `Effect ${entry.effectId} (${entry.kind}) has no exact receipt; it will not be replayed.`,
          requiresHumanDecision: true,
          at: now
        })
      }
      if (status === 'denied') {
        next = withEscalation(next, {
          key: `effect_denied:${entry.effectId}`,
          code: 'effect_denied',
          childDefinitionId: entry.childDefinitionId,
          detail: `Effect ${entry.effectId} (${entry.kind}) was denied.`,
          requiresHumanDecision: false,
          at: now
        })
        next = withHalt(next, {
          state: 'failed',
          reason: `Effect ${entry.kind} was denied.`,
          at: now
        })
      }
      return next
    },
    entry.childDefinitionId
  )
}

async function applyOnce(
  ctx: CoordinatedPassContext,
  entry: CoordinatedEffectEntry
): Promise<void> {
  const adapter = ctx.effectAdapter!
  const authorized = {
    ...entry,
    status: 'intent_recorded' as const,
    applyAuthorizations: entry.applyAuthorizations + 1
  }
  ctx.ledger.update(
    'effect-intent',
    (progress) => ({ ...progress, effects: { ...progress.effects, [entry.effectId]: authorized } }),
    entry.childDefinitionId
  )
  ctx.boundary('effect.after-intent', {
    automationRunId: ctx.ledger.progress.automationRunId,
    childDefinitionId: entry.childDefinitionId,
    label: entry.effectId
  })
  const observation = await adapter.apply(entry.effectId)
  // The apply may have happened; a stopped host records nothing and the next generation queries.
  assertCoordinatorActive(ctx)
  ctx.boundary('effect.after-adapter-ack', {
    automationRunId: ctx.ledger.progress.automationRunId,
    childDefinitionId: entry.childDefinitionId,
    label: entry.effectId
  })
  recordObservation(
    ctx,
    authorized,
    observedStatus(observation) ?? 'uncertain',
    observation.receipt ?? null,
    'effect-applied'
  )
}

/**
 * Advances every effect of accepted stages. An unacknowledged or uncertain apply is only ever
 * queried; a second apply is authorized solely when the exact state proves nothing happened.
 */
export async function advanceStageEffects(
  ctx: CoordinatedPassContext,
  snapshot: ResolvedAutomationRunSnapshot
): Promise<boolean> {
  const before = ctx.ledger.progress.sequence
  const automationRunId = ctx.ledger.progress.automationRunId
  for (const declared of declaredStageEffects(snapshot, automationRunId)) {
    const progress = ctx.ledger.progress
    if (progress.halt?.state === 'failed') {
      break
    }
    const entry = progress.effects[declared.effectId]
    if (!entry) {
      if (progress.stages[declared.childDefinitionId]?.status !== 'accepted') {
        continue
      }
      await applyOnce(ctx, {
        effectId: declared.effectId,
        childDefinitionId: declared.childDefinitionId,
        kind: declared.requirement.kind,
        ...(declared.requirement.namespace !== undefined
          ? { namespace: declared.requirement.namespace }
          : {}),
        status: 'intent_recorded',
        receipt: null,
        applyAuthorizations: 0,
        updatedAt: ctx.clock.now()
      })
      continue
    }
    if (entry.status === 'verified' || entry.status === 'denied') {
      continue
    }
    const observation = await ctx.effectAdapter!.query(entry.effectId)
    assertCoordinatorActive(ctx)
    const status = observedStatus(observation)
    if (status === null && entry.status === 'intent_recorded') {
      await applyOnce(ctx, entry)
      continue
    }
    recordObservation(
      ctx,
      entry,
      status ?? 'uncertain',
      observation.receipt ?? entry.receipt,
      'effect-queried'
    )
  }
  return ctx.ledger.progress.sequence !== before
}

/** Effects that still block completion; uncertain ones stop the run for a human decision. */
export function unresolvedEffects(
  snapshot: ResolvedAutomationRunSnapshot,
  progress: CoordinatedRunProgress
): { pending: string[]; uncertain: string[] } {
  const pending: string[] = []
  const uncertain: string[] = []
  for (const declared of declaredStageEffects(snapshot, progress.automationRunId)) {
    const entry = progress.effects[declared.effectId]
    if (entry?.status === 'verified') {
      continue
    }
    if (entry?.status === 'uncertain') {
      uncertain.push(declared.effectId)
    } else {
      pending.push(declared.effectId)
    }
  }
  return { pending, uncertain }
}

export function verifiedEffectReceipts(progress: CoordinatedRunProgress): SemanticReceiptEffect[] {
  return Object.values(progress.effects)
    .filter((entry) => entry.status === 'verified' && entry.receipt)
    .sort((left, right) => left.effectId.localeCompare(right.effectId))
    .map((entry) => ({
      kind: entry.kind,
      ...(entry.namespace !== undefined ? { namespace: entry.namespace } : {}),
      status: 'verified',
      receipt: entry.receipt!,
      verifiedAt: entry.updatedAt
    }))
}
