import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { isValidArtifactUri } from '../../shared/coordinated-automation-receipt-schemas'
import type { StructuredWorkerArtifact } from '../../shared/coordinated-automation-receipt-types'
import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'

export type ArtifactValidationContext = {
  taskId: string
  dispatchId: string
  workspacePath?: string
  checkArtifactExistence?: (uri: string) => boolean
}

export type ArtifactValidationResult = { valid: true } | { valid: false; error: string }

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

function resolveWorkspaceArtifactPath(
  cleanUri: string,
  workspacePath: string,
  rawUri: string
): { fullPath: string } | { error: string } {
  const normalizedWorkspace = resolve(workspacePath)
  const fullPath = isAbsolute(cleanUri) ? cleanUri : resolve(normalizedWorkspace, cleanUri)
  if (!fullPath.startsWith(`${normalizedWorkspace}/`) && fullPath !== normalizedWorkspace) {
    return { error: `Artifact path "${rawUri}" resolves outside workspace path.` }
  }
  return { fullPath }
}

export function validateWorkerArtifacts(
  artifacts: readonly StructuredWorkerArtifact[],
  stageAcceptance: ResolvedChildSnapshot['stageAcceptance'],
  context: ArtifactValidationContext
): ArtifactValidationResult {
  const requiredArtifacts = (stageAcceptance?.requiredArtifacts ?? []).filter(
    (req) => req.required !== false
  )

  if (
    requiredArtifacts.length > 0 &&
    (!context.workspacePath || context.workspacePath.trim() === '')
  ) {
    return {
      valid: false,
      error: 'Cannot validate required artifacts without a valid workspacePath.'
    }
  }

  for (const req of requiredArtifacts) {
    const match = artifacts.find((a) => a.kind === req.kind)
    if (!match) {
      return {
        valid: false,
        error: `Required stage artifact kind "${req.kind}" missing from worker result.`
      }
    }
    if (!match.uri || match.uri.trim() === '') {
      return { valid: false, error: `Required stage artifact "${req.kind}" missing uri.` }
    }
    if (req.pathPattern && !matchesPathPattern(match.uri, req.pathPattern)) {
      return {
        valid: false,
        error: `Artifact "${match.uri}" does not match required pathPattern "${req.pathPattern}".`
      }
    }
    if (!match.sha256 || match.sha256.trim() === '') {
      return {
        valid: false,
        error: `Required stage artifact "${match.uri}" must specify a sha256 digest.`
      }
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(match.sha256)) {
      return {
        valid: false,
        error: `Artifact "${match.uri}" sha256 "${match.sha256}" is not a valid lowercase hex digest.`
      }
    }

    const cleanUri = match.uri.replace(/^artifact:\/\//, '').replace(/^\/+/, '')
    const resolved = resolveWorkspaceArtifactPath(cleanUri, context.workspacePath!, match.uri)
    if ('error' in resolved) {
      return { valid: false, error: resolved.error }
    }
    if (!existsSync(resolved.fullPath)) {
      return {
        valid: false,
        error: `Artifact file "${match.uri}" does not exist on disk at "${resolved.fullPath}".`
      }
    }
    const computed = `sha256:${createHash('sha256').update(readFileSync(resolved.fullPath)).digest('hex')}`
    if (computed !== match.sha256) {
      return {
        valid: false,
        error: `Artifact "${match.uri}" digest mismatch: expected ${match.sha256}, computed ${computed}.`
      }
    }
  }

  for (const artifact of artifacts) {
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
    if (!artifact.uri || artifact.uri.trim() === '') {
      return { valid: false, error: 'Artifact missing uri.' }
    }
    if (artifact.uri.includes('..') || !isValidArtifactUri(artifact.uri)) {
      return {
        valid: false,
        error: `Artifact "${artifact.uri}" contains invalid traversal segments or invalid URI format.`
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

    const cleanUri = artifact.uri.replace(/^artifact:\/\//, '').replace(/^\/+/, '')
    if (context.workspacePath) {
      const resolved = resolveWorkspaceArtifactPath(cleanUri, context.workspacePath, artifact.uri)
      if ('error' in resolved) {
        return { valid: false, error: resolved.error }
      }
      if (existsSync(resolved.fullPath) && artifact.sha256) {
        const computed = `sha256:${createHash('sha256').update(readFileSync(resolved.fullPath)).digest('hex')}`
        if (computed !== artifact.sha256) {
          return {
            valid: false,
            error: `Artifact "${artifact.uri}" digest mismatch: expected ${artifact.sha256}, computed ${computed}.`
          }
        }
      }
    }
  }

  return { valid: true }
}
