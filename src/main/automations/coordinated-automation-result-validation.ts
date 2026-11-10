import Ajv, { type ValidateFunction } from 'ajv'
import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type {
  SemanticReceiptEffect,
  StructuredWorkerResult
} from '../../shared/coordinated-automation-receipt-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'
import {
  type CoordinatedHostApproval,
  validateStageApprovals
} from './coordinated-automation-approval-validation'
import {
  matchesPathPattern,
  validateWorkerArtifacts
} from './coordinated-automation-artifact-validation'

export { type CoordinatedHostApproval, matchesPathPattern }

export type WorkerResultValidationContext = Readonly<{
  automationRunId: string
  orchestrationRunId: string
  definitionRevision: number
  childDefinitionId: string
  taskId: string
  dispatchId: string
  canonicalDigest: string
  child: ResolvedChildSnapshot
  snapshot: ResolvedAutomationRunSnapshot
  workspacePath?: string
  checkArtifactExistence?: (uri: string) => boolean
  hostApprovals?: readonly CoordinatedHostApproval[]
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  trustedAuthorIdentity?: string
  authorIdentities?: readonly string[]
}>

export type WorkerResultValidationOutcome =
  | { valid: true; report: StructuredWorkerResult }
  | { valid: false; error: string }

export function validateLaunchPolicy(
  child: ResolvedChildSnapshot,
  snapshot: ResolvedAutomationRunSnapshot,
  options: { fakeEffects?: boolean } = {}
): { allowed: true } | { allowed: false; reason: string } {
  // Effects are permitted only against the host-owned deterministic fake adapter.
  if (snapshot.publicationPolicy.allowExternalMutation && !options.fakeEffects) {
    return {
      allowed: false,
      reason:
        'Launch refused: external mutations are not permitted without the fake effect adapter.'
    }
  }
  if (
    child.stageAcceptance?.requiredEffects &&
    child.stageAcceptance.requiredEffects.length > 0 &&
    !options.fakeEffects
  ) {
    return {
      allowed: false,
      reason: `Launch refused: child "${child.childDefinitionId}" requires effects, which are denied without the fake effect adapter.`
    }
  }
  return { allowed: true }
}

export function validateStructuredWorkerResult(
  report: unknown,
  context: WorkerResultValidationContext
): WorkerResultValidationOutcome {
  const rawReport = report as Record<string, unknown>
  if (
    rawReport.approvals !== undefined ||
    rawReport.effectReceipts !== undefined ||
    rawReport.approverIdentity !== undefined ||
    rawReport.authorizedEffects !== undefined
  ) {
    return {
      valid: false,
      error: 'Worker report cannot smuggle approval or effect trust authority.'
    }
  }

  const parsed = StructuredWorkerResultSchema.safeParse(report)
  if (!parsed.success) {
    return {
      valid: false,
      error: `Structured worker result schema invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    }
  }
  const data = parsed.data

  if (data.automationRunId !== context.automationRunId) {
    return {
      valid: false,
      error: `Worker result automationRunId "${data.automationRunId}" does not match "${context.automationRunId}".`
    }
  }
  if (data.orchestrationRunId !== context.orchestrationRunId) {
    return {
      valid: false,
      error: `Worker result orchestrationRunId "${data.orchestrationRunId}" does not match "${context.orchestrationRunId}".`
    }
  }
  if (data.childDefinitionId !== context.childDefinitionId) {
    return {
      valid: false,
      error: `Worker result childDefinitionId "${data.childDefinitionId}" does not match "${context.childDefinitionId}".`
    }
  }
  if (data.taskId !== context.taskId) {
    return {
      valid: false,
      error: `Worker result taskId "${data.taskId}" does not match "${context.taskId}".`
    }
  }
  if (data.dispatchId !== context.dispatchId) {
    return {
      valid: false,
      error: `Worker result dispatchId "${data.dispatchId}" does not match "${context.dispatchId}".`
    }
  }
  if (data.definitionRevision !== context.definitionRevision) {
    return {
      valid: false,
      error: `Worker result definitionRevision (${data.definitionRevision}) does not match snapshot (${context.definitionRevision}).`
    }
  }

  if (!data.resolvedConfigDigest || data.resolvedConfigDigest.trim() === '') {
    return { valid: false, error: 'Worker result resolvedConfigDigest must not be empty.' }
  }
  if (data.resolvedConfigDigest !== context.canonicalDigest) {
    return {
      valid: false,
      error: `Worker result resolvedConfigDigest "${data.resolvedConfigDigest}" does not match snapshot canonicalDigest "${context.canonicalDigest}".`
    }
  }

  if (context.child.resultSchema) {
    const ajv = new Ajv({ allErrors: true })
    let validateFn: ValidateFunction
    try {
      validateFn = ajv.compile(context.child.resultSchema)
    } catch (err) {
      return {
        valid: false,
        error: `Invalid child resultSchema: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    const payload =
      (report as Record<string, unknown>).data ??
      (report as Record<string, unknown>).metadata ??
      data
    if (!validateFn(payload)) {
      return {
        valid: false,
        error: `Worker result violates child resultSchema: ${ajv.errorsText(validateFn.errors)}`
      }
    }
  }

  const artifactValidation = validateWorkerArtifacts(
    data.artifacts,
    context.child.stageAcceptance,
    {
      taskId: context.taskId,
      dispatchId: context.dispatchId,
      workspacePath: context.workspacePath,
      checkArtifactExistence: context.checkArtifactExistence
    }
  )
  if (!artifactValidation.valid) {
    return { valid: false, error: artifactValidation.error }
  }

  for (const criterion of context.child.stageAcceptance?.criteria ?? []) {
    if (criterion.required !== false) {
      const check = data.checks.find((c) => c.id === criterion.id)
      if (!check || check.outcome !== 'passed') {
        return {
          valid: false,
          error: `Required stage criterion "${criterion.id}" was not satisfied in worker result.`
        }
      }
    }
  }

  for (const req of context.child.stageAcceptance?.requiredChecks ?? []) {
    if (req.required !== false) {
      const check = data.checks.find(
        (c) => c.id === req.id && (!req.namespace || c.namespace === req.namespace)
      )
      if (!check) {
        return {
          valid: false,
          error: `Required stage check "${req.id}" missing from worker result.`
        }
      }
      if (check.outcome !== 'passed') {
        return {
          valid: false,
          error: `Required stage check "${req.id}" outcome was "${check.outcome}", expected "passed".`
        }
      }
    }
  }

  const stageApprovalValidation = validateStageApprovals(
    context.child.stageAcceptance?.requiredApprovals,
    context.hostApprovals,
    {
      automationId: context.snapshot.automationId,
      definitionRevision: context.definitionRevision,
      automationRunId: context.automationRunId,
      orchestrationRunId: context.orchestrationRunId,
      childDefinitionId: context.child.childDefinitionId,
      taskId: context.taskId,
      dispatchId: context.dispatchId,
      trustedAuthorIdentity: context.trustedAuthorIdentity,
      authorIdentities: context.authorIdentities
    }
  )
  if (!stageApprovalValidation.valid) {
    return { valid: false, error: stageApprovalValidation.error }
  }

  if (data.effects.some((e) => e.status !== 'denied')) {
    return {
      valid: false,
      error:
        'External effects denied: only fake worker provider with no effects is permitted in Phase 4.'
    }
  }

  if (data.blockers.length > 0 && data.outcome === 'succeeded') {
    return {
      valid: false,
      error: 'Worker result outcome cannot be "succeeded" when blockers are present.'
    }
  }

  return { valid: true, report: data }
}
