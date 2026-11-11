import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'
import { ExpectedOwner } from './automation-params'

const CoordinatedRunParent = z.strictObject({
  runtimeId: requiredString('Missing runtime authority'),
  automationId: requiredString('Missing automation id'),
  expectedOwner: ExpectedOwner.unwrap()
})

export const CoordinatedFakeRunStart = CoordinatedRunParent.extend({
  expectedDefinitionRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(128)
})

export const CoordinatedRunSelection = CoordinatedRunParent.extend({
  automationRunId: requiredString('Missing automation run id')
})

const CoordinatedRunOperatorBase = CoordinatedRunParent.extend({
  automationRunId: requiredString('Missing automation run id'),
  orchestrationRunId: z.string().nullable(),
  definitionRevision: z.number().int().positive(),
  targetExecutionAuthority: requiredString('Missing target execution authority')
})

/**
 * Operator actions carry no request id: each is idempotent on its natural key and answers a
 * replay with `disposition: 'already_recorded'` and no new write — stop on the run, retry on
 * (stage, retryOfDispatchId), gate resolution on (gate, scope, decision). A different decision
 * for a resolved gate, or a retry naming anything but the latest attempt, is refused.
 */
/** Idempotent operator stop: replays after the durable marker are acknowledged, not re-issued. */
export const StopCoordinatedRun = CoordinatedRunOperatorBase

/** One exact stage attempt retry within the existing bounded attempt policy. */
export const RetryCoordinatedStage = CoordinatedRunOperatorBase.extend({
  childDefinitionId: requiredString('Missing child definition id'),
  taskId: requiredString('Missing task id'),
  retryOfDispatchId: requiredString('Missing retry-of dispatch id')
})

/** Bind an operator decision to the exact run/artifact/evidence scope of one pending gate. */
export const ResolveCoordinatedGate = CoordinatedRunOperatorBase.extend({
  gateId: requiredString('Missing gate id'),
  /** Disambiguates an id used by both a stage and a parent requirement; stage-first if omitted. */
  gateScope: z.enum(['stage', 'parent', 'escalation']).optional(),
  decision: z.enum(['approve', 'reject', 'escalate']),
  note: z.string().min(1).max(2000).optional(),
  childDefinitionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  dispatchId: z.string().min(1).optional(),
  /**
   * Digest of the held report the operator was shown (stage.pendingApproval.reportDigest).
   * Approving a stage gate requires it together with dispatchId; the host refuses if either
   * differs from what it holds at submission.
   */
  expectedReportDigest: z.string().min(1).optional()
})

export type CoordinatedFakeRunStartInput = z.infer<typeof CoordinatedFakeRunStart>
export type CoordinatedRunSelectionInput = z.infer<typeof CoordinatedRunSelection>
export type StopCoordinatedRunInput = z.infer<typeof StopCoordinatedRun>
export type RetryCoordinatedStageInput = z.infer<typeof RetryCoordinatedStage>
export type ResolveCoordinatedGateInput = z.infer<typeof ResolveCoordinatedGate>
