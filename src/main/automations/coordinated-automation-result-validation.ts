import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import Ajv, { type ValidateFunction } from 'ajv'
import { StructuredWorkerResultSchema } from '../../shared/coordinated-automation-receipt-schemas'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type {
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../shared/coordinated-automation-types'

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
}>

export type WorkerResultValidationOutcome =
  | { valid: true; report: StructuredWorkerResult }
  | { valid: false; error: string }

export function matchesPathPattern(uri: string, pattern: string): boolean {
  const cleanUri = uri.replace(/^artifact:\/\//, '').replace(/^\/+/, '')
  const cleanPattern = pattern.replace(/^artifact:\/\//, '').replace(/^\/+/, '')
  if (cleanUri === cleanPattern) {
    return true
  }
  const regexStr = cleanPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '@@DOUBLE_STAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DOUBLE_STAR@@/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${regexStr}$`).test(cleanUri)
}

export function validateLaunchPolicy(
  child: ResolvedChildSnapshot,
  snapshot: ResolvedAutomationRunSnapshot
): { allowed: true } | { allowed: false; reason: string } {
  if (snapshot.publicationPolicy.allowExternalMutation) {
    return {
      allowed: false,
      reason: 'Launch refused: external mutations are not permitted in Phase 4.'
    }
  }
  if (child.stageAcceptance?.requiredEffects && child.stageAcceptance.requiredEffects.length > 0) {
    return {
      allowed: false,
      reason: `Launch refused: child "${child.childDefinitionId}" requires effects, which are denied in Phase 4.`
    }
  }
  return { allowed: true }
}

export function validateStructuredWorkerResult(
  report: unknown,
  context: WorkerResultValidationContext
): WorkerResultValidationOutcome {
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

  for (const artifact of data.artifacts) {
    if (
      artifact.producerAttempt &&
      (artifact.producerAttempt.taskId !== context.taskId ||
        artifact.producerAttempt.dispatchId !== context.dispatchId)
    ) {
      return {
        valid: false,
        error: `Artifact producerAttempt mismatch: expected task ${context.taskId} dispatch ${context.dispatchId}.`
      }
    }
    if (artifact.sha256 && !/^sha256:[0-9a-f]{64}$/.test(artifact.sha256)) {
      return {
        valid: false,
        error: `Artifact "${artifact.uri}" sha256 "${artifact.sha256}" is not a valid lowercase hex digest.`
      }
    }
    if (context.checkArtifactExistence && !context.checkArtifactExistence(artifact.uri)) {
      return {
        valid: false,
        error: `Artifact "${artifact.uri}" does not exist according to host artifact existence probe.`
      }
    }
    const cleanUri = artifact.uri.replace(/^file:\/\//, '').replace(/^artifact:\/\//, '')
    const fullPath = isAbsolute(cleanUri)
      ? cleanUri
      : context.workspacePath
        ? join(context.workspacePath, cleanUri)
        : null

    if (fullPath) {
      if (!existsSync(fullPath)) {
        return {
          valid: false,
          error: `Artifact file "${artifact.uri}" does not exist on disk at "${fullPath}".`
        }
      }
      if (artifact.sha256) {
        const computed = `sha256:${createHash('sha256').update(readFileSync(fullPath)).digest('hex')}`
        if (computed !== artifact.sha256) {
          return {
            valid: false,
            error: `Artifact "${artifact.uri}" digest mismatch: expected ${artifact.sha256}, computed ${computed}.`
          }
        }
      }
    }
  }

  for (const req of context.child.stageAcceptance?.requiredArtifacts ?? []) {
    if (req.required !== false) {
      const match = data.artifacts.find((a) => a.kind === req.kind)
      if (!match) {
        return {
          valid: false,
          error: `Required stage artifact kind "${req.kind}" missing from worker result.`
        }
      }
      if (req.pathPattern && !matchesPathPattern(match.uri, req.pathPattern)) {
        return {
          valid: false,
          error: `Artifact "${match.uri}" does not match required pathPattern "${req.pathPattern}".`
        }
      }
    }
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

  for (const req of context.child.stageAcceptance?.requiredApprovals ?? []) {
    if (req.required !== false) {
      const approvals = ((report as Record<string, unknown>).approvals ??
        (data as Record<string, unknown>).approvals) as
        | { approvalId?: string; role?: string; approverIdentity?: string }[]
        | undefined
      const match = approvals?.find(
        (a) => a.role === req.role && Boolean(a.approverIdentity?.trim())
      )
      if (!match) {
        return {
          valid: false,
          error: `Required stage approval role "${req.role}" is missing from worker result.`
        }
      }
    }
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
