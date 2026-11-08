import type { StableAutomationCatalogRef } from './automation-owner-ref'
import type { UnifiedAutomationKind, UnifiedScheduleOwner } from './unified-automation-types'

export type UnifiedCapability =
  | 'open-detail'
  | 'run-now'
  | 'pause-resume'
  | 'edit-definition'
  | 'edit-schedule-child'
  | 'delete'
  | 'reply'
  | 'continue-on'
  | 'open-files'
  | 'cancel-run'

export type UnifiedDenialReason =
  | 'flag-off'
  | 'read-only-surface'
  | 'local-only-goal'
  | 'host-disconnected'
  | 'legacy-identity'
  | 'unsupported-platform'
  | 'manager-unsupported'
  | 'archived'
  | 'conflict'
  | 'source-missing'
  | 'source-stale'
  | 'capability-unknown'

export type UnifiedCapabilityDenial = {
  capability: UnifiedCapability
  reason: UnifiedDenialReason
}

export type UnifiedCapabilities = {
  granted: readonly UnifiedCapability[]
  denied: readonly UnifiedCapabilityDenial[]
}

export type UnifiedReadOnlyCapabilityContext = {
  kind: UnifiedAutomationKind
  surfaceEnabled?: boolean
  localOnlyGoal?: boolean
  hostConnection?: 'connected' | 'disconnected' | 'unknown'
  identity?: 'stable' | 'legacy'
  platform?: 'supported' | 'unsupported' | 'unknown'
  lifecycle?: 'active' | 'archived'
  conflict?: boolean
  manager?: 'supported' | 'unsupported' | 'unknown'
}

export type UnifiedScheduleChildCapabilityContext = Omit<
  UnifiedReadOnlyCapabilityContext,
  'kind' | 'localOnlyGoal' | 'lifecycle' | 'manager'
> & {
  owner: UnifiedScheduleOwner
}

const RECORD_CAPABILITIES: Record<UnifiedAutomationKind, readonly UnifiedCapability[]> = {
  goal: [
    'run-now',
    'pause-resume',
    'edit-definition',
    'edit-schedule-child',
    'delete',
    'reply',
    'continue-on',
    'open-files',
    'cancel-run'
  ],
  automation: [
    'run-now',
    'pause-resume',
    'edit-definition',
    'edit-schedule-child',
    'delete',
    'cancel-run'
  ],
  script: [
    'run-now',
    'pause-resume',
    'edit-definition',
    'edit-schedule-child',
    'delete',
    'open-files',
    'cancel-run'
  ],
  external: [
    'run-now',
    'pause-resume',
    'edit-definition',
    'edit-schedule-child',
    'delete',
    'cancel-run'
  ]
}

function readOnlyDenialReason(context: UnifiedReadOnlyCapabilityContext): UnifiedDenialReason {
  if (context.surfaceEnabled === false) {
    return 'flag-off'
  }
  if (context.conflict) {
    return 'conflict'
  }
  if (context.lifecycle === 'archived') {
    return 'archived'
  }
  if (context.hostConnection === 'disconnected') {
    return 'host-disconnected'
  }
  if (context.hostConnection === 'unknown') {
    return 'capability-unknown'
  }
  if (context.identity === 'legacy') {
    return 'legacy-identity'
  }
  if (context.platform === 'unsupported') {
    return 'unsupported-platform'
  }
  if (context.platform === 'unknown') {
    return 'capability-unknown'
  }
  if (context.kind === 'goal' && context.localOnlyGoal) {
    return 'local-only-goal'
  }
  if (context.kind === 'external' && context.manager !== 'supported') {
    return 'manager-unsupported'
  }
  return 'read-only-surface'
}

export function readOnlyUnifiedCapabilities(
  context: UnifiedReadOnlyCapabilityContext
): UnifiedCapabilities {
  const reason = readOnlyDenialReason(context)
  return {
    granted: ['open-detail'],
    denied: RECORD_CAPABILITIES[context.kind].map((capability) => ({ capability, reason }))
  }
}

export function readOnlyUnifiedScheduleChildCapabilities(
  context: UnifiedScheduleChildCapabilityContext
): UnifiedCapabilities {
  const contextualReason = readOnlyDenialReason({
    ...context,
    kind: 'automation',
    identity: context.owner === 'legacy-cron' ? 'legacy' : context.identity
  })
  const reason =
    contextualReason !== 'read-only-surface'
      ? contextualReason
      : context.owner === 'external-manager'
        ? 'manager-unsupported'
        : contextualReason
  return {
    granted: [],
    denied: [{ capability: 'edit-schedule-child', reason }]
  }
}

export type UnifiedRunnerCapabilityStatus = 'supported' | 'unsupported' | 'unavailable' | 'unknown'

export type UnifiedRunnerCapability<T> = {
  status: UnifiedRunnerCapabilityStatus
  value: T | null
  reason: UnifiedDenialReason | null
}

export type UnifiedRunnerAuthorityEvidence = {
  stable: StableAutomationCatalogRef
  ownerKey: string | null
  runtimePairingRevision: number | null
  sshTargetGeneration: number | null
}

export type UnifiedScriptRunnerPlatform = 'linux' | 'darwin' | 'win32'
export type UnifiedScriptInvocationMode = 'direct-argv' | 'explicit-shell'

export type UnifiedScriptRunnerCapabilitySnapshot = {
  authority: UnifiedRunnerAuthorityEvidence
  observedAt: string
  availability: UnifiedRunnerCapability<true>
  platform: UnifiedRunnerCapability<UnifiedScriptRunnerPlatform>
  invocationModes: UnifiedRunnerCapability<readonly UnifiedScriptInvocationMode[]>
  workingDirectory: UnifiedRunnerCapability<{
    allowedRootsRequired: boolean
    verifyBeforeSpawn: boolean
  }>
  environment: UnifiedRunnerCapability<{
    allowlist: boolean
    secretReferences: boolean
    inheritParentEnvironment: false
  }>
  timeout: UnifiedRunnerCapability<{
    enforced: boolean
    terminationGrace: boolean
  }>
  cancellation: UnifiedRunnerCapability<{
    supported: boolean
    verifiedProcessTreeTermination: boolean
    confirmationRequired: true
  }>
  outputArtifacts: UnifiedRunnerCapability<{
    separateStdoutStderr: boolean
    stdoutMaxBytes: number
    stderrMaxBytes: number
    retentionSeconds: number
  }>
  overlap: UnifiedRunnerCapability<{
    policy: 'forbid' | 'allow'
    idempotencyKeys: boolean
  }>
  elevation: UnifiedRunnerCapability<false>
  ownerCrash: UnifiedRunnerCapability<'terminate-and-confirm' | 'retain-and-reattach'>
}

function unavailableRunnerCapability<T>(
  status: Exclude<UnifiedRunnerCapabilityStatus, 'supported'>,
  reason: UnifiedDenialReason
): UnifiedRunnerCapability<T> {
  return { status, value: null, reason }
}

export function unavailableUnifiedScriptRunnerCapabilities(input: {
  authority: UnifiedRunnerAuthorityEvidence
  observedAt: string
  status: 'unsupported' | 'unavailable' | 'unknown'
  reason: Extract<
    UnifiedDenialReason,
    'unsupported-platform' | 'host-disconnected' | 'capability-unknown' | 'read-only-surface'
  >
  platform?: UnifiedScriptRunnerPlatform
}): UnifiedScriptRunnerCapabilitySnapshot {
  const unavailable = <T>(): UnifiedRunnerCapability<T> =>
    unavailableRunnerCapability<T>(input.status, input.reason)
  return {
    authority: input.authority,
    observedAt: input.observedAt,
    availability: unavailable(),
    platform: input.platform
      ? { status: 'supported', value: input.platform, reason: null }
      : unavailable(),
    invocationModes: unavailable(),
    workingDirectory: unavailable(),
    environment: unavailable(),
    timeout: unavailable(),
    cancellation: unavailable(),
    outputArtifacts: unavailable(),
    overlap: unavailable(),
    elevation: { status: 'unsupported', value: false, reason: input.reason },
    ownerCrash: unavailable()
  }
}
