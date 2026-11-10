import type {
  CoordinatedEscalation,
  CoordinatedRunHalt,
  CoordinatedRunProgress,
  CoordinatedStageProgress
} from '../../shared/coordinated-automation-progress-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import type { CoordinatedRunProgressStore } from './coordinated-automation-progress-store'

/** Every durable write the coordinator makes; tests crash at each one. */
export type CoordinatedDurableBoundary =
  | 'progress.after-write'
  | 'dispatch.after-native-start'
  | 'dispatch.after-mapping'
  | 'report.after-native-settle'
  | 'effect.after-intent'
  | 'effect.after-adapter-ack'
  | 'receipt.after-persist'

export type CoordinatedBoundaryHook = (
  boundary: CoordinatedDurableBoundary,
  detail: Readonly<{ automationRunId: string; childDefinitionId?: string; label?: string }>
) => void

export type CoordinatedLedgerSnapshot = Pick<
  ResolvedAutomationRunSnapshot,
  'canonicalDigest' | 'automationId' | 'definitionRevision' | 'executionTarget'
> & {
  resolvedChildren: readonly Pick<ResolvedChildSnapshot, 'childDefinitionId' | 'enabled'>[]
}

function executionAuthority(snapshot: CoordinatedLedgerSnapshot): string {
  return `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`
}

/** Pure check that stored progress belongs to exactly this frozen run; null when it does. */
export function progressIdentityProblem(
  progress: CoordinatedRunProgress,
  expected: {
    automationRunId: string
    orchestrationRunId: string
    snapshot: CoordinatedLedgerSnapshot
  }
): string | null {
  const checks: [string, unknown, unknown][] = [
    ['automationRunId', progress.automationRunId, expected.automationRunId],
    ['automationId', progress.automationId, expected.snapshot.automationId],
    ['definitionRevision', progress.definitionRevision, expected.snapshot.definitionRevision],
    ['executionAuthority', progress.executionAuthority, executionAuthority(expected.snapshot)],
    ['orchestrationRunId', progress.orchestrationRunId, expected.orchestrationRunId],
    ['canonicalDigest', progress.canonicalDigest, expected.snapshot.canonicalDigest]
  ]
  const mismatch = checks.find(([, actual, wanted]) => actual !== wanted)
  if (mismatch) {
    return `${mismatch[0]} ${String(mismatch[1])} does not match ${String(mismatch[2])}.`
  }
  const enabled = new Set(
    expected.snapshot.resolvedChildren.filter((c) => c.enabled).map((c) => c.childDefinitionId)
  )
  const foreign = Object.keys(progress.stages).find((id) => !enabled.has(id))
  return foreign ? `stage ${foreign} is not an enabled child of this snapshot.` : null
}

export class CoordinatedGenerationFencedError extends Error {
  constructor(automationRunId: string, mine: number, stored: number) {
    super(
      `Coordinator generation ${mine} for run "${automationRunId}" was replaced by generation ${stored}.`
    )
    this.name = 'CoordinatedGenerationFencedError'
  }
}

export function initialStageProgress(): CoordinatedStageProgress {
  return {
    status: 'pending',
    activeDispatchId: null,
    acceptedDispatchId: null,
    acceptedReportDigest: null,
    acceptedArtifacts: [],
    attempts: 0,
    reopenings: 0,
    lineage: [],
    reviewIterations: 0,
    findings: [],
    lastError: null
  }
}

export function withEscalation(
  progress: CoordinatedRunProgress,
  escalation: CoordinatedEscalation
): CoordinatedRunProgress {
  if (progress.escalations.some((existing) => existing.key === escalation.key)) {
    return progress
  }
  return { ...progress, escalations: [...progress.escalations, escalation] }
}

export function withHalt(
  progress: CoordinatedRunProgress,
  halt: CoordinatedRunHalt
): CoordinatedRunProgress {
  return progress.halt ? progress : { ...progress, halt }
}

export function withStage(
  progress: CoordinatedRunProgress,
  childDefinitionId: string,
  update: (stage: CoordinatedStageProgress) => CoordinatedStageProgress
): CoordinatedRunProgress {
  const stage = progress.stages[childDefinitionId] ?? initialStageProgress()
  return { ...progress, stages: { ...progress.stages, [childDefinitionId]: update(stage) } }
}

/**
 * One coordinator generation's handle on a run's durable progress. Claiming bumps the
 * generation so an older coordinator's next write is fenced instead of interleaving.
 */
export class CoordinatedProgressLedger {
  #current: CoordinatedRunProgress

  private constructor(
    readonly store: CoordinatedRunProgressStore,
    readonly generation: number,
    current: CoordinatedRunProgress,
    readonly boundary: CoordinatedBoundaryHook
  ) {
    this.#current = current
  }

  static claim(input: {
    store: CoordinatedRunProgressStore
    automationRunId: string
    orchestrationRunId: string
    snapshot: CoordinatedLedgerSnapshot
    now: number
    boundary: CoordinatedBoundaryHook
  }): CoordinatedProgressLedger {
    const stored = input.store.read(input.automationRunId)
    const problem = stored
      ? progressIdentityProblem(stored, {
          automationRunId: input.automationRunId,
          orchestrationRunId: input.orchestrationRunId,
          snapshot: input.snapshot
        })
      : null
    if (problem) {
      throw new Error(
        `Coordinated progress for run "${input.automationRunId}" belongs to another snapshot, revision, authority, or orchestration Run: ${problem}`
      )
    }
    const base: CoordinatedRunProgress = stored ?? {
      schemaVersion: 1,
      automationId: input.snapshot.automationId,
      definitionRevision: input.snapshot.definitionRevision,
      executionAuthority: executionAuthority(input.snapshot),
      automationRunId: input.automationRunId,
      orchestrationRunId: input.orchestrationRunId,
      canonicalDigest: input.snapshot.canonicalDigest,
      sequence: -1,
      generation: 0,
      startedAt: input.now,
      spentCostUsd: 0,
      dispatchStartFailures: 0,
      stages: Object.fromEntries(
        input.snapshot.resolvedChildren
          .filter((child) => child.enabled)
          .map((child) => [child.childDefinitionId, initialStageProgress()])
      ),
      reports: [],
      effects: {},
      escalations: [],
      halt: null
    }
    const next = { ...base, generation: base.generation + 1, sequence: base.sequence + 1 }
    input.store.write(next, base.sequence)
    input.boundary('progress.after-write', {
      automationRunId: input.automationRunId,
      label: 'generation-claimed'
    })
    return new CoordinatedProgressLedger(input.store, next.generation, next, input.boundary)
  }

  get progress(): CoordinatedRunProgress {
    return this.#current
  }

  /** Re-reads durable state and refuses to continue when a newer generation owns the run. */
  refresh(): CoordinatedRunProgress {
    const stored = this.store.read(this.#current.automationRunId)
    if (!stored || stored.generation !== this.generation) {
      throw new CoordinatedGenerationFencedError(
        this.#current.automationRunId,
        this.generation,
        stored?.generation ?? -1
      )
    }
    this.#current = stored
    return stored
  }

  update(
    label: string,
    mutate: (progress: CoordinatedRunProgress) => CoordinatedRunProgress,
    childDefinitionId?: string
  ): CoordinatedRunProgress {
    const current = this.refresh()
    const mutated = mutate(current)
    if (mutated === current) {
      return current
    }
    const next = { ...mutated, sequence: current.sequence + 1, generation: this.generation }
    this.store.write(next, current.sequence)
    this.#current = next
    this.boundary('progress.after-write', {
      automationRunId: next.automationRunId,
      childDefinitionId,
      label
    })
    return next
  }
}
