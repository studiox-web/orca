/** Store-owned integrity records attached to coordinated runs. */

export type CoordinatedCompletionTrust = {
  authorIdentity: string
  activeAttempt: { taskId: string; dispatchId: string }
  waiverPolicy?: {
    allowedRoles: string[]
    authorities: { identity: string; role: string }[]
  }
  productionDecision?: { approverIdentity: string; role: string; decidedAt: number }
}

/** Store-private quarantine record. */
export type CoordinatedRunQuarantine = {
  reason: string
  /** sha256 of the rejected coordinated payload as it was stored. */
  payloadDigest: string
  /** The rejected payload, kept verbatim when it fits the bound. */
  payload: string | null
}

/** The only quarantine shape list/get callers receive. */
export type CoordinatedRunQuarantineSummary = {
  reason: string
  payloadDigest: string
  payloadRetained: boolean
}

/** What retention keeps when a coordinated run's full snapshot is evicted. */
export type CoordinatedRunRetainedEvidence = {
  definitionRevision: number
  canonicalDigest: string
  /** `<type>:<id>` of the snapshot's execution target, for receipt identity checks. */
  executionAuthority: string
  children: { childDefinitionId: string; name: string; role: string }[]
  minimumEvidenceReferences: string[]
}
