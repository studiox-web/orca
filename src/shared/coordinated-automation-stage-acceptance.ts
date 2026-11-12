export type StageArtifactRequirement = {
  kind: string
  pathPattern?: string
  sameDigestAs?: string
  description?: string
  required?: boolean
}

export type StageCheckRequirement = {
  id: string
  namespace?: string
  description?: string
  required?: boolean
}

export type StageEffectRequirement = {
  kind: string
  namespace?: string
  allowedStatuses: ('applied' | 'verified')[]
  description?: string
  required?: boolean
}

export type StageApprovalRequirement = {
  id: string
  role: string
  disallowAuthorApproval?: boolean
  description?: string
  required?: boolean
}

export type StageAcceptanceContract = {
  criteria?: { id: string; description: string; required?: boolean }[]
  requiredArtifacts?: StageArtifactRequirement[]
  requiredChecks?: StageCheckRequirement[]
  requiredEffects?: StageEffectRequirement[]
  requiredApprovals?: StageApprovalRequirement[]
}
